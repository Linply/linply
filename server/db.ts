import { randomBytes, randomUUID } from "node:crypto";
import {
  eq,
  and,
  desc,
  gt,
  gte,
  like,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  users,
  authAccounts,
  sessions,
  oauthStates,
  workspaces,
  planRequests,
  workspaceChannels,
  channelContacts,
  tickets,
  knowledgeBase,
  knowledgeDocuments,
  knowledgeSecurityEvents,
  chatMessages,
  ticketNotes,
  agentRuns,
  agentTokenDailyBuckets,
  agentTokenAttemptLedgers,
  agentRunSteps,
  agentRunEvents,
  agentToolInvocations,
  agentToolEffects,
} from "../drizzle/schema";
import type {
  KnowledgeDocumentStatus,
  KnowledgeSecurityStatus,
} from "../shared/knowledge";
import type { KnowledgeSecurityFinding } from "./knowledge/security";
import { createEmbedding, isEmbeddingEnabled } from "./_core/embeddings";
import { logWarn } from "./_core/observability";
import { ENV } from "./_core/env";
import {
  PLANS,
  type WorkspacePlan,
} from "../shared/plans";
import {
  getTokenSettlement,
  shouldRejectTokenReservation,
  TokenQuotaExceededError,
  type TokenQuotaSnapshot,
  type TokenUsageState,
  utcResetAtFromDay,
} from "./tokenQuota";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _client = postgres(process.env.DATABASE_URL, { max: 10 });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}

export async function createPasswordUser(data: {
  email: string;
  name: string;
  passwordHash: string;
  role?: "user" | "admin";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [user] = await tx
      .insert(users)
      .values({
        email: data.email,
        name: data.name,
        role: data.role ?? "user",
        lastSignedIn: new Date(),
      })
      .returning();

    if (!user) throw new Error("Failed to create user");

    await tx.insert(authAccounts).values({
      userId: user.id,
      provider: "password",
      providerAccountId: data.email,
      passwordHash: data.passwordHash,
    });

    return user;
  });
}

export async function getPasswordAccountByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .select({ user: users, passwordHash: authAccounts.passwordHash })
    .from(authAccounts)
    .innerJoin(users, eq(authAccounts.userId, users.id))
    .where(
      and(
        eq(authAccounts.provider, "password"),
        eq(authAccounts.providerAccountId, email)
      )
    )
    .limit(1);

  return result;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user;
}

export async function createSession(data: {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [session] = await db
    .insert(sessions)
    .values({
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    })
    .returning();
  return session;
}

export async function getActiveSessionWithUser(tokenHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        isNull(users.disabledAt)
      )
    )
    .limit(1);

  return result;
}

export async function touchSession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, id));
}

export async function revokeSession(tokenHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

export async function updateUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({
      lastSignedIn: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
}

export async function createOAuthState(data: {
  provider: string;
  stateHash: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  const [state] = await db.insert(oauthStates).values(data).returning();
  return state;
}

export async function consumeOAuthState(provider: string, stateHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [state] = await db
    .delete(oauthStates)
    .where(
      and(
        eq(oauthStates.provider, provider),
        eq(oauthStates.stateHash, stateHash),
        gt(oauthStates.expiresAt, new Date())
      )
    )
    .returning();
  return state;
}

export async function findOrCreateOAuthUser(data: {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [linked] = await tx
      .select({ user: users })
      .from(authAccounts)
      .innerJoin(users, eq(authAccounts.userId, users.id))
      .where(
        and(
          eq(authAccounts.provider, data.provider),
          eq(authAccounts.providerAccountId, data.providerAccountId)
        )
      )
      .limit(1);

    if (linked) return linked.user;

    let [user] = await tx
      .select()
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (user?.disabledAt) throw new Error("User disabled");
    if (user && !user.emailVerifiedAt) {
      throw Object.assign(
        new Error("OAuth account linking requires a verified email"),
        {
          code: "OAUTH_ACCOUNT_LINK_REQUIRED",
        }
      );
    }

    if (!user) {
      [user] = await tx
        .insert(users)
        .values({
          email: data.email,
          name: data.name,
          avatarUrl: data.avatarUrl ?? null,
          emailVerifiedAt: new Date(),
          lastSignedIn: new Date(),
        })
        .returning();
    } else {
      [user] = await tx
        .update(users)
        .set({
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          avatarUrl: user.avatarUrl ?? data.avatarUrl ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();
    }

    if (!user) throw new Error("Failed to create OAuth user");

    await tx.insert(authAccounts).values({
      userId: user.id,
      provider: data.provider,
      providerAccountId: data.providerAccountId,
    });

    return user;
  });
}

// ============ Workspaces ============

/** URL-safe random identifier for public share links and webhook paths. */
const createOpaqueKey = (bytes = 16) => randomBytes(bytes).toString("hex");

export type ChannelProvider = "web" | "telegram" | "slack" | "feishu";
export type ChannelStatus = "pending" | "connected" | "error" | "disabled";
export type OnboardingStep =
  | "profile"
  | "knowledge"
  | "preview"
  | "channel"
  | "done";

export async function getWorkspaceByOwner(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, userId))
    .limit(1);
  return workspace ?? null;
}

export async function getWorkspaceById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return workspace ?? null;
}

export async function getWorkspaceByPublicKey(publicKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.publicKey, publicKey))
    .limit(1);
  return workspace ?? null;
}

/**
 * Creates the caller's personal workspace together with its built-in `web`
 * channel. Concurrent first requests from the same account race here, so the
 * unique index on ownerUserId decides the winner and the loser re-reads.
 */
export async function createWorkspaceForOwner(data: {
  userId: number;
  name: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        ownerUserId: data.userId,
        name: data.name,
        publicKey: createOpaqueKey(12),
      })
      .onConflictDoNothing({ target: workspaces.ownerUserId })
      .returning();

    if (!workspace) {
      const [existing] = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.ownerUserId, data.userId))
        .limit(1);
      if (!existing) throw new Error("Failed to create workspace");
      return existing;
    }

    await tx.insert(workspaceChannels).values({
      workspaceId: workspace.id,
      provider: "web",
      status: "connected",
      displayName: "分享链接",
      webhookSecret: createOpaqueKey(16),
    });

    return workspace;
  });
}

export async function updateWorkspace(
  id: number,
  data: Partial<{
    name: string;
    agentName: string;
    agentTone: string;
    greeting: string | null;
    fallbackReply: string | null;
    businessContext: string | null;
    publicChatEnabled: boolean;
    onboardingStep: OnboardingStep;
    onboardingCompletedAt: Date | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [workspace] = await db
    .update(workspaces)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return workspace ?? null;
}

/** Counts driving the setup checklist and the workspace overview cards. */
export async function getWorkspaceOverview(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [knowledge] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      searchable:
        sql<number>`count(*) filter (where ${knowledgeBase.securityStatus} = 'approved' and ${knowledgeBase.embeddingStatus} = 'completed')`.mapWith(
          Number
        ),
      quarantined:
        sql<number>`count(*) filter (where ${knowledgeBase.securityStatus} = 'quarantined')`.mapWith(
          Number
        ),
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.workspaceId, workspaceId));

  const [ticketCounts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      open: sql<number>`count(*) filter (where ${tickets.status} in ('pending','in_progress'))`.mapWith(
        Number
      ),
    })
    .from(tickets)
    .where(eq(tickets.workspaceId, workspaceId));

  const [contactCounts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      activeLast7d:
        sql<number>`count(*) filter (where ${channelContacts.lastMessageAt} > now() - interval '7 days')`.mapWith(
          Number
        ),
    })
    .from(channelContacts)
    .where(eq(channelContacts.workspaceId, workspaceId));

  const [messageCounts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      last7d:
        sql<number>`count(*) filter (where ${chatMessages.createdAt} > now() - interval '7 days')`.mapWith(
          Number
        ),
    })
    .from(chatMessages)
    .where(eq(chatMessages.workspaceId, workspaceId));

  const [connectedChannels] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(workspaceChannels)
    .where(
      and(
        eq(workspaceChannels.workspaceId, workspaceId),
        eq(workspaceChannels.status, "connected"),
        sql`${workspaceChannels.provider} <> 'web'`
      )
    );

  return {
    knowledgeTotal: knowledge?.total ?? 0,
    knowledgeSearchable: knowledge?.searchable ?? 0,
    knowledgeQuarantined: knowledge?.quarantined ?? 0,
    ticketsTotal: ticketCounts?.total ?? 0,
    ticketsOpen: ticketCounts?.open ?? 0,
    contactsTotal: contactCounts?.total ?? 0,
    contactsActive: contactCounts?.activeLast7d ?? 0,
    messagesTotal: messageCounts?.total ?? 0,
    messagesLast7d: messageCounts?.last7d ?? 0,
    connectedChannels: connectedChannels?.total ?? 0,
  };
}

// ============ Plans ============

/** Current consumption for every metered limit, for gating and the pricing page. */
export async function getWorkspacePlanUsage(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [knowledge] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.workspaceId, workspaceId));

  const [channels] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(workspaceChannels)
    .where(
      and(
        eq(workspaceChannels.workspaceId, workspaceId),
        eq(workspaceChannels.status, "connected"),
        // The built-in share link ships with every plan and is never metered.
        sql`${workspaceChannels.provider} <> 'web'`
      )
    );

  const [contacts] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(channelContacts)
    .where(
      and(
        eq(channelContacts.workspaceId, workspaceId),
        sql`${channelContacts.createdAt} > now() - interval '30 days'`
      )
    );

  return {
    knowledgeEntries: knowledge?.total ?? 0,
    connectedChannels: channels?.total ?? 0,
    monthlyContacts: contacts?.total ?? 0,
  };
}

