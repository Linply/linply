import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { KNOWLEDGE_DOCUMENT_STATUSES } from "../shared/knowledge";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const ticketStatusEnum = pgEnum("ticket_status", [
  "pending",
  "in_progress",
  "resolved",
  "closed",
]);
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);
export const ticketNoteTypeEnum = pgEnum("ticket_note_type", [
  "comment",
  "status_change",
  "assignment",
  "system",
]);
export const chatMessageRoleEnum = pgEnum("chat_message_role", [
  "user",
  "assistant",
]);
export const knowledgeDocumentStatusEnum = pgEnum("knowledge_document_status", [
  ...KNOWLEDGE_DOCUMENT_STATUSES,
]);
export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "failed",
  "completed",
]);
export const agentRunStepTypeEnum = pgEnum("agent_run_step_type", [
  "thinking",
  "tool_call",
  "tool_result",
  "final",
  "error",
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  role: userRoleEnum("role").default("user").notNull(),
  avatarUrl: text("avatarUrl"),
  emailVerifiedAt: timestamp("emailVerifiedAt", { withTimezone: true }),
  disabledAt: timestamp("disabledAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerAccountId: varchar("providerAccountId", { length: 320 }).notNull(),
    passwordHash: text("passwordHash"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    providerAccountUnique: uniqueIndex("idx_auth_accounts_provider_account").on(
      table.provider,
      table.providerAccountId
    ),
    userIdIdx: index("idx_auth_accounts_userId").on(table.userId),
  })
);

export type AuthAccount = typeof authAccounts.$inferSelect;
export type InsertAuthAccount = typeof authAccounts.$inferInsert;

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    ipAddress: varchar("ipAddress", { length: 64 }),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userIdIdx: index("idx_sessions_userId").on(table.userId),
    expiresAtIdx: index("idx_sessions_expiresAt").on(table.expiresAt),
  })
);

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

/**
 * OAuth 登录的大致流程是：发起登录时创建这条记录，回调时校验 stateHash、使用 codeVerifier 完成 PKCE 验证，成功后删除这条临时记录。
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(), // OAuth 提供商，例如 google，方便支持多个登录平台。
    stateHash: varchar("stateHash", { length: 64 }).notNull().unique(), // OAuth state 参数的哈希值，用于防止 CSRF 攻击；unique() 表示不能重复。
    codeVerifier: varchar("codeVerifier", { length: 128 }).notNull(),
    returnTo: varchar("returnTo", { length: 1024 }).default("/").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    expiresAtIdx: index("idx_oauth_states_expiresAt").on(table.expiresAt),
  })
);

export type OAuthState = typeof oauthStates.$inferSelect;
export type InsertOAuthState = typeof oauthStates.$inferInsert;

/**
 * Tickets table - 工单表
 * 存储客户工单信息，包括状态、优先级、标题、描述等
 */
export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(), // 创建工单的用户 ID
    title: varchar("title", { length: 255 }).notNull(), // 工单标题
    description: text("description").notNull(), // 工单描述
    status: ticketStatusEnum("status").default("pending").notNull(), // 工单状态
    priority: ticketPriorityEnum("priority").default("medium").notNull(), // 优先级
    assignedTo: integer("assignedTo"), // 分配给的管理员 ID（可选）
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }), // 解决时间
  },
  table => ({
    userIdIdx: index("idx_userId").on(table.userId),
    statusIdx: index("idx_status").on(table.status),
    priorityIdx: index("idx_priority").on(table.priority),
  })
);

export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = typeof tickets.$inferInsert;

/**
 * Ticket notes table - 工单备注表
 * 存储工单的历史备注和更新记录
 */
export const ticketNotes = pgTable(
  "ticket_notes",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticketId").notNull(),
    userId: integer("userId").notNull(), // 添加备注的用户 ID
    content: text("content").notNull(), // 备注内容
    noteType: ticketNoteTypeEnum("noteType").default("comment").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    ticketIdIdx: index("idx_ticketId").on(table.ticketId),
  })
);

export type TicketNote = typeof ticketNotes.$inferSelect;
export type InsertTicketNote = typeof ticketNotes.$inferInsert;

/**
 * Knowledge base table - 知识库表
 * 存储客服知识库条目，用于 RAG 检索
 */
