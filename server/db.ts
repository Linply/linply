import { eq, and, desc, gt, like, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users, authAccounts, sessions, oauthStates, tickets, knowledgeBase, knowledgeDocuments, chatMessages, ticketNotes, agentRuns, agentRunSteps } from "../drizzle/schema";
import type { KnowledgeDocumentStatus } from "../shared/knowledge";
import {
  createEmbedding,
  isEmbeddingEnabled,
} from "./_core/embeddings";
import { logWarn } from "./_core/observability";

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
    const [user] = await tx.insert(users).values({
      email: data.email,
      name: data.name,
      role: data.role ?? "user",
      lastSignedIn: new Date(),
    }).returning();

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
    .where(and(
      eq(authAccounts.provider, "password"),
      eq(authAccounts.providerAccountId, email),
    ))
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

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function updateUserRole(id: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [user] = await db.update(users).set({
    role,
    updatedAt: new Date(),
  }).where(eq(users.id, id)).returning();
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

  const [session] = await db.insert(sessions).values({
    userId: data.userId,
    tokenHash: data.tokenHash,
    expiresAt: data.expiresAt,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
  }).returning();
  return session;
}

export async function getActiveSessionWithUser(tokenHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.tokenHash, tokenHash),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
      isNull(users.disabledAt),
    ))
    .limit(1);

  return result;
}

export async function touchSession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
}