export async function setWorkspacePlan(
  workspaceId: number,
  plan: WorkspacePlan
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [workspace] = await db
    .update(workspaces)
    .set({
      plan,
      planActivatedAt: plan === "free" ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return workspace ?? null;
}

export async function getOpenPlanRequest(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [request] = await db
    .select()
    .from(planRequests)
    .where(
      and(
        eq(planRequests.workspaceId, workspaceId),
        eq(planRequests.status, "pending")
      )
    )
    .limit(1);
  return request ?? null;
}

/**
 * Records an upgrade intent. The partial unique index makes repeated clicks
 * idempotent: a second pending request for the same workspace updates the
 * target plan instead of stacking rows.
 */
export async function createPlanRequest(data: {
  workspaceId: number;
  requestedBy: number;
  fromPlan: WorkspacePlan;
  toPlan: WorkspacePlan;
  note?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [request] = await db
    .insert(planRequests)
    .values({
      workspaceId: data.workspaceId,
      requestedBy: data.requestedBy,
      fromPlan: data.fromPlan,
      toPlan: data.toPlan,
      note: data.note ?? null,
    })
    .onConflictDoUpdate({
      target: planRequests.workspaceId,
      targetWhere: sql`status = 'pending'`,
      set: {
        toPlan: data.toPlan,
        fromPlan: data.fromPlan,
        note: data.note ?? null,
        createdAt: new Date(),
      },
    })
    .returning();

  if (!request) throw new Error("Failed to record plan request");
  return request;
}

export async function cancelPlanRequest(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .update(planRequests)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(
      and(
        eq(planRequests.workspaceId, workspaceId),
        eq(planRequests.status, "pending")
      )
    );
}

// ============ Workspace Channels ============

export async function listWorkspaceChannels(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(workspaceChannels)
    .where(eq(workspaceChannels.workspaceId, workspaceId))
    .orderBy(workspaceChannels.id);
}

export async function getWorkspaceChannel(
  workspaceId: number,
  provider: ChannelProvider
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [channel] = await db
    .select()
    .from(workspaceChannels)
    .where(
      and(
        eq(workspaceChannels.workspaceId, workspaceId),
        eq(workspaceChannels.provider, provider)
      )
    )
    .limit(1);
  return channel ?? null;
}

export async function getChannelByWebhookSecret(secret: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [channel] = await db
    .select()
    .from(workspaceChannels)
    .where(eq(workspaceChannels.webhookSecret, secret))
    .limit(1);
  return channel ?? null;
}

export async function listChannelsByProvider(
  provider: ChannelProvider,
  status?: ChannelStatus
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [eq(workspaceChannels.provider, provider)];
  if (status) conditions.push(eq(workspaceChannels.status, status));
  return db
    .select()
    .from(workspaceChannels)
    .where(and(...conditions))
    .orderBy(workspaceChannels.id);
}

/** Creates the provider row on first connect, then overwrites its settings. */
export async function upsertWorkspaceChannel(data: {
  workspaceId: number;
  provider: ChannelProvider;
  status: ChannelStatus;
  displayName?: string | null;
  externalId?: string | null;
  credentials?: Record<string, string>;
  deliveryMode?: string;
  autoReply?: boolean;
  lastError?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [channel] = await db
    .insert(workspaceChannels)
    .values({
      workspaceId: data.workspaceId,
      provider: data.provider,
      status: data.status,
      displayName: data.displayName ?? null,
      externalId: data.externalId ?? null,
      credentials: data.credentials ?? {},
      webhookSecret: createOpaqueKey(16),
      deliveryMode: data.deliveryMode ?? "webhook",
      autoReply: data.autoReply ?? true,
      lastError: data.lastError ?? null,
    })
    .onConflictDoUpdate({
      target: [workspaceChannels.workspaceId, workspaceChannels.provider],
      set: {
        status: data.status,
        displayName: data.displayName ?? null,
        externalId: data.externalId ?? null,
        ...(data.credentials ? { credentials: data.credentials } : {}),
        ...(data.deliveryMode ? { deliveryMode: data.deliveryMode } : {}),
        ...(data.autoReply === undefined ? {} : { autoReply: data.autoReply }),
        lastError: data.lastError ?? null,
        pollOffset: 0,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!channel) throw new Error("Failed to save channel connection");
  return channel;
}

export async function updateWorkspaceChannel(
  id: number,
  data: Partial<{
    status: ChannelStatus;
    displayName: string | null;
    externalId: string | null;
    credentials: Record<string, string>;
    deliveryMode: string;
    pollOffset: number;
    autoReply: boolean;
    lastEventAt: Date | null;
    lastError: string | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [channel] = await db
    .update(workspaceChannels)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(workspaceChannels.id, id))
    .returning();
  return channel ?? null;
}

export async function deleteWorkspaceChannel(
  workspaceId: number,
  provider: ChannelProvider
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .delete(workspaceChannels)
    .where(
      and(
        eq(workspaceChannels.workspaceId, workspaceId),
        eq(workspaceChannels.provider, provider)
      )
    );
}

// ============ Channel Contacts ============

export async function upsertChannelContact(data: {
  workspaceId: number;
  channelId: number;
  provider: ChannelProvider;
  externalId: string;
  externalChatId?: string | null;
  displayName?: string | null;
  username?: string | null;
  locale?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [contact] = await db
    .insert(channelContacts)
    .values({
      workspaceId: data.workspaceId,
      channelId: data.channelId,
      provider: data.provider,
      externalId: data.externalId,
      externalChatId: data.externalChatId ?? null,
      displayName: data.displayName ?? null,
      username: data.username ?? null,
      locale: data.locale ?? null,
      lastMessageAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [channelContacts.channelId, channelContacts.externalId],
      set: {
        externalChatId: data.externalChatId ?? null,
        displayName: data.displayName ?? null,
        username: data.username ?? null,
        locale: data.locale ?? null,
        lastMessageAt: new Date(),
        messageCount: sql`${channelContacts.messageCount} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!contact) throw new Error("Failed to save channel contact");
  return contact;
}

export async function findChannelContact(
  channelId: number,
  externalId: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [contact] = await db
    .select()
    .from(channelContacts)
    .where(
      and(
        eq(channelContacts.channelId, channelId),
        eq(channelContacts.externalId, externalId)
      )
    )
    .limit(1);
  return contact ?? null;
}

export async function getChannelContactById(
  id: number,
  workspaceId?: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [eq(channelContacts.id, id)];
  if (workspaceId !== undefined) {
    conditions.push(eq(channelContacts.workspaceId, workspaceId));
  }
  const [contact] = await db
    .select()
    .from(channelContacts)
    .where(and(...conditions))
    .limit(1);
  return contact ?? null;
}

export async function listWorkspaceContacts(
  workspaceId: number,
  limit = 50
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select({
      id: channelContacts.id,
      provider: channelContacts.provider,
      channelId: channelContacts.channelId,
      displayName: channelContacts.displayName,
      username: channelContacts.username,
      messageCount: channelContacts.messageCount,
      lastMessageAt: channelContacts.lastMessageAt,
      createdAt: channelContacts.createdAt,
      lastMessage: sql<string | null>`(
        select ${chatMessages.content} from ${chatMessages}
        where ${chatMessages.contactId} = ${channelContacts.id}
        order by ${chatMessages.id} desc limit 1
      )`,
    })
    .from(channelContacts)
    .where(eq(channelContacts.workspaceId, workspaceId))
    .orderBy(desc(channelContacts.lastMessageAt))
    .limit(limit);
}

export async function getContactMessages(contactId: number, limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.contactId, contactId))
    .orderBy(desc(chatMessages.id))
    .limit(limit);
  return rows.reverse();
}

// ============ Tickets ============

export async function createTicket(data: {
  workspaceId: number;
  userId: number;
  contactId?: number | null;
  channelId?: number | null;
  title: string;
  description: string;
  priority?: "low" | "medium" | "high" | "urgent";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .insert(tickets)
    .values({
      workspaceId: data.workspaceId,
      userId: data.userId,
      contactId: data.contactId ?? null,
      channelId: data.channelId ?? null,
      title: data.title,
      description: data.description,
      priority: data.priority || "medium",
    })
    .returning({ id: tickets.id });

  return result[0];
}

export async function getTicketById(ticketId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function listTickets(filters?: {
  workspaceId?: number;
  contactId?: number;
  userId?: number;
  status?: string;
  priority?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [];

  if (filters?.workspaceId !== undefined) {
    conditions.push(eq(tickets.workspaceId, filters.workspaceId));
  }
  if (filters?.contactId !== undefined) {
    conditions.push(eq(tickets.contactId, filters.contactId));
  }
  if (filters?.userId) {
    conditions.push(eq(tickets.userId, filters.userId));
  }
  if (filters?.status) {
    conditions.push(eq(tickets.status, filters.status as any));
  }
  if (filters?.priority) {
    conditions.push(eq(tickets.priority, filters.priority as any));
  }
  if (filters?.search) {
    conditions.push(like(tickets.title, `%${filters.search}%`));
  }

  let query: any = db.select().from(tickets);

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  query = query.orderBy(desc(tickets.createdAt));

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.offset(filters.offset);
  }

  return await query;
}

export async function updateTicket(
  ticketId: number,
  data: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    assignedTo: number | null;
    resolvedAt: Date | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;
  if (data.resolvedAt !== undefined) updateData.resolvedAt = data.resolvedAt;
  updateData.updatedAt = new Date();

  return db.update(tickets).set(updateData).where(eq(tickets.id, ticketId));
}

// ============ Knowledge Base ============

const searchableKnowledgeCondition = () =>
  and(
    eq(knowledgeBase.securityStatus, "approved"),
    eq(knowledgeBase.embeddingStatus, "completed")
  );

export const isKnowledgeEntrySearchable = (entry: {
  securityStatus: KnowledgeSecurityStatus;
  embeddingStatus: string;
}) =>
  entry.securityStatus === "approved" &&
  entry.embeddingStatus === "completed";

export async function addKnowledgeEntry(data: {
  workspaceId: number;
  title: string;
  content: string;
  category: string;
  keywords?: string;
  securityStatus?: KnowledgeSecurityStatus;
  securityScannerVersion?: string;
  securityContentHash?: string;
  securityFindings?: KnowledgeSecurityFinding[];
  securityScore?: number;
  securityScannedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [entry] = await tx
      .insert(knowledgeBase)
      .values({
        workspaceId: data.workspaceId,
        title: data.title,
        content: data.content,
        category: data.category,
        keywords: data.keywords,
        securityStatus: data.securityStatus ?? "approved",
        securityScannerVersion:
          data.securityScannerVersion ?? "legacy-approved",
        securityContentHash: data.securityContentHash,
        securityFindings: data.securityFindings ?? [],
        securityScore: data.securityScore ?? 0,
        securityScannedAt: data.securityScannedAt,
        embeddingStatus:
          data.securityStatus && data.securityStatus !== "approved"
            ? "blocked"
            : "pending",
      })
      .returning();

    if (!entry) throw new Error("Failed to create knowledge entry");
    if (data.securityContentHash && data.securityScannerVersion) {
      await tx.insert(knowledgeSecurityEvents).values({
        knowledgeId: entry.id,
        documentId: entry.documentId,
        action: "scan",
        fromStatus: null,
        toStatus: entry.securityStatus,
        scannerVersion: data.securityScannerVersion,
        contentHash: data.securityContentHash,
        findings: data.securityFindings ?? [],
        securityScore: data.securityScore ?? 0,
      });
    }
    return entry;
  });
}

export async function getKnowledgeByCategory(
  workspaceId: number,
  category: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        eq(knowledgeBase.category, category),
        searchableKnowledgeCondition()
      )
    );
}

export async function listKnowledgeEntries(
  workspaceId: number,
  filters?: {
    securityStatus?: KnowledgeSecurityStatus;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [eq(knowledgeBase.workspaceId, workspaceId)];
  if (filters?.securityStatus) {
    conditions.push(eq(knowledgeBase.securityStatus, filters.securityStatus));
  }
  return db
    .select()
    .from(knowledgeBase)
    .where(and(...conditions));
}

export async function getKnowledgeEntryById(id: number, workspaceId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [eq(knowledgeBase.id, id)];
  if (workspaceId !== undefined) {
    conditions.push(eq(knowledgeBase.workspaceId, workspaceId));
  }

  const result = await db
    .select()
    .from(knowledgeBase)
    .where(and(...conditions))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getKnowledgeByIds(workspaceId: number, ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const uniqueIds = Array.from(new Set(ids)).filter(Number.isFinite);
  if (uniqueIds.length === 0) return [];

  return db
    .select()
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        inArray(knowledgeBase.id, uniqueIds),
        searchableKnowledgeCondition()
      )
    );
}

export async function updateKnowledgeEmbedding(
  id: number,
  embedding: number[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(knowledgeBase)
    .set({ embedding, embeddingStatus: "completed", updatedAt: new Date() })
    .where(eq(knowledgeBase.id, id));
}

export async function updateKnowledgeEntry(
  id: number,
  data: Partial<{
    title: string;
    content: string;
    category: string;
    keywords: string | null;
    embedding: number[] | null;
    embeddingStatus: "pending" | "completed" | "failed" | "blocked";
    conflictWith: number | null;
    conflictScore: number | null;
    securityStatus: KnowledgeSecurityStatus;
    securityScannerVersion: string;
    securityContentHash: string | null;
    securityFindings: KnowledgeSecurityFinding[];
    securityScore: number;
    securityReviewedAt: Date | null;
    securityReviewedBy: number | null;
    securityReviewReason: string | null;
    securityScannedAt: Date | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(knowledgeBase)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeBase.id, id));
}

export async function refreshKnowledgeDocumentSecurityCounts(
  documentId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [counts] = await db
    .select({
      approved:
        sql<number>`count(*) filter (where ${knowledgeBase.securityStatus} = 'approved')`.mapWith(
          Number
        ),
      quarantined:
        sql<number>`count(*) filter (where ${knowledgeBase.securityStatus} = 'quarantined')`.mapWith(
          Number
        ),
      rejected:
        sql<number>`count(*) filter (where ${knowledgeBase.securityStatus} = 'rejected')`.mapWith(
          Number
        ),
      pending:
        sql<number>`count(*) filter (where ${knowledgeBase.securityStatus} = 'pending')`.mapWith(
          Number
        ),
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.documentId, documentId));
  await db
    .update(knowledgeDocuments)
    .set({
      approvedChunks: counts?.approved ?? 0,
      quarantinedChunks: counts?.quarantined ?? 0,
      rejectedChunks: counts?.rejected ?? 0,
      pendingSecurityChunks: counts?.pending ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, documentId));
  return counts ?? { approved: 0, quarantined: 0, rejected: 0, pending: 0 };
}

export async function appendKnowledgeSecurityEvent(data: {
  knowledgeId: number;
  documentId?: number | null;
  action: "scan" | "rescan" | "approve" | "reject";
  fromStatus?: KnowledgeSecurityStatus | null;
  toStatus: KnowledgeSecurityStatus;
  scannerVersion: string;
  contentHash: string;
  findings?: KnowledgeSecurityFinding[];
  securityScore?: number;
  reason?: string | null;
  actorUserId?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [event] = await db
    .insert(knowledgeSecurityEvents)
    .values({ ...data, findings: data.findings ?? [], securityScore: data.securityScore ?? 0 })
    .returning();
  return event;
}

export async function getKnowledgeSecurityHistory(knowledgeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(knowledgeSecurityEvents)
    .where(eq(knowledgeSecurityEvents.knowledgeId, knowledgeId))
    .orderBy(desc(knowledgeSecurityEvents.createdAt));
}

export async function applyKnowledgeSecurityDecision(data: {
  knowledgeId: number;
  expectedContentHash: string;
  toStatus: "approved" | "rejected";
  reason: string;
  actorUserId: number;
  scannerVersion: string;
  findings: KnowledgeSecurityFinding[];
  securityScore: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, data.knowledgeId))
      .limit(1);
    if (!current) return { outcome: "not_found" as const };
    if (current.securityContentHash !== data.expectedContentHash) {
      return { outcome: "content_changed" as const, entry: current };
    }
    const [entry] = await tx
      .update(knowledgeBase)
      .set({
        securityStatus: data.toStatus,
        securityReviewedAt: new Date(),
        securityReviewedBy: data.actorUserId,
        securityReviewReason: data.reason,
        embedding:
          data.toStatus === "approved" ? current.embedding : null,
        embeddingStatus:
          data.toStatus === "approved" ? "pending" : "blocked",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeBase.id, data.knowledgeId),
          eq(knowledgeBase.securityContentHash, data.expectedContentHash)
        )
      )
      .returning();
    if (!entry) return { outcome: "content_changed" as const };
    await tx.insert(knowledgeSecurityEvents).values({
      knowledgeId: entry.id,
      documentId: entry.documentId,
      action: data.toStatus === "approved" ? "approve" : "reject",
      fromStatus: current.securityStatus,
      toStatus: data.toStatus,
      scannerVersion: data.scannerVersion,
      contentHash: data.expectedContentHash,
      findings: data.findings,
      securityScore: data.securityScore,
      reason: data.reason,
      actorUserId: data.actorUserId,
    });
    return { outcome: "updated" as const, entry };
  });
}

// ============ Knowledge Documents（上传文档） ============

export async function createKnowledgeDocument(data: {
  workspaceId: number;
  filename: string;
  fileType: string;
  uploadedBy?: number;
  status?: KnowledgeDocumentStatus;
  fileSize?: number;
  uploadPartSize?: number;
  contentType?: string;
  category?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .insert(knowledgeDocuments)
    .values({
      workspaceId: data.workspaceId,
      filename: data.filename,
      fileType: data.fileType,
      status: data.status ?? "parsing",
      uploadedBy: data.uploadedBy,
      fileSize: data.fileSize,
      uploadPartSize: data.uploadPartSize,
      contentType: data.contentType,
      category: data.category,
    })
    .returning({ id: knowledgeDocuments.id });

  return result[0];
}

export async function updateKnowledgeDocument(
  id: number,
  data: Partial<{
    status: KnowledgeDocumentStatus;
    totalChunks: number;
    parsedChunks: number;
    approvedChunks: number;
    quarantinedChunks: number;
    rejectedChunks: number;
    pendingSecurityChunks: number;
    uploadedBytes: number;
    objectKey: string | null;
    uploadId: string | null;
    uploadVersion: number;
    failureStage: string | null;
    error: string | null;
    completedAt: Date | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(knowledgeDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(knowledgeDocuments.id, id));
}

export async function updateKnowledgeDocumentStatusIfCurrent(
  id: number,
  currentStatus: KnowledgeDocumentStatus,
  data: Partial<{
    status: KnowledgeDocumentStatus;
    failureStage: string | null;
    error: string | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .update(knowledgeDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeDocuments.id, id),
        eq(knowledgeDocuments.status, currentStatus)
      )
    );
}

export async function getKnowledgeDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function listExpiredKnowledgeUploadSessions(
  before: Date,
  limit = 100
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.status, "uploading"),
        lt(knowledgeDocuments.updatedAt, before)
      )
    )
    .limit(limit);
}

export async function listKnowledgeDocuments(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.workspaceId, workspaceId))
    .orderBy(desc(knowledgeDocuments.createdAt));

  const counts = await db
    .select({
      documentId: knowledgeBase.documentId,
      embeddedCount:
        sql<number>`count(*) filter (where ${knowledgeBase.embeddingStatus} = 'completed')`.mapWith(
          Number
        ),
      failedCount:
        sql<number>`count(*) filter (where ${knowledgeBase.embeddingStatus} = 'failed')`.mapWith(
          Number
        ),
    })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        isNotNull(knowledgeBase.documentId)
      )
    )
    .groupBy(knowledgeBase.documentId);

  const countMap = new Map(counts.map(c => [c.documentId, c]));

  return docs.map(doc => ({
    ...doc,
    embeddedCount: countMap.get(doc.id)?.embeddedCount ?? 0,
    failedCount: countMap.get(doc.id)?.failedCount ?? 0,
  }));
}

export async function addKnowledgeEntriesBatch(
  workspaceId: number,
  documentId: number,
  entries: Array<{
    title: string;
    content: string;
    category: string;
    keywords?: string;
    securityStatus: KnowledgeSecurityStatus;
    securityScannerVersion: string;
    securityContentHash: string;
    securityFindings: KnowledgeSecurityFinding[];
    securityScore: number;
    securityScannedAt: Date;
  }>,
  embeddingStatus: "pending" | "completed" = "pending"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (entries.length === 0) return [];

  const inserted = await db.transaction(async tx => {
    const rows = await tx
      .insert(knowledgeBase)
      .values(
        entries.map(entry => ({
          workspaceId,
          title: entry.title,
          content: entry.content,
          category: entry.category,
          keywords: entry.keywords,
          documentId,
          embeddingStatus:
            entry.securityStatus === "approved" ? embeddingStatus : "blocked",
          securityStatus: entry.securityStatus,
          securityScannerVersion: entry.securityScannerVersion,
          securityContentHash: entry.securityContentHash,
          securityFindings: entry.securityFindings,
          securityScore: entry.securityScore,
          securityScannedAt: entry.securityScannedAt,
        }))
      )
      .returning();
    await tx.insert(knowledgeSecurityEvents).values(
      rows.map(row => ({
        knowledgeId: row.id,
        documentId,
        action: "scan" as const,
        fromStatus: null,
        toStatus: row.securityStatus,
        scannerVersion: row.securityScannerVersion,
        contentHash: row.securityContentHash!,
        findings: row.securityFindings,
        securityScore: row.securityScore,
      }))
    );
    return rows;
  });
  return inserted;
}

export async function deleteKnowledgeEntriesByDocument(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .delete(knowledgeBase)
    .where(eq(knowledgeBase.documentId, documentId));
}

export async function getKnowledgeEntriesByIds(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (ids.length === 0) return [];
  return db
    .select()
    .from(knowledgeBase)
    .where(
      and(
        inArray(knowledgeBase.id, ids),
        eq(knowledgeBase.securityStatus, "approved")
      )
    );
}

export async function getKnowledgeDocumentEmbeddingCounts(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [counts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      completed:
        sql<number>`count(*) filter (where ${knowledgeBase.embeddingStatus} = 'completed')`.mapWith(
          Number
        ),
      failed:
        sql<number>`count(*) filter (where ${knowledgeBase.embeddingStatus} = 'failed')`.mapWith(
          Number
        ),
    })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.documentId, documentId),
        eq(knowledgeBase.securityStatus, "approved")
      )
    );
  return counts ?? { total: 0, completed: 0, failed: 0 };
}

export async function setKnowledgeEntryEmbedding(
  id: number,
  embedding: number[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(knowledgeBase)
    .set({ embedding, embeddingStatus: "completed", updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeBase.id, id),
        eq(knowledgeBase.securityStatus, "approved")
      )
    );
}

export async function setKnowledgeEntryStatus(
  id: number,
  status: "pending" | "completed" | "failed" | "blocked"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(knowledgeBase)
    .set({ embeddingStatus: status, updatedAt: new Date() })
    .where(eq(knowledgeBase.id, id));
}

/** 余弦相似度高于该阈值即视为内容冲突/重复。 */
export const CONFLICT_SIMILARITY_THRESHOLD = 0.88;

/**
 * 判定某条目是否与「已有条目」冲突：
 * 1) 向量最近邻余弦相似度 ≥ 阈值，或
 * 2) 归一化标题（trim + lower）完全相同。
 * 比较范围排除自身与同一文档内的条目，聚焦与已存在内容的冲突。
 */
export async function detectEntryConflict(
  entry: {
    id: number;
    workspaceId: number;
    title: string;
    documentId: number | null;
    embedding: number[] | null;
  },
  threshold = CONFLICT_SIMILARITY_THRESHOLD
): Promise<{ conflictWith: number; conflictScore: number } | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const sameWorkspace = eq(knowledgeBase.workspaceId, entry.workspaceId);
  const notSameDoc =
    entry.documentId == null
      ? sql`true`
      : sql`${knowledgeBase.documentId} IS DISTINCT FROM ${entry.documentId}`;
  const notSelf = sql`${knowledgeBase.id} <> ${entry.id}`;

  // 1) 向量最近邻
  if (entry.embedding) {
    const distance = cosineDistance(knowledgeBase.embedding, entry.embedding);
    const rows = await db
      .select({ id: knowledgeBase.id, distance })
      .from(knowledgeBase)
      .where(
        and(
          sameWorkspace,
          isNotNull(knowledgeBase.embedding),
          searchableKnowledgeCondition(),
          notSelf,
          notSameDoc
        )
      )
      .orderBy(distance)
      .limit(1);

    const top = rows[0];
    if (top) {
      const score = 1 - Number(top.distance);
      if (score >= threshold) {
        return { conflictWith: top.id, conflictScore: score };
      }
    }
  }

  // 2) 归一化标题精确匹配
  const titleRows = await db
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(
      and(
        sameWorkspace,
        notSelf,
        notSameDoc,
        searchableKnowledgeCondition(),
        sql`lower(btrim(${knowledgeBase.title})) = lower(btrim(${entry.title}))`
      )
    )
    .limit(1);

  if (titleRows[0]) {
    return { conflictWith: titleRows[0].id, conflictScore: 1 };
  }

  return null;
}

export async function setEntryConflict(
  id: number,
  conflictWith: number | null,
  conflictScore: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(knowledgeBase)
    .set({ conflictWith, conflictScore })
    .where(eq(knowledgeBase.id, id));
}

export async function deleteKnowledgeEntry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const rows = await tx
      .select({ documentId: knowledgeBase.documentId })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, id))
      .limit(1);

    await tx.delete(knowledgeBase).where(eq(knowledgeBase.id, id));

    // Keep the source document's progress denominator consistent.
    const documentId = rows[0]?.documentId;
    if (documentId != null) {
      await tx
        .update(knowledgeDocuments)
        .set({
          totalChunks: sql`GREATEST(${knowledgeDocuments.totalChunks} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeDocuments.id, documentId));
    }
  });
}

export async function deleteKnowledgeDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    await tx.delete(knowledgeBase).where(eq(knowledgeBase.documentId, id));
    await tx.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
  });
}

async function fallbackSearchKnowledge(
  workspaceId: number,
  query: string,
  limit: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const entries = await db
    .select()
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        searchableKnowledgeCondition()
      )
    );
  const ranked = rankKnowledgeEntriesByKeyword(query, entries, limit);
  if (ranked.length > 0) return ranked;

  return db
    .select()
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        like(knowledgeBase.title, `%${query}%`),
        searchableKnowledgeCondition()
      )
    )
    .limit(limit);
}

