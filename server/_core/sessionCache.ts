import { createClient, type RedisClientType } from "redis";
import type { Session, User } from "../../drizzle/schema";
import { ENV } from "./env";
import { logInfo, logWarn } from "./observability";

const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = "auth:session:v1:";
const WARNING_INTERVAL_MS = 60_000;
const TOMBSTONE_VALUE = JSON.stringify({ version: CACHE_VERSION, revoked: true });

type ActiveSession = { session: Session; user: User };
export type SessionCacheResult =
  | { status: "hit"; value: ActiveSession }
  | { status: "miss" }
  | { status: "revoked" };

type SerializedActiveSession = {
  version: number;
  revoked?: false;
  session: Omit<Session, "expiresAt" | "revokedAt" | "createdAt" | "lastSeenAt"> & {
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
    lastSeenAt: string;
  };
  user: Omit<
    User,
    "emailVerifiedAt" | "disabledAt" | "createdAt" | "updatedAt" | "lastSignedIn"
  > & {
    emailVerifiedAt: string | null;
    disabledAt: string | null;
    createdAt: string;
    updatedAt: string;
    lastSignedIn: string | null;
  };
};

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;
let closePromise: Promise<void> | null = null;
let readsDisabledUntil = 0;
let lastWarningAt = 0;
let connectedOnce = false;

const cacheKey = (tokenHash: string) => `${CACHE_KEY_PREFIX}${tokenHash}`;

const parseDate = (value: unknown) => {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const parseActiveSession = (raw: string): SessionCacheResult => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "miss" };
  }

  if (!value || typeof value !== "object") return { status: "miss" };
  const payload = value as Record<string, unknown>;
  if (payload.version !== CACHE_VERSION) return { status: "miss" };
  if (payload.revoked === true) return { status: "revoked" };
  if (!payload.session || typeof payload.session !== "object") {
    return { status: "miss" };
  }
  if (!payload.user || typeof payload.user !== "object") {
    return { status: "miss" };
  }

  const session = payload.session as Record<string, unknown>;
  const user = payload.user as Record<string, unknown>;
  const expiresAt = parseDate(session.expiresAt);
  const createdAt = parseDate(session.createdAt);
  const lastSeenAt = parseDate(session.lastSeenAt);
  const userCreatedAt = parseDate(user.createdAt);
  const updatedAt = parseDate(user.updatedAt);
  const emailVerifiedAt = user.emailVerifiedAt === null
    ? null
    : parseDate(user.emailVerifiedAt);
  const disabledAt = user.disabledAt === null ? null : parseDate(user.disabledAt);
  const lastSignedIn = user.lastSignedIn === null
    ? null
    : parseDate(user.lastSignedIn);

  if (
    !Number.isInteger(session.id) ||
    !Number.isInteger(session.userId) ||
    typeof session.tokenHash !== "string" ||
    !expiresAt ||
    expiresAt.getTime() <= Date.now() ||
    session.revokedAt !== null ||
    !isNullableString(session.ipAddress) ||
    !isNullableString(session.userAgent) ||
    !createdAt ||
    !lastSeenAt ||
    !Number.isInteger(user.id) ||
    typeof user.name !== "string" ||
    typeof user.email !== "string" ||
    (user.role !== "user" && user.role !== "admin") ||
    !isNullableString(user.avatarUrl) ||
    (user.emailVerifiedAt !== null && !emailVerifiedAt) ||
    user.disabledAt !== null ||
    !userCreatedAt ||
    !updatedAt ||
    (user.lastSignedIn !== null && !lastSignedIn)
  ) {
    return { status: "miss" };
  }

  return {
    status: "hit",
    value: {
      session: {
        id: session.id as number,
        userId: session.userId as number,
        tokenHash: session.tokenHash,
        expiresAt,
        revokedAt: null,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt,
        lastSeenAt,
      },
      user: {
        id: user.id as number,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        emailVerifiedAt,
        disabledAt,
        createdAt: userCreatedAt,
        updatedAt,
        lastSignedIn,
      },
    },
  };
};