export const knowledgeBase = pgTable(
  "knowledge_base",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 255 }).notNull(), // 知识库条目标题（导入文档时标题可能重复，故不再全局唯一）
    content: text("content").notNull(), // 知识库条目内容
    category: varchar("category", { length: 100 }).notNull(), // 分类（FAQ、产品说明、政策等）
    keywords: text("keywords"), // 关键词（逗号分隔）
    embedding: vector("embedding", { dimensions: 512 }), // BAAI/bge-small-zh-v1.5 向量嵌入
    documentId: integer("documentId"), // 来源上传文档 ID（手动添加的条目为 null）
    embeddingStatus: varchar("embeddingStatus", { length: 16 })
      .default("pending")
      .notNull(), // pending | completed | failed
    conflictWith: integer("conflictWith"), // 检测到内容/标题冲突时，指向最相似的已有条目 ID
    conflictScore: real("conflictScore"), // 与冲突条目的相似度（0~1，标题精确匹配记为 1）
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    categoryIdx: index("idx_category").on(table.category),
    documentIdIdx: index("idx_knowledge_base_documentId").on(table.documentId),
    embeddingIdx: index("idx_knowledge_base_embedding_hnsw")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .where(sql`${table.embedding} IS NOT NULL`),
  })
);

export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBase = typeof knowledgeBase.$inferInsert;

/**
 * Knowledge documents table - 知识库文档表
 * 记录上传的 Markdown/CSV 文件及其解析、索引状态；一个文档可生成多条 knowledge_base 条目
 */
export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: serial("id").primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull(), // 原始文件名
    fileType: varchar("fileType", { length: 16 }).notNull(), // markdown | csv
    status: knowledgeDocumentStatusEnum("status").default("pending").notNull(),
    totalChunks: integer("totalChunks").default(0).notNull(), // 解析出的条目总数（进度分母）
    error: text("error"), // 失败原因
    uploadedBy: integer("uploadedBy"), // 上传者用户 ID
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    statusIdx: index("idx_knowledge_documents_status").on(table.status),
  })
);

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type InsertKnowledgeDocument = typeof knowledgeDocuments.$inferInsert;

/**
 * Chat messages table - 聊天记录表
 * 存储用户与智能客服的对话记录
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticketId"), // 关联的工单 ID（可选）
    userId: integer("userId").notNull(), // 用户 ID
    role: chatMessageRoleEnum("role").notNull(), // 消息角色
    content: text("content").notNull(), // 消息内容
    relatedKnowledgeIds: jsonb("relatedKnowledgeIds").$type<number[]>(), // 关联的知识库 ID 列表
    relatedKnowledgeSnapshot: jsonb("relatedKnowledgeSnapshot").$type<
      Array<{
        id: number;
        title: string;
        category: string;
      }>
    >(), // 保存回答时引用的知识库标题/分类快照
    llmProvider: varchar("llmProvider", { length: 32 }), // 生成该回复的 LLM provider
    llmModel: varchar("llmModel", { length: 128 }), // 生成该回复的模型
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userIdIdx: index("idx_userId_chat").on(table.userId),
    ticketIdIdx: index("idx_ticketId_chat").on(table.ticketId),
  })
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * Agent runs table - Agent 执行记录
 * 保存一次 Agent 对话运行的状态、输入、最终输出和错误信息，用于刷新恢复和审计排查
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    ticketId: integer("ticketId"),
    status: agentRunStatusEnum("status").default("queued").notNull(),
    input: text("input").notNull(),
    finalOutput: text("finalOutput"),
    error: text("error"),
    llmProvider: varchar("llmProvider", { length: 32 }),
    llmModel: varchar("llmModel", { length: 128 }),
    retryOfRunId: integer("retryOfRunId"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
  },
  table => ({
    userIdIdx: index("idx_agent_runs_userId").on(table.userId),
    ticketIdIdx: index("idx_agent_runs_ticketId").on(table.ticketId),
    statusIdx: index("idx_agent_runs_status").on(table.status),
    retryOfRunIdIdx: index("idx_agent_runs_retryOfRunId").on(
      table.retryOfRunId
    ),
  })
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type InsertAgentRun = typeof agentRuns.$inferInsert;

/**
 * Agent run steps table - Agent 执行步骤
 * 保存工具调用、工具结果、思考状态、最终回答和错误摘要
 */
export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: serial("id").primaryKey(),
    runId: integer("runId").notNull(),
    stepType: agentRunStepTypeEnum("stepType").notNull(),
    toolName: varchar("toolName", { length: 128 }),
    argsSummary: text("argsSummary"),
    resultSummary: text("resultSummary"),
    content: text("content"),
    error: text("error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    runIdIdx: index("idx_agent_run_steps_runId").on(table.runId),
    stepTypeIdx: index("idx_agent_run_steps_stepType").on(table.stepType),
  })
);

export type AgentRunStep = typeof agentRunSteps.$inferSelect;
export type InsertAgentRunStep = typeof agentRunSteps.$inferInsert;