export async function searchKnowledgeByKeyword(
  workspaceId: number,
  query: string,
  limit = 5
) {
  return fallbackSearchKnowledge(workspaceId, query, limit);
}

type KeywordSearchEntry = {
  title: string;
  content: string;
  category: string;
  keywords?: string | null;
};

const normalizeSearchText = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "");

const getSearchTerms = (query: string, entries: KeywordSearchEntry[]) => {
  const normalizedQuery = normalizeSearchText(query);
  const terms = new Set<string>();

  for (const part of query
    .toLowerCase()
    .split(/[,\s，。！？!?、;；:：/\\|]+/)) {
    const term = part.trim();
    if (term.length >= 2) terms.add(term);
  }

  for (const entry of entries) {
    const candidates = [
      entry.title,
      entry.category,
      ...(entry.keywords ?? "").split(/[,\s，、]+/),
    ];

    for (const candidate of candidates) {
      const term = normalizeSearchText(candidate);
      if (term.length >= 2 && normalizedQuery.includes(term)) {
        terms.add(term);
      }
    }
  }

  return Array.from(terms);
};

export function rankKnowledgeEntriesByKeyword<T extends KeywordSearchEntry>(
  query: string,
  entries: T[],
  limit = 5
) {
  return scoreKnowledgeEntriesByKeyword(query, entries, limit).map(
    item => item.entry
  );
}