export async function revokeSession(tokenHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

export async function updateUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({
    lastSignedIn: new Date(),
    updatedAt: new Date(),
  }).where(eq(users.id, id));
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

  const [state] = await db.delete(oauthStates)
    .where(and(
      eq(oauthStates.provider, provider),
      eq(oauthStates.stateHash, stateHash),
      gt(oauthStates.expiresAt, new Date()),
    ))
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
      .where(and(
        eq(authAccounts.provider, data.provider),
        eq(authAccounts.providerAccountId, data.providerAccountId),
      ))
      .limit(1);

    if (linked) return linked.user;

    let [user] = await tx.select().from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (user?.disabledAt) throw new Error("User disabled");
    if (user && !user.emailVerifiedAt) {
      throw Object.assign(new Error("OAuth account linking requires a verified email"), {
        code: "OAUTH_ACCOUNT_LINK_REQUIRED",
      });
    }

    if (!user) {
      [user] = await tx.insert(users).values({
        email: data.email,
        name: data.name,
        avatarUrl: data.avatarUrl ?? null,
        emailVerifiedAt: new Date(),
        lastSignedIn: new Date(),
      }).returning();
    } else {
      [user] = await tx.update(users).set({
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        avatarUrl: user.avatarUrl ?? data.avatarUrl ?? null,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id)).returning();
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

// ============ Tickets ============

export async function createTicket(data: {
  userId: number;
  title: string;
  description: string;
  priority?: "low" | "medium" | "high" | "urgent";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .insert(tickets)
    .values({
      userId: data.userId,
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

  const result = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function listTickets(filters?: {
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

export async function updateTicket(ticketId: number, data: Partial<{
  title: string;
  description: string;
  status: string;
  priority: string;
  assignedTo: number | null;
  resolvedAt: Date | null;
}>) {
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

export async function addKnowledgeEntry(data: {
  title: string;
  content: string;
  category: string;
  keywords?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .insert(knowledgeBase)
    .values({
      title: data.title,
      content: data.content,
      category: data.category,
      keywords: data.keywords,
    })
    .returning({
      id: knowledgeBase.id,
      title: knowledgeBase.title,
      content: knowledgeBase.content,
      category: knowledgeBase.category,
      keywords: knowledgeBase.keywords,
    });

  return result[0];
}

export async function getKnowledgeByCategory(category: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(knowledgeBase).where(eq(knowledgeBase.category, category));
}

export async function listKnowledgeEntries() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(knowledgeBase);
}

export async function getKnowledgeEntryById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getKnowledgeByIds(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const uniqueIds = Array.from(new Set(ids)).filter(Number.isFinite);
  if (uniqueIds.length === 0) return [];

  return db.select().from(knowledgeBase).where(inArray(knowledgeBase.id, uniqueIds));
}

export async function updateKnowledgeEmbedding(id: number, embedding: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(knowledgeBase)
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
    embeddingStatus: "pending" | "completed" | "failed";
    conflictWith: number | null;
    conflictScore: number | null;
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

// ============ Knowledge Documents（上传文档） ============

export async function createKnowledgeDocument(data: {
  filename: string;
  fileType: string;
  uploadedBy?: number;
  status?: KnowledgeDocumentStatus;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .insert(knowledgeDocuments)
    .values({
      filename: data.filename,
      fileType: data.fileType,
      status: data.status ?? "parsing",
      uploadedBy: data.uploadedBy,
    })
    .returning({ id: knowledgeDocuments.id });

  return result[0];
}

export async function updateKnowledgeDocument(
  id: number,
  data: Partial<{
    status: KnowledgeDocumentStatus;
    totalChunks: number;
    error: string | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(knowledgeDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(knowledgeDocuments.id, id));
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

export async function listKnowledgeDocuments() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .orderBy(desc(knowledgeDocuments.createdAt));

  const counts = await db
    .select({
      documentId: knowledgeBase.documentId,
      embeddedCount: sql<number>`count(*) filter (where ${knowledgeBase.embeddingStatus} = 'completed')`.mapWith(Number),
      failedCount: sql<number>`count(*) filter (where ${knowledgeBase.embeddingStatus} = 'failed')`.mapWith(Number),
    })
    .from(knowledgeBase)
    .where(isNotNull(knowledgeBase.documentId))
    .groupBy(knowledgeBase.documentId);

  const countMap = new Map(counts.map(c => [c.documentId, c]));

  return docs.map(doc => ({
    ...doc,
    embeddedCount: countMap.get(doc.id)?.embeddedCount ?? 0,
    failedCount: countMap.get(doc.id)?.failedCount ?? 0,
  }));
}

export async function addKnowledgeEntriesBatch(
  documentId: number,
  entries: Array<{
    title: string;
    content: string;
    category: string;
    keywords?: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (entries.length === 0) return [];

  return db
    .insert(knowledgeBase)
    .values(
      entries.map(entry => ({
        title: entry.title,
        content: entry.content,
        category: entry.category,
        keywords: entry.keywords,
        documentId,
        embeddingStatus: "pending" as const,
      }))
    )
    .returning({
      id: knowledgeBase.id,
      title: knowledgeBase.title,
      content: knowledgeBase.content,
      category: knowledgeBase.category,
      keywords: knowledgeBase.keywords,
    });
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
    .where(eq(knowledgeBase.id, id));
}

export async function setKnowledgeEntryStatus(
  id: number,
  status: "pending" | "completed" | "failed"
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
    title: string;
    documentId: number | null;
    embedding: number[] | null;
  },
  threshold = CONFLICT_SIMILARITY_THRESHOLD
): Promise<{ conflictWith: number; conflictScore: number } | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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
      .where(and(isNotNull(knowledgeBase.embedding), notSelf, notSameDoc))
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
        notSelf,
        notSameDoc,
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

async function fallbackSearchKnowledge(query: string, limit: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const entries = await db.select().from(knowledgeBase);
  const ranked = rankKnowledgeEntriesByKeyword(query, entries, limit);
  if (ranked.length > 0) return ranked;

  return db.select().from(knowledgeBase)
    .where(like(knowledgeBase.title, `%${query}%`))
    .limit(limit);
}

export async function searchKnowledgeByKeyword(query: string, limit = 5) {
  return fallbackSearchKnowledge(query, limit);
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

  for (const part of query.toLowerCase().split(/[,\s，。！？!?、;；:：/\\|]+/)) {
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
  return scoreKnowledgeEntriesByKeyword(query, entries, limit).map(item => item.entry);
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

export async function searchKnowledge(query: string, limit = 5) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!isEmbeddingEnabled()) {
    return fallbackSearchKnowledge(query, limit);
  }

  try {
    const queryEmbedding = await createEmbedding(query, "query");
    const distance = cosineDistance(knowledgeBase.embedding, queryEmbedding);
    const scored = await db
      .select()
      .from(knowledgeBase)
      .where(isNotNull(knowledgeBase.embedding))
      .orderBy(distance, desc(knowledgeBase.updatedAt))
      .limit(limit);

    return scored.length > 0 ? scored : fallbackSearchKnowledge(query, limit);
  } catch (error) {
    logWarn("[RAG] Vector search failed, falling back to keyword search", {
      error,
    });
    return fallbackSearchKnowledge(query, limit);
  }
}

export async function debugSearchKnowledge(query: string, limit = 5) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const keywordFallback = async (reason: string) => {
    const entries = await db.select().from(knowledgeBase);
    const scored = scoreKnowledgeEntriesByKeyword(query, entries, limit);

    return {
      mode: "keyword" as const,
      fallbackReason: reason,
      results: scored.map(item => {
        const { embedding: _embedding, ...entry } = item.entry as typeof item.entry & {
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
      .where(isNotNull(knowledgeBase.embedding))
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
    logWarn("[RAG] Debug vector search failed, falling back to keyword search", {
      error,
    });
    return keywordFallback(error instanceof Error ? error.message : "vector_search_failed");
  }
}

// ============ Chat Messages ============

export async function saveChatMessage(data: {
  ticketId?: number;
  userId: number;
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

  return db.insert(chatMessages).values({
    ticketId: data.ticketId,
    userId: data.userId,
    role: data.role,
    content: data.content,
    relatedKnowledgeIds: data.relatedKnowledgeIds ?? null,
    relatedKnowledgeSnapshot: data.relatedKnowledgeSnapshot ?? null,
    agentRunId: data.agentRunId,
    llmProvider: data.llmProvider,
    llmModel: data.llmModel,
  });
}

export async function getChatHistory(userId: number, ticketId?: number, limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [eq(chatMessages.userId, userId)];
  if (ticketId) {
    conditions.push(eq(chatMessages.ticketId, ticketId));
  }

  const rows = await db.select().from(chatMessages)
    .where(and(...conditions))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function getTicketChatHistory(ticketId: number, limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.ticketId, ticketId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function getRecentChatHistory(userId: number, ticketId?: number, limit = 10) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [eq(chatMessages.userId, userId)];
  if (ticketId) {
    conditions.push(eq(chatMessages.ticketId, ticketId));
  }

  const rows = await db.select().from(chatMessages)
    .where(and(...conditions))
    .orderBy(desc(chatMessages.createdAt))
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

export async function createAgentRun(data: {
  userId: number;
  ticketId?: number;
  input: string;
  status?: AgentRunStatus;
  llmProvider?: string;
  llmModel?: string;
  retryOfRunId?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .insert(agentRuns)
    .values({
      userId: data.userId,
      ticketId: data.ticketId,
      input: data.input,
      status: data.status ?? "queued",
      llmProvider: data.llmProvider,
      llmModel: data.llmModel,
      retryOfRunId: data.retryOfRunId,
      metadata: data.metadata ? JSON.stringify(data.metadata) as any : undefined,
    })
    .returning({ id: agentRuns.id });

  return result[0];
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
    metadata: Record<string, unknown> | null;
  }>
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

  return db
    .update(agentRuns)
    .set(updateData as any)
    .where(eq(agentRuns.id, id));
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
    metadata: data.metadata ? JSON.stringify(data.metadata) as any : undefined,
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

export async function getAgentRunSteps(runId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, runId))
    .orderBy(agentRunSteps.createdAt, agentRunSteps.id);
}

export async function getAgentRunWithSteps(id: string) {
  const run = await getAgentRunById(id);
  if (!run) return null;

  return {
    ...run,
    steps: await getAgentRunSteps(id),
  };
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

  return db.select().from(ticketNotes).where(eq(ticketNotes.ticketId, ticketId)).orderBy(desc(ticketNotes.createdAt));
}

// ============ Statistics ============

export async function getTicketStats() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const total = await db.select().from(tickets);
  const pending = await db.select().from(tickets).where(eq(tickets.status, "pending"));
  const inProgress = await db.select().from(tickets).where(eq(tickets.status, "in_progress"));
  const resolved = await db.select().from(tickets).where(eq(tickets.status, "resolved"));
  const closed = await db.select().from(tickets).where(eq(tickets.status, "closed"));

  return {
    total: total.length,
    pending: pending.length,
    inProgress: inProgress.length,
    resolved: resolved.length,
    closed: closed.length,
  };
}
