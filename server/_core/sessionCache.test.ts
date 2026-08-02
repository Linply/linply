import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  connect: vi.fn(),
  del: vi.fn(),
  destroy: vi.fn(),
  get: vi.fn(),
  isOpen: true,
  isReady: true,
  on: vi.fn(),
  quit: vi.fn(),
  set: vi.fn(),
}));

vi.mock("redis", () => ({
  createClient: vi.fn(() => redis),
}));

vi.mock("./env", () => ({
  ENV: {
    redisUrl: "redis://localhost:6379",
    sessionCacheTtlMs: 60_000,
    sessionCacheConnectTimeoutMs: 1_000,
    sessionCacheCommandTimeoutMs: 250,
  },
}));

vi.mock("./observability", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import {
  cacheSession,
  closeSessionCache,
  getCachedSession,
  markSessionRevoked,
} from "./sessionCache";

const createSessionResult = (expiresAt = new Date(Date.now() + 120_000)) => ({
  session: {
    id: 12,
    userId: 8,
    tokenHash: "a".repeat(64),
    expiresAt,
    revokedAt: null,
    ipAddress: null,
    userAgent: "vitest",
    createdAt: new Date(),
    lastSeenAt: new Date(),
  },
  user: {
    id: 8,
    name: "测试用户",
    email: "user@example.com",
    role: "user" as const,
    avatarUrl: null,
    emailVerifiedAt: null,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
});

describe("session cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.connect.mockResolvedValue(redis);
    redis.del.mockResolvedValue(1);
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue("OK");
    redis.quit.mockResolvedValue("OK");
  });

  it("stores only the token hash key with a bounded absolute TTL", async () => {
    const tokenHash = "b".repeat(64);
    const value = createSessionResult(new Date(Date.now() + 2_000));

    await cacheSession(tokenHash, value);

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, payload, options] = redis.set.mock.calls[0]!;
    expect(key).toBe(`auth:session:v1:${tokenHash}`);
    expect(key).not.toContain("raw-session-token");
    expect(payload).not.toContain("raw-session-token");
    expect(options).toMatchObject({ NX: true });
    expect(options.PX).toBeGreaterThan(0);
    expect(options.PX).toBeLessThanOrEqual(2_000);
  });

  it("does not cache an already expired session", async () => {
    await cacheSession("c".repeat(64), createSessionResult(new Date(Date.now() - 1)));
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("restores cached dates and user data", async () => {
    const value = createSessionResult();
    redis.get.mockResolvedValue(JSON.stringify({
      version: 1,
      session: {
        ...value.session,
        expiresAt: value.session.expiresAt.toISOString(),
        revokedAt: null,
        createdAt: value.session.createdAt.toISOString(),
        lastSeenAt: value.session.lastSeenAt.toISOString(),
      },
      user: {
        ...value.user,
        emailVerifiedAt: null,
        disabledAt: null,
        createdAt: value.user.createdAt.toISOString(),
        updatedAt: value.user.updatedAt.toISOString(),
        lastSignedIn: value.user.lastSignedIn?.toISOString() ?? null,
      },
    }));

    const result = await getCachedSession("d".repeat(64));

    expect(result.status).toBe("hit");
    if (result.status === "hit") {
      expect(result.value.session.expiresAt).toBeInstanceOf(Date);
      expect(result.value.user.createdAt).toBeInstanceOf(Date);
      expect(result.value.user.email).toBe("user@example.com");
    }
  });

  it("rejects malformed, expired, and disabled cache payloads", async () => {
    redis.get.mockResolvedValueOnce("not-json");
    await expect(getCachedSession("e".repeat(64))).resolves.toEqual({ status: "miss" });

    const value = createSessionResult(new Date(Date.now() - 1));
    redis.get.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      session: {
        ...value.session,
        expiresAt: value.session.expiresAt.toISOString(),
        revokedAt: null,
        createdAt: value.session.createdAt.toISOString(),
        lastSeenAt: value.session.lastSeenAt.toISOString(),
      },
      user: {
        ...value.user,
        emailVerifiedAt: null,
        disabledAt: new Date().toISOString(),
        createdAt: value.user.createdAt.toISOString(),
        updatedAt: value.user.updatedAt.toISOString(),
        lastSignedIn: null,
      },
    }));
    await expect(getCachedSession("f".repeat(64))).resolves.toEqual({ status: "miss" });
  });

  it("uses a tombstone that positive cache fills cannot overwrite", async () => {
    const tokenHash = "1".repeat(64);
    await markSessionRevoked(tokenHash);
    await cacheSession(tokenHash, createSessionResult());

    expect(redis.set.mock.calls[0]?.[2]).toMatchObject({ PX: 60_000 });
    expect(redis.set.mock.calls[1]?.[2]).toMatchObject({ NX: true });

    redis.get.mockResolvedValue(JSON.stringify({ version: 1, revoked: true }));
    await expect(getCachedSession(tokenHash)).resolves.toEqual({ status: "revoked" });
  });

  it("falls back to a miss when Redis fails", async () => {
    redis.get.mockRejectedValueOnce(new Error("connection lost"));
    await expect(getCachedSession("2".repeat(64))).resolves.toEqual({ status: "miss" });

    redis.get.mockClear();
    await expect(getCachedSession("3".repeat(64))).resolves.toEqual({ status: "miss" });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("closes the shared Redis client once", async () => {
    await closeSessionCache();
    await closeSessionCache();
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });
});