export function scoreKnowledgeEntriesByKeyword<T extends KeywordSearchEntry>(
  query: string,
  entries: T[],
  limit = 5
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const terms = getSearchTerms(query, entries);

  return entries
    .map(entry => {
      const title = normalizeSearchText(entry.title);
      const category = normalizeSearchText(entry.category);
      const keywords = normalizeSearchText(entry.keywords ?? "");
      const content = normalizeSearchText(entry.content);

      let score = 0;
      if (title.includes(normalizedQuery)) score += 10;
      if (keywords.includes(normalizedQuery)) score += 8;
      if (content.includes(normalizedQuery)) score += 4;

      for (const term of terms) {
        if (title.includes(term)) score += 6;
        if (keywords.includes(term)) score += 5;
        if (category.includes(term)) score += 3;
        if (content.includes(term)) score += 1;
      }

      return { entry, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type KnowledgeRetrievalMode = "vector" | "keyword";
export type KnowledgeFallbackReason =
  | "embedding_disabled"
  | "vector_error"
  | "no_vector_results";

export type KnowledgeRetrieval = {
  mode: KnowledgeRetrievalMode;
  degraded: boolean;
  fallbackReason: KnowledgeFallbackReason | null;
};

export type KnowledgeSearchResult = {
  entries: Array<typeof knowledgeBase.$inferSelect>;
  retrieval: KnowledgeRetrieval;
};

const vectorRetrieval = (): KnowledgeRetrieval => ({
  mode: "vector",
  degraded: false,
  fallbackReason: null,
});

const keywordRetrieval = (
  fallbackReason: KnowledgeFallbackReason
): KnowledgeRetrieval => ({
  mode: "keyword",
  degraded: true,
  fallbackReason,
});

export async function searchKnowledgeWithMeta(
  workspaceId: number,
  query: string,
  limit = 5
): Promise<KnowledgeSearchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!isEmbeddingEnabled()) {
    return {
      entries: await fallbackSearchKnowledge(workspaceId, query, limit),
      retrieval: keywordRetrieval("embedding_disabled"),
    };
  }

  try {
    const queryEmbedding = await createEmbedding(query, "query");
    const distance = cosineDistance(knowledgeBase.embedding, queryEmbedding);
    const scored = await db
      .select()
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.workspaceId, workspaceId),
          isNotNull(knowledgeBase.embedding),
          searchableKnowledgeCondition()
        )
      )
      .orderBy(distance, desc(knowledgeBase.updatedAt))
      .limit(limit);

    if (scored.length > 0) {
      return { entries: scored, retrieval: vectorRetrieval() };
    }

    return {
      entries: await fallbackSearchKnowledge(workspaceId, query, limit),
      retrieval: keywordRetrieval("no_vector_results"),
    };
  } catch (error) {
    logWarn("[RAG] Vector search failed, falling back to keyword search", {
      error,
    });
    return {
      entries: await fallbackSearchKnowledge(workspaceId, query, limit),
      retrieval: keywordRetrieval("vector_error"),
    };
  }
}