const serializeActiveSession = (value: ActiveSession): SerializedActiveSession => ({
  version: CACHE_VERSION,
  session: {
    ...value.session,
    expiresAt: value.session.expiresAt.toISOString(),
    revokedAt: value.session.revokedAt?.toISOString() ?? null,
    createdAt: value.session.createdAt.toISOString(),
    lastSeenAt: value.session.lastSeenAt.toISOString(),
  },
  user: {
    ...value.user,
    emailVerifiedAt: value.user.emailVerifiedAt?.toISOString() ?? null,
    disabledAt: value.user.disabledAt?.toISOString() ?? null,
    createdAt: value.user.createdAt.toISOString(),
    updatedAt: value.user.updatedAt.toISOString(),
    lastSignedIn: value.user.lastSignedIn?.toISOString() ?? null,
  },
});

const warnOnce = (operation: string, error: unknown) => {
  const now = Date.now();
  if (now - lastWarningAt < WARNING_INTERVAL_MS) return;
  lastWarningAt = now;
  logWarn("[SessionCache] Redis unavailable; using PostgreSQL", {
    operation,
    error: error instanceof Error ? error.message : String(error),
  });
};

const disableReads = (operation: string, error: unknown) => {
  readsDisabledUntil = Math.max(
    readsDisabledUntil,
    Date.now() + ENV.sessionCacheTtlMs
  );
  warnOnce(operation, error);
};

const withTimeout = async <T>(operation: Promise<T>) => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Redis command timed out")),
          ENV.sessionCacheCommandTimeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const getClient = async () => {
  if (!ENV.redisUrl) return null;
  if (client?.isReady) return client;
  if (connectPromise) return connectPromise;

  const nextClient = createClient({
    url: ENV.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: ENV.sessionCacheConnectTimeoutMs,
      reconnectStrategy: false,
    },
  });
  client = nextClient as RedisClientType;
  nextClient.on("error", error => warnOnce("client", error));

  connectPromise = nextClient.connect()
    .then(() => {
      if (!connectedOnce) {
        connectedOnce = true;
        logInfo("[SessionCache] Redis cache connected");
      }
      return nextClient as RedisClientType;
    })
    .catch(error => {
      if (client === nextClient) client = null;
      try {
        nextClient.destroy();
      } catch {
        // The failed connection may already be closed.
      }
      throw error;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
};

const runCacheOperation = async <T>(
  operation: string,
  callback: (redis: RedisClientType) => Promise<T>
): Promise<T | undefined> => {
  try {
    const redis = await getClient();
    if (!redis) return undefined;
    return await withTimeout(callback(redis));
  } catch (error) {
    disableReads(operation, error);
    return undefined;
  }
};

export async function getCachedSession(tokenHash: string): Promise<SessionCacheResult> {
  if (!ENV.redisUrl || Date.now() < readsDisabledUntil) {
    return { status: "miss" };
  }

  const raw = await runCacheOperation("get", redis => redis.get(cacheKey(tokenHash)));
  if (!raw) return { status: "miss" };

  const result = parseActiveSession(raw);
  if (result.status === "miss") {
    void runCacheOperation("delete-invalid", redis => redis.del(cacheKey(tokenHash)));
  }
  return result;
}

export async function cacheSession(tokenHash: string, value: ActiveSession) {
  const ttlMs = Math.min(
    ENV.sessionCacheTtlMs,
    value.session.expiresAt.getTime() - Date.now()
  );
  if (!ENV.redisUrl || ttlMs <= 0) return;

  await runCacheOperation("set", redis =>
    redis.set(cacheKey(tokenHash), JSON.stringify(serializeActiveSession(value)), {
      PX: Math.max(1, Math.floor(ttlMs)),
      NX: true,
    })
  );
}

export async function markSessionRevoked(tokenHash: string) {
  if (!ENV.redisUrl) return;
  await runCacheOperation("revoke", redis =>
    redis.set(cacheKey(tokenHash), TOMBSTONE_VALUE, {
      PX: ENV.sessionCacheTtlMs,
    })
  );
}

export function isSessionCacheEnabled() {
  return Boolean(ENV.redisUrl);
}

export async function closeSessionCache() {
  if (closePromise) return closePromise;
  closePromise = (async () => {
    const currentClient = client;
    client = null;
    connectPromise = null;
    if (!currentClient?.isOpen) return;

    try {
      await withTimeout(currentClient.quit());
    } catch (error) {
      warnOnce("close", error);
      try {
        currentClient.destroy();
      } catch {
        // The client may already be closed.
      }
    }
  })();
  return closePromise;
}