/** Legacy array-only API for non-chat consumers such as MCP. */
export async function searchKnowledge(
  workspaceId: number,
  query: string,
  limit = 5
) {
  const result = await searchKnowledgeWithMeta(workspaceId, query, limit);
  return result.entries;
}

export async function debugSearchKnowledge(
  workspaceId: number,
  query: string,
  limit = 5
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const keywordFallback = async (reason: string) => {
    const entries = await db
      .select()
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.workspaceId, workspaceId),
          searchableKnowledgeCondition()
        )
      );
    const scored = scoreKnowledgeEntriesByKeyword(query, entries, limit);

    return {
      mode: "keyword" as const,
      fallbackReason: reason,
      results: scored.map(item => {
        const { embedding: _embedding, ...entry } =
          item.entry as typeof item.entry & {
            embedding?: unknown;
          };
        return {
          ...entry,
          score: item.score,
          distance: null as number | null,
        };
      }),
    };
  };

  if (!isEmbeddingEnabled()) {
    return keywordFallback("embedding_disabled");
  }

  try {
    const queryEmbedding = await createEmbedding(query, "query");
    const distance = cosineDistance(knowledgeBase.embedding, queryEmbedding);
    const scored = await db
      .select({
        id: knowledgeBase.id,
        title: knowledgeBase.title,
        content: knowledgeBase.content,
        category: knowledgeBase.category,
        keywords: knowledgeBase.keywords,
        embeddingStatus: knowledgeBase.embeddingStatus,
        documentId: knowledgeBase.documentId,
        conflictWith: knowledgeBase.conflictWith,
        conflictScore: knowledgeBase.conflictScore,
        createdAt: knowledgeBase.createdAt,
        updatedAt: knowledgeBase.updatedAt,
        distance,
      })
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.workspaceId, workspaceId),
          isNotNull(knowledgeBase.embedding),
          searchableKnowledgeCondition()
        )
      )
      .orderBy(distance, desc(knowledgeBase.updatedAt))
      .limit(limit);

    if (scored.length === 0) {
      return keywordFallback("no_vector_results");
    }

    return {
      mode: "vector" as const,
      fallbackReason: null as string | null,
      results: scored.map(entry => ({
        ...entry,
        score: 1 - Number(entry.distance),
        distance: Number(entry.distance),
      })),
    };
  } catch (error) {
    logWarn(
      "[RAG] Debug vector search failed, falling back to keyword search",
      {
        error,
      }
    );
    return keywordFallback(
      error instanceof Error ? error.message : "vector_search_failed"
    );
  }
}

// ============ Chat Messages ============

export async function saveChatMessage(data: {
  workspaceId: number;
  ticketId?: number;
  userId: number;
  contactId?: number | null;
  channelId?: number | null;
  role: "user" | "assistant";
  content: string;
  relatedKnowledgeIds?: number[];
  relatedKnowledgeSnapshot?: Array<{
    id: number;
    title: string;
    category: string;
  }>;
  agentRunId?: string;
  llmProvider?: string;
  llmModel?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const query = db.insert(chatMessages).values({
    workspaceId: data.workspaceId,
    ticketId: data.ticketId,
    userId: data.userId,
    contactId: data.contactId ?? null,
    channelId: data.channelId ?? null,
    role: data.role,
    content: data.content,
    relatedKnowledgeIds: data.relatedKnowledgeIds ?? null,
    relatedKnowledgeSnapshot: data.relatedKnowledgeSnapshot ?? null,
    agentRunId: data.agentRunId,
    llmProvider: data.llmProvider,
    llmModel: data.llmModel,
  });

  return data.agentRunId ? query.onConflictDoNothing() : query;
}

/**
 * A conversation thread is identified by workspace plus who is on the other end:
 * `contactId` set means an external visitor from a channel, `contactId` unset
 * means the workspace owner's own console thread. The two never mix.
 */
export type ChatThreadScope = {
  workspaceId: number;
  contactId?: number | null;
  ticketId?: number;
};

const chatThreadConditions = (scope: ChatThreadScope) => {
  const conditions = [eq(chatMessages.workspaceId, scope.workspaceId)];
  conditions.push(
    scope.contactId == null
      ? isNull(chatMessages.contactId)
      : eq(chatMessages.contactId, scope.contactId)
  );
  if (scope.ticketId) {
    conditions.push(eq(chatMessages.ticketId, scope.ticketId));
  }
  return conditions;
};

export async function getChatHistory(scope: ChatThreadScope, limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(...chatThreadConditions(scope)))
    .orderBy(desc(chatMessages.id))
    .limit(limit);

  return rows.reverse();
}

export async function getTicketChatHistory(
  workspaceId: number,
  ticketId: number,
  limit = 100
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.workspaceId, workspaceId),
        eq(chatMessages.ticketId, ticketId)
      )
    )
    .orderBy(desc(chatMessages.id))
    .limit(limit);

  return rows.reverse();
}

export async function getRecentChatHistory(
  scope: ChatThreadScope,
  limit = 10
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(...chatThreadConditions(scope)))
    .orderBy(desc(chatMessages.id))
    .limit(limit);

  return rows.reverse();
}

// ============ Agent Runs ============

export type AgentRunStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "failed"
  | "completed";

export type AgentRunStepType =
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "final"
  | "error";

/**
 * The plan sets the daily token allowance. `AGENT_DAILY_TOKEN_QUOTA` acts as a
 * hard ceiling on top of it — a self-hosted operator can cap everyone without
 * having to redefine the plan catalog — rather than replacing the plan, so
 * plans still differentiate below that ceiling. 0 means "no limit" on both
 * sides, which is how the quota code already reads it.
 */
export const resolvePlanDailyTokens = (plan: WorkspacePlan) => {
  const planLimit = PLANS[plan].limits.dailyTokens;
  const planTokens = Number.isFinite(planLimit) ? planLimit : 0;
  const envCeiling = ENV.agentDailyTokenQuota;
  if (envCeiling <= 0) return planTokens;
  if (planTokens <= 0) return envCeiling;
  return Math.min(planTokens, envCeiling);
};

const quotaSnapshotFromBucket = (input: {
  bucketDate: string;
  quotaLimitTokens: number;
  reservedTokens: number;
  usedTokens: number;
  enforced: boolean;
  adminExempt: boolean;
}): TokenQuotaSnapshot => ({
  ...input,
  resetAt: utcResetAtFromDay(input.bucketDate),
  remainingTokens:
    input.quotaLimitTokens > 0
      ? Math.max(
          0,
          input.quotaLimitTokens - input.usedTokens - input.reservedTokens
        )
      : null,
});

const reserveAgentRunAttempt = async (
  tx: any,
  input: {
    runId: string;
    userId: number;
    attemptNumber: number;
    llmProvider?: string | null;
    llmModel?: string | null;
    quotaLimitTokens: number;
    enforced: boolean;
    adminExempt: boolean;
    reservationTokens: number;
  }
) => {
  const [clock] = await tx.execute(sql<{
    bucket_date: string;
  }>`select (current_timestamp at time zone 'UTC')::date::text as bucket_date`);
  const bucketDate = String(clock.bucket_date);

  await tx
    .insert(agentTokenDailyBuckets)
    .values({
      userId: input.userId,
      bucketDate,
      quotaLimitTokens: input.quotaLimitTokens,
    })
    .onConflictDoNothing();

  const [bucket] = await tx
    .select()
    .from(agentTokenDailyBuckets)
    .where(
      and(
        eq(agentTokenDailyBuckets.userId, input.userId),
        eq(agentTokenDailyBuckets.bucketDate, bucketDate)
      )
    )
    .limit(1)
    .for("update");
  if (!bucket) throw new Error("Failed to create token quota bucket");

  const snapshot = quotaSnapshotFromBucket({
    bucketDate,
    quotaLimitTokens: input.quotaLimitTokens,
    reservedTokens: bucket.reservedTokens,
    usedTokens: bucket.usedTokens,
    enforced: input.enforced,
    adminExempt: input.adminExempt,
  });
  if (
    shouldRejectTokenReservation({
      ...snapshot,
      requestedTokens: input.reservationTokens,
    })
  ) {
    throw new TokenQuotaExceededError(snapshot);
  }

  await tx
    .update(agentTokenDailyBuckets)
    .set({
      quotaLimitTokens: input.quotaLimitTokens,
      reservedTokens: sql`${agentTokenDailyBuckets.reservedTokens} + ${input.reservationTokens}`,
      updatedAt: new Date(),
    })
    .where(eq(agentTokenDailyBuckets.id, bucket.id));
  await tx.insert(agentTokenAttemptLedgers).values({
    runId: input.runId,
    userId: input.userId,
    attemptNumber: input.attemptNumber,
    bucketDate,
    reservedTokens: input.reservationTokens,
    llmProvider: input.llmProvider,
    llmModel: input.llmModel,
  });

  return {
    bucketDate,
    quotaLimitTokens: input.quotaLimitTokens,
    quotaEnforced: input.enforced,
    quotaAdminExempt: input.adminExempt,
    reservedTokens: input.reservationTokens,
    usageState: "reserved" as const,
  };
};

export async function createAgentRun(data: {
  workspaceId: number;
  userId: number;
  plan?: WorkspacePlan;
  contactId?: number | null;
  channelId?: number | null;
  ticketId?: number;
  input: string;
  status?: AgentRunStatus;
  llmProvider?: string;
  llmModel?: string;
  retryOfRunId?: string;
  traceId?: string;
  spanId?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const runId = randomUUID();
    const quotaLimitTokens = resolvePlanDailyTokens(data.plan ?? "free");
    const quotaEnforced = ENV.agentTokenQuotaEnforcement;
    // No cross-workspace administrator exists, so nobody is exempt from quota.
    const quotaAdminExempt = false;
    const [created] = await tx
      .insert(agentRuns)
      .values({
        id: runId,
        workspaceId: data.workspaceId,
        userId: data.userId,
        contactId: data.contactId ?? null,
        channelId: data.channelId ?? null,
        ticketId: data.ticketId,
        input: data.input,
        status: data.status ?? "queued",
        llmProvider: data.llmProvider,
        llmModel: data.llmModel,
        retryOfRunId: data.retryOfRunId,
        traceId: data.traceId,
        spanId: data.spanId,
        attemptCount: 1,
        metadata: data.metadata
          ? (JSON.stringify(data.metadata) as any)
          : undefined,
      })
      .returning({ id: agentRuns.id });
    if (!created) throw new Error("Failed to create Agent Run");
    const quota = await reserveAgentRunAttempt(tx, {
      runId,
      userId: data.userId,
      attemptNumber: 1,
      llmProvider: data.llmProvider,
      llmModel: data.llmModel,
      quotaLimitTokens,
      enforced: quotaEnforced,
      adminExempt: quotaAdminExempt,
      reservationTokens: ENV.agentRunTokenReservation,
    });
    const [run] = await tx
      .update(agentRuns)
      .set(quota)
      .where(eq(agentRuns.id, runId))
      .returning();
    if (!run) throw new Error("Failed to initialize Agent Run quota");
    return run;
  });
}

export async function updateAgentRun(
  id: string,
  data: Partial<{
    status: AgentRunStatus;
    finalOutput: string | null;
    error: string | null;
    llmProvider: string | null;
    llmModel: string | null;
    completedAt: Date | null;
    startedAt: Date | null;
    durationMs: number | null;
    traceId: string | null;
    spanId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    countedTokens: number | null;
    usageState: TokenUsageState;
    llmRequestCount: number | null;
    contextWindowTokens: number | null;
    metadata: Record<string, unknown> | null;
  }>,
  executionFence?: AgentRunExecutionFence
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: Record<string, unknown> = {
    ...data,
    updatedAt: new Date(),
  };
  if (data.metadata !== undefined && data.metadata !== null) {
    updateData.metadata = JSON.stringify(data.metadata);
  }

  const conditions = [eq(agentRuns.id, id)];
  if (executionFence) {
    conditions.push(
      eq(agentRuns.leaseOwner, executionFence.workerId),
      eq(agentRuns.attemptCount, executionFence.attemptCount),
      gt(agentRuns.leaseExpiresAt, new Date())
    );
  }

  return db
    .update(agentRuns)
    .set(updateData as any)
    .where(and(...conditions))
    .returning({ id: agentRuns.id });
}

export async function addAgentRunStep(data: {
  runId: string;
  stepType: AgentRunStepType;
  toolName?: string;
  argsSummary?: string;
  resultSummary?: string;
  content?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = {
    ...data,
    metadata: data.metadata
      ? (JSON.stringify(data.metadata) as any)
      : undefined,
  };

  const result = await db
    .insert(agentRunSteps)
    .values(values)
    .returning({ id: agentRunSteps.id });

  return result[0];
}

export async function getAgentRunById(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/** Console-side resume list: only the owner's own threads, not channel traffic. */
export async function listActiveAgentRunsForWorkspace(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      input: agentRuns.input,
      ticketId: agentRuns.ticketId,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.workspaceId, workspaceId),
        isNull(agentRuns.contactId),
        inArray(agentRuns.status, [
          "queued",
          "planning",
          "running",
          "waiting_approval",
        ])
      )
    )
    .orderBy(desc(agentRuns.createdAt));
}

export async function getAgentRunSteps(runId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, runId))
    .orderBy(agentRunSteps.createdAt, agentRunSteps.id);
}

export async function getAgentRunAttempts(runId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(agentTokenAttemptLedgers)
    .where(eq(agentTokenAttemptLedgers.runId, runId))
    .orderBy(agentTokenAttemptLedgers.attemptNumber);
}

export async function getTokenQuota(
  userId: number,
  plan: WorkspacePlan = "free"
): Promise<TokenQuotaSnapshot> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const clockResult = await db.execute(sql<{ bucket_date: string }>`
    select (current_timestamp at time zone 'UTC')::date::text as bucket_date
  `);
  const bucketDate = String(clockResult[0]?.bucket_date);
  const [bucket] = await db
    .select()
    .from(agentTokenDailyBuckets)
    .where(
      and(
        eq(agentTokenDailyBuckets.userId, userId),
        eq(agentTokenDailyBuckets.bucketDate, bucketDate)
      )
    )
    .limit(1);
  return quotaSnapshotFromBucket({
    bucketDate,
    quotaLimitTokens: resolvePlanDailyTokens(plan),
    reservedTokens: bucket?.reservedTokens ?? 0,
    usedTokens: bucket?.usedTokens ?? 0,
    enforced: ENV.agentTokenQuotaEnforcement,
    adminExempt: false,
  });
}

export async function getAgentRunWithSteps(id: string) {
  const run = await getAgentRunById(id);
  if (!run) return null;

  const [steps, attempts] = await Promise.all([
    getAgentRunSteps(id),
    getAgentRunAttempts(id),
  ]);
  return {
    ...run,
    steps,
    attempts,
  };
}

export async function getAgentRunSummaries(ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      llmProvider: agentRuns.llmProvider,
      llmModel: agentRuns.llmModel,
      traceId: agentRuns.traceId,
      durationMs: agentRuns.durationMs,
      inputTokens: agentRuns.inputTokens,
      outputTokens: agentRuns.outputTokens,
      totalTokens: agentRuns.totalTokens,
      countedTokens: agentRuns.countedTokens,
      usageState: agentRuns.usageState,
      llmRequestCount: agentRuns.llmRequestCount,
      contextWindowTokens: agentRuns.contextWindowTokens,
      createdAt: agentRuns.createdAt,
      completedAt: agentRuns.completedAt,
    })
    .from(agentRuns)
    .where(inArray(agentRuns.id, ids));
}

export async function getAgentRunRootId(runId: string) {
  let currentId = runId;
  const visited = new Set<string>();

  for (let depth = 0; depth < 25; depth++) {
    if (visited.has(currentId))
      throw new Error("Agent Run retry chain contains a cycle");
    visited.add(currentId);

    const run = await getAgentRunById(currentId);
    if (!run) throw new Error("Agent Run not found");
    if (!run.retryOfRunId) return run.id;
    currentId = run.retryOfRunId;
  }

  throw new Error("Agent Run retry chain is too deep");
}

export type AgentRunExecutionFence = {
  workerId: string;
  attemptCount: number;
};

const attemptFenceConditions = (
  runId: string,
  attemptNumber: number,
  executionFence?: AgentRunExecutionFence
) => {
  const conditions = [
    eq(agentRuns.id, runId),
    eq(agentRuns.attemptCount, attemptNumber),
  ];
  if (executionFence) {
    conditions.push(
      eq(agentRuns.leaseOwner, executionFence.workerId),
      gt(agentRuns.leaseExpiresAt, new Date())
    );
  }
  return conditions;
};

export async function markAgentRunModelStarted(
  runId: string,
  attemptNumber: number,
  executionFence?: AgentRunExecutionFence
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [run] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(...attemptFenceConditions(runId, attemptNumber, executionFence)))
      .limit(1)
      .for("update");
    if (!run) return false;
    const [ledger] = await tx
      .update(agentTokenAttemptLedgers)
      .set({ modelStartedAt: sql`coalesce(${agentTokenAttemptLedgers.modelStartedAt}, current_timestamp)` })
      .where(
        and(
          eq(agentTokenAttemptLedgers.runId, runId),
          eq(agentTokenAttemptLedgers.attemptNumber, attemptNumber),
          eq(agentTokenAttemptLedgers.status, "reserved")
        )
      )
      .returning({ id: agentTokenAttemptLedgers.id });
    return Boolean(ledger);
  });
}

const settleAgentRunAttemptInTransaction = async (
  tx: any,
  input: {
    runId: string;
    attemptNumber: number;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    executionFence?: AgentRunExecutionFence;
  }
) => {
  const [run] = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        ...attemptFenceConditions(
          input.runId,
          input.attemptNumber,
          input.executionFence
        )
      )
    )
    .limit(1)
    .for("update");
  if (!run) return null;
  const [ledger] = await tx
    .select()
    .from(agentTokenAttemptLedgers)
    .where(
      and(
        eq(agentTokenAttemptLedgers.runId, input.runId),
        eq(agentTokenAttemptLedgers.attemptNumber, input.attemptNumber)
      )
    )
    .limit(1)
    .for("update");
  if (!ledger) throw new Error("Agent token attempt ledger not found");
  if (ledger.status !== "reserved") return ledger.usageState;

  const settlement = getTokenSettlement({
    reservedTokens: ledger.reservedTokens,
    modelStarted: Boolean(ledger.modelStartedAt),
    usage: input.usage,
  });
  await tx
    .update(agentTokenDailyBuckets)
    .set({
      reservedTokens: sql`greatest(0, ${agentTokenDailyBuckets.reservedTokens} - ${ledger.reservedTokens})`,
      usedTokens: sql`${agentTokenDailyBuckets.usedTokens} + ${settlement.countedTokens}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentTokenDailyBuckets.userId, ledger.userId),
        eq(agentTokenDailyBuckets.bucketDate, ledger.bucketDate)
      )
    );
  await tx
    .update(agentTokenAttemptLedgers)
    .set({
      status: "settled",
      ...settlement,
      settledAt: new Date(),
    })
    .where(eq(agentTokenAttemptLedgers.id, ledger.id));
  await tx
    .update(agentRuns)
    .set({
      usageState: settlement.usageState,
      countedTokens: settlement.countedTokens,
      inputTokens: settlement.inputTokens,
      outputTokens: settlement.outputTokens,
      totalTokens: settlement.totalTokens,
      updatedAt: new Date(),
    })
    .where(eq(agentRuns.id, input.runId));
  return settlement.usageState;
};

export async function finalizeFailedAgentRun(data: {
  runId: string;
  attemptNumber: number;
  error: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationMs?: number;
  finalOutput?: string;
  metadata?: Record<string, unknown>;
  assistantMessage?: {
    ticketId?: number;
    userId: number;
    content: string;
    llmProvider: string;
    llmModel: string;
  };
  executionFence?: AgentRunExecutionFence;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const usageState = await settleAgentRunAttemptInTransaction(tx, data);
    if (!usageState) return false;
    if (data.assistantMessage) {
      const [run] = await tx
        .select({
          workspaceId: agentRuns.workspaceId,
          contactId: agentRuns.contactId,
          channelId: agentRuns.channelId,
        })
        .from(agentRuns)
        .where(eq(agentRuns.id, data.runId))
        .limit(1);
      if (run) {
        await tx
          .insert(chatMessages)
          .values({
            workspaceId: run.workspaceId,
            ticketId: data.assistantMessage.ticketId,
            userId: data.assistantMessage.userId,
            contactId: run.contactId,
            channelId: run.channelId,
            role: "assistant",
            content: data.assistantMessage.content,
            agentRunId: data.runId,
            llmProvider: data.assistantMessage.llmProvider,
            llmModel: data.assistantMessage.llmModel,
          })
          .onConflictDoNothing();
      }
    }
    await tx
      .update(agentRuns)
      .set({
        status: "failed",
        error: data.error,
        finalOutput: data.finalOutput,
        metadata: data.metadata
          ? (JSON.stringify(data.metadata) as any)
          : undefined,
        durationMs: data.durationMs,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, data.runId));
    return true;
  });
}

export async function completeAgentRunWithMessage(data: {
  runId: string;
  attemptNumber: number;
  executionFence?: AgentRunExecutionFence;
  ticketId?: number;
  userId: number;
  content: string;
  relatedKnowledgeIds: number[];
  relatedKnowledgeSnapshot: Array<{
    id: number;
    title: string;
    category: string;
  }>;
  llmProvider: string;
  llmModel: string;
  traceId?: string | null;
  spanId?: string | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmRequestCount: number;
  contextWindowTokens: number;
  metadata: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const usageState = await settleAgentRunAttemptInTransaction(tx, {
      runId: data.runId,
      attemptNumber: data.attemptNumber,
      executionFence: data.executionFence,
      usage: {
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens,
      },
    });
    if (!usageState) return false;

    // Thread placement comes from the run itself so the reply always lands in the
    // same workspace/contact thread the question arrived on.
    const [run] = await tx
      .select({
        workspaceId: agentRuns.workspaceId,
        contactId: agentRuns.contactId,
        channelId: agentRuns.channelId,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, data.runId))
      .limit(1);
    if (!run) return false;

    await tx
      .insert(chatMessages)
      .values({
        workspaceId: run.workspaceId,
        ticketId: data.ticketId,
        userId: data.userId,
        contactId: run.contactId,
        channelId: run.channelId,
        role: "assistant",
        content: data.content,
        relatedKnowledgeIds: data.relatedKnowledgeIds,
        relatedKnowledgeSnapshot: data.relatedKnowledgeSnapshot,
        agentRunId: data.runId,
        llmProvider: data.llmProvider,
        llmModel: data.llmModel,
      })
      .onConflictDoNothing();

    await tx
      .update(agentRuns)
      .set({
        status: "completed",
        finalOutput: data.content,
        error: null,
        llmProvider: data.llmProvider,
        llmModel: data.llmModel,
        traceId: data.traceId,
        spanId: data.spanId,
        durationMs: data.durationMs,
        llmRequestCount: data.llmRequestCount,
        contextWindowTokens: data.contextWindowTokens,
        completedAt: new Date(),
        metadata: JSON.stringify(data.metadata) as any,
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, data.runId));

    return true;
  });
}

export async function claimNextAgentRun(input: {
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);

    const expiredAtLimit = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          inArray(agentRuns.status, ["planning", "running"]),
          lt(agentRuns.leaseExpiresAt, now),
          gte(agentRuns.attemptCount, input.maxAttempts)
        )
      )
      .for("update", { skipLocked: true });
    for (const expired of expiredAtLimit) {
      await settleAgentRunAttemptInTransaction(tx, {
        runId: expired.id,
        attemptNumber: expired.attemptCount,
      });
      await tx
        .update(agentRuns)
        .set({
          status: "failed",
          error: "Agent worker lease expired and retry limit was reached",
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(agentRuns.id, expired.id));
    }

    const [run] = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          lt(agentRuns.attemptCount, input.maxAttempts),
          or(
            eq(agentRuns.status, "queued"),
            and(
              inArray(agentRuns.status, ["planning", "running"]),
              lt(agentRuns.leaseExpiresAt, now)
            )
          )
        )
      )
      .orderBy(agentRuns.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });

    if (!run) return null;

    const isRecovery = run.status === "planning" || run.status === "running";
    const nextAttemptNumber = isRecovery ? run.attemptCount + 1 : run.attemptCount;
    if (isRecovery) {
      await settleAgentRunAttemptInTransaction(tx, {
        runId: run.id,
        attemptNumber: run.attemptCount,
      });
      await tx
        .update(agentToolInvocations)
        .set({
          status: "unknown",
          error: "Worker lease expired before the tool completed",
          errorType: "lease_lost",
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentToolInvocations.runId, run.id),
            eq(agentToolInvocations.status, "running")
          )
        );
    }

    if (isRecovery) {
      try {
        const quota = await reserveAgentRunAttempt(tx, {
          runId: run.id,
          userId: run.userId,
          attemptNumber: nextAttemptNumber,
          llmProvider: run.llmProvider,
          llmModel: run.llmModel,
          quotaLimitTokens: run.quotaLimitTokens,
          enforced: run.quotaEnforced,
          adminExempt: run.quotaAdminExempt,
          reservationTokens: run.reservedTokens,
        });
        await tx
          .update(agentRuns)
          .set(quota)
          .where(eq(agentRuns.id, run.id));
      } catch (error) {
        if (!(error instanceof TokenQuotaExceededError)) throw error;
        await tx
          .update(agentRuns)
          .set({
            status: "failed",
            error: "TOKEN_QUOTA_EXCEEDED_ON_RETRY",
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(agentRuns.id, run.id));
        return null;
      }
    }

    const [claimed] = await tx
      .update(agentRuns)
      .set({
        status: "planning",
        attemptCount: nextAttemptNumber,
        leaseOwner: input.workerId,
        leaseExpiresAt,
        heartbeatAt: now,
        error: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(agentRuns.id, run.id))
      .returning();

    return claimed ?? null;
  });
}

export async function renewAgentRunLease(input: {
  runId: string;
  workerId: string;
  leaseMs: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();

  const [run] = await db
    .update(agentRuns)
    .set({
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.leaseOwner, input.workerId),
        inArray(agentRuns.status, ["planning", "running"])
      )
    )
    .returning({ id: agentRuns.id });

  return Boolean(run);
}

export async function clearAgentRunLease(runId: string, workerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(agentRuns)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.leaseOwner, workerId)));
}

export type AgentRunEventType =
  | "reset"
  | "agent_event"
  | "delta"
  | "meta"
  | "done"
  | "error";

export async function appendAgentRunEvent(data: {
  runId: string;
  eventType: AgentRunEventType;
  payload: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [event] = await db
    .insert(agentRunEvents)
    .values({
      runId: data.runId,
      eventType: data.eventType,
      payload: JSON.stringify(data.payload) as any,
    })
    .returning();

  return event;
}

export async function getAgentRunEvents(
  runId: string,
  afterSeq = 0,
  limit = 500
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(agentRunEvents)
    .where(
      and(eq(agentRunEvents.runId, runId), gt(agentRunEvents.id, afterSeq))
    )
    .orderBy(agentRunEvents.id)
    .limit(limit);
}

export type AgentToolInvocationStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "unknown";

export type AgentToolErrorType =
  | "transient"
  | "validation"
  | "permission"
  | "not_found"
  | "lease_lost"
  | "unknown";

const parseJsonColumn = <T>(value: unknown): T => {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
};

export async function startAgentToolInvocation(data: {
  rootRunId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  argsHash: string;
  idempotencyKey?: string;
  args: unknown;
  retryCount?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [invocation] = await db
    .insert(agentToolInvocations)
    .values({
      rootRunId: data.rootRunId,
      runId: data.runId,
      toolCallId: data.toolCallId,
      toolName: data.toolName,
      argsHash: data.argsHash,
      idempotencyKey: data.idempotencyKey,
      args: JSON.stringify(data.args) as any,
      status: "running",
      retryCount: data.retryCount ?? 0,
    })
    .returning();

  return invocation;
}

export async function completeAgentToolInvocation(data: {
  id: number;
  result: unknown;
  status?: "succeeded" | "skipped";
  replayedFromInvocationId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [invocation] = await db
    .update(agentToolInvocations)
    .set({
      result: JSON.stringify(data.result) as any,
      status: data.status ?? "succeeded",
      replayedFromInvocationId: data.replayedFromInvocationId,
      error: null,
      errorType: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentToolInvocations.id, data.id))
    .returning();

  return invocation ?? null;
}

export async function failAgentToolInvocation(data: {
  id: number;
  error: string;
  errorType: AgentToolErrorType;
  status?: "failed" | "unknown";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [invocation] = await db
    .update(agentToolInvocations)
    .set({
      status: data.status ?? "failed",
      error: data.error,
      errorType: data.errorType,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentToolInvocations.id, data.id))
    .returning();

  return invocation ?? null;
}

export async function findReusableAgentToolInvocation(data: {
  rootRunId: string;
  toolName: string;
  argsHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [invocation] = await db
    .select()
    .from(agentToolInvocations)
    .where(
      and(
        eq(agentToolInvocations.rootRunId, data.rootRunId),
        eq(agentToolInvocations.toolName, data.toolName),
        eq(agentToolInvocations.argsHash, data.argsHash),
        eq(agentToolInvocations.status, "succeeded")
      )
    )
    .orderBy(desc(agentToolInvocations.id))
    .limit(1);

  if (!invocation) return null;
  return {
    ...invocation,
    args: parseJsonColumn<unknown>(invocation.args),
    result: parseJsonColumn<unknown>(invocation.result),
  };
}

export async function getAgentToolInvocationRetryCount(data: {
  rootRunId: string;
  toolName: string;
  argsHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentToolInvocations)
    .where(
      and(
        eq(agentToolInvocations.rootRunId, data.rootRunId),
        eq(agentToolInvocations.toolName, data.toolName),
        eq(agentToolInvocations.argsHash, data.argsHash),
        inArray(agentToolInvocations.status, ["failed", "unknown"])
      )
    );

  return Number(row?.count ?? 0);
}

export async function getReusableAgentToolInvocations(rootRunId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const invocations = await db
    .select()
    .from(agentToolInvocations)
    .where(
      and(
        eq(agentToolInvocations.rootRunId, rootRunId),
        eq(agentToolInvocations.status, "succeeded")
      )
    )
    .orderBy(agentToolInvocations.id);

  const unique = new Map<string, (typeof invocations)[number]>();
  for (const invocation of invocations) {
    unique.set(`${invocation.toolName}:${invocation.argsHash}`, invocation);
  }

  return Array.from(unique.values()).map(invocation => ({
    ...invocation,
    args: parseJsonColumn<unknown>(invocation.args),
    result: parseJsonColumn<unknown>(invocation.result),
  }));
}

const parseEffectResult = <T>(value: unknown): T => {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
};

export async function createTicketIdempotent(data: {
  rootRunId: string;
  runId: string;
  idempotencyKey: string;
  argsHash: string;
  workspaceId: number;
  userId: number;
  contactId?: number | null;
  channelId?: number | null;
  title: string;
  description: string;
  priority?: "low" | "medium" | "high" | "urgent";
  executionFence?: AgentRunExecutionFence;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    if (data.executionFence) {
      const [ownedRun] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, data.runId),
            eq(agentRuns.leaseOwner, data.executionFence.workerId),
            eq(agentRuns.attemptCount, data.executionFence.attemptCount),
            gt(agentRuns.leaseExpiresAt, new Date())
          )
        )
        .limit(1)
        .for("update");
      if (!ownedRun)
        throw new Error("Agent Run lease is no longer owned by this worker");
    }

    const [claim] = await tx
      .insert(agentToolEffects)
      .values({
        rootRunId: data.rootRunId,
        runId: data.runId,
        toolName: "createTicket",
        argsHash: data.argsHash,
        idempotencyKey: data.idempotencyKey,
        result: JSON.stringify({}) as any,
      })
      .onConflictDoNothing()
      .returning({ id: agentToolEffects.id });

    if (!claim) {
      const [existing] = await tx
        .select({ result: agentToolEffects.result })
        .from(agentToolEffects)
        .where(eq(agentToolEffects.idempotencyKey, data.idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Idempotent ticket result is unavailable");
      return {
        ...parseEffectResult<{ success: true; ticketId: number }>(
          existing.result
        ),
        replayed: true,
      };
    }

    const [ticket] = await tx
      .insert(tickets)
      .values({
        workspaceId: data.workspaceId,
        userId: data.userId,
        contactId: data.contactId ?? null,
        channelId: data.channelId ?? null,
        title: data.title,
        description: data.description,
        priority: data.priority ?? "medium",
      })
      .returning({ id: tickets.id });
    if (!ticket) throw new Error("Failed to create ticket");

    const result = { success: true as const, ticketId: ticket.id };
    await tx
      .update(agentToolEffects)
      .set({ result: JSON.stringify(result) as any })
      .where(eq(agentToolEffects.id, claim.id));
    return { ...result, replayed: false };
  });
}

export async function addTicketNoteIdempotent(data: {
  rootRunId: string;
  runId: string;
  idempotencyKey: string;
  argsHash: string;
  ticketId: number;
  userId: number;
  content: string;
  noteType?: "comment" | "status_change" | "assignment" | "system";
  executionFence?: AgentRunExecutionFence;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    if (data.executionFence) {
      const [ownedRun] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, data.runId),
            eq(agentRuns.leaseOwner, data.executionFence.workerId),
            eq(agentRuns.attemptCount, data.executionFence.attemptCount),
            gt(agentRuns.leaseExpiresAt, new Date())
          )
        )
        .limit(1)
        .for("update");
      if (!ownedRun)
        throw new Error("Agent Run lease is no longer owned by this worker");
    }

    const [claim] = await tx
      .insert(agentToolEffects)
      .values({
        rootRunId: data.rootRunId,
        runId: data.runId,
        toolName: "addTicketNote",
        argsHash: data.argsHash,
        idempotencyKey: data.idempotencyKey,
        result: JSON.stringify({}) as any,
      })
      .onConflictDoNothing()
      .returning({ id: agentToolEffects.id });

    if (!claim) {
      const [existing] = await tx
        .select({ result: agentToolEffects.result })
        .from(agentToolEffects)
        .where(eq(agentToolEffects.idempotencyKey, data.idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Idempotent note result is unavailable");
      return {
        ...parseEffectResult<{
          success: true;
          ticketId: number;
          noteId: number;
        }>(existing.result),
        replayed: true,
      };
    }

    const [note] = await tx
      .insert(ticketNotes)
      .values({
        ticketId: data.ticketId,
        userId: data.userId,
        content: data.content,
        noteType: data.noteType ?? "comment",
      })
      .returning({ id: ticketNotes.id });
    if (!note) throw new Error("Failed to add ticket note");

    const result = {
      success: true as const,
      ticketId: data.ticketId,
      noteId: note.id,
    };
    await tx
      .update(agentToolEffects)
      .set({ result: JSON.stringify(result) as any })
      .where(eq(agentToolEffects.id, claim.id));
    return { ...result, replayed: false };
  });
}

// ============ Ticket Notes ============

export async function addTicketNote(data: {
  ticketId: number;
  userId: number;
  content: string;
  noteType?: "comment" | "status_change" | "assignment" | "system";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(ticketNotes).values({
    ticketId: data.ticketId,
    userId: data.userId,
    content: data.content,
    noteType: data.noteType || "comment",
  });
}

export async function getTicketNotes(ticketId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(ticketNotes)
    .where(eq(ticketNotes.ticketId, ticketId))
    .orderBy(desc(ticketNotes.createdAt));
}

// ============ Statistics ============

export async function getTicketStats(workspaceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [counts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      pending:
        sql<number>`count(*) filter (where ${tickets.status} = 'pending')`.mapWith(
          Number
        ),
      inProgress:
        sql<number>`count(*) filter (where ${tickets.status} = 'in_progress')`.mapWith(
          Number
        ),
      resolved:
        sql<number>`count(*) filter (where ${tickets.status} = 'resolved')`.mapWith(
          Number
        ),
      closed:
        sql<number>`count(*) filter (where ${tickets.status} = 'closed')`.mapWith(
          Number
        ),
    })
    .from(tickets)
    .where(eq(tickets.workspaceId, workspaceId));

  return (
    counts ?? { total: 0, pending: 0, inProgress: 0, resolved: 0, closed: 0 }
  );
}
