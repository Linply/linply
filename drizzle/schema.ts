import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
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
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import {
  KNOWLEDGE_DOCUMENT_STATUSES,
  KNOWLEDGE_SECURITY_STATUSES,
} from "../shared/knowledge";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
/**
 * 每个登录用户拥有自己的工作区，所有业务数据按 workspaceId 隔离。
 * 渠道 provider：web 为工作区自带的分享链接/网页挂件，其余为外部 IM。
 */
export const channelProviderEnum = pgEnum("channel_provider", [
  "web",
  "telegram",
  "slack",
  "feishu",
]);
/**
 * 渠道连接状态：
 * pending 已创建但凭证未验证；connected 凭证有效且可收发消息；error 最近一次校验或投递失败；disabled 用户主动停用。
 */
export const channelStatusEnum = pgEnum("channel_status", [
  "pending",
  "connected",
  "error",
  "disabled",
]);
/**
 * 订阅套餐。billing 尚未接入支付：所有工作区默认 free，
 * 套餐只驱动用量额度与功能开关，升级请求先记录成待处理意向。
 */
export const workspacePlanEnum = pgEnum("workspace_plan", [
  "free",
  "pro",
  "business",
  "self_hosted",
]);
/** 升级意向的处理状态，付费接入后由计费回调改写。 */
export const planRequestStatusEnum = pgEnum("plan_request_status", [
  "pending",
  "approved",
  "cancelled",
]);
/** 工作区新手引导所处的步骤，done 表示已走完全流程。 */
export const onboardingStepEnum = pgEnum("onboarding_step", [
  "profile",
  "knowledge",
  "preview",
  "channel",
  "done",
]);
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
/**
 * 知识条目安全状态：
 * pending 等待扫描；approved 已通过、允许检索；quarantined 自动隔离、等待人工复核；rejected 人工拒绝、禁止检索。
 */
export const knowledgeSecurityStatusEnum = pgEnum("knowledge_security_status", [
  ...KNOWLEDGE_SECURITY_STATUSES,
]);
/**
 * 知识安全审计动作：
 * scan 首次自动扫描；rescan 重新扫描；approve 管理员批准；reject 管理员拒绝。
 */
export const knowledgeSecurityEventActionEnum = pgEnum(
  "knowledge_security_event_action",
  ["scan", "rescan", "approve", "reject"]
);
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
/**
 * Token attempt 账本状态：
 * reserved 已预留额度、等待结算；settled 已完成用量结算；released 未产生计费用量并已释放预留。
 */
export const agentTokenLedgerStatusEnum = pgEnum("agent_token_ledger_status", [
  "reserved",
  "settled",
  "released",
]);
/**
 * Token 用量可信状态：
 * reserved 尚未结算；actual 已取得模型真实用量；no_model 明确未调用模型；unknown 已调用模型但无法取得可靠用量，按预留量保守结算。
 */
export const agentTokenUsageStateEnum = pgEnum("agent_token_usage_state", [
  "reserved",
  "actual",
  "no_model",
  "unknown",
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
 * Workspaces table - 工作区
 * 每个登录用户自动拥有一个工作区，代表 TA 自己维护的那套智能客服：
 * 知识、会话、工单、渠道连接全部按 workspaceId 隔离，系统内不存在跨工作区的管理员视角。
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("ownerUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(), // 工作区名称，默认取用户名
    /** 分享链接与网页挂件使用的公开标识，不可反推工作区内部 ID。 */
    publicKey: varchar("publicKey", { length: 32 }).notNull(),
    agentName: varchar("agentName", { length: 60 })
      .default("智能客服")
      .notNull(), // 对外展示的客服名称
    agentTone: varchar("agentTone", { length: 16 })
      .default("friendly")
      .notNull(), // professional | friendly | concise，用于生成 Agent 语气指令
    /** 回答用哪个模型；为空表示跟随部署的 OPENAI_MODEL。 */
    agentModel: varchar("agentModel", { length: 128 }),
    greeting: text("greeting"), // 会话开场白；为空时使用默认文案
    fallbackReply: text("fallbackReply"), // 知识库无法回答时的兜底话术
    businessContext: text("businessContext"), // 用户填写的业务简介，作为 Agent 的背景知识
    publicChatEnabled: boolean("publicChatEnabled").default(true).notNull(), // 是否开放免登录分享链接
    plan: workspacePlanEnum("plan").default("free").notNull(), // 当前套餐，决定额度与功能开关
    planActivatedAt: timestamp("planActivatedAt", { withTimezone: true }), // 当前套餐生效时间；free 为 null
    onboardingStep: onboardingStepEnum("onboardingStep")
      .default("profile")
      .notNull(),
    onboardingCompletedAt: timestamp("onboardingCompletedAt", {
      withTimezone: true,
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    ownerUnique: uniqueIndex("idx_workspaces_ownerUserId").on(
      table.ownerUserId
    ),
    publicKeyUnique: uniqueIndex("idx_workspaces_publicKey").on(
      table.publicKey
    ),
  })
);

export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;

/**
 * Plan change requests. Payment is not wired up yet, so an upgrade records the
 * intent here instead of charging; once billing lands this table becomes the
 * audit trail in front of it.
 */
export const planRequests = pgTable(
  "plan_requests",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestedBy: integer("requestedBy")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromPlan: workspacePlanEnum("fromPlan").notNull(),
    toPlan: workspacePlanEnum("toPlan").notNull(),
    status: planRequestStatusEnum("status").default("pending").notNull(),
    note: text("note"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  },
  table => ({
    workspaceIdIdx: index("idx_plan_requests_workspaceId").on(
      table.workspaceId
    ),
    // At most one open request per workspace, so repeated clicks are idempotent.
    openRequestUnique: uniqueIndex("idx_plan_requests_open_unique")
      .on(table.workspaceId)
      .where(sql`status = 'pending'`),
  })
);

export type PlanRequest = typeof planRequests.$inferSelect;
export type InsertPlanRequest = typeof planRequests.$inferInsert;

/**
 * Workspace channels table - 渠道连接
 * 一个工作区的每种 provider 至多一条连接。`credentials` 保存 bot token 等密钥，
 * 只能在服务端读取，任何面向客户端的 DTO 都必须剔除该字段。
 */
export const workspaceChannels = pgTable(
  "workspace_channels",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: channelProviderEnum("provider").notNull(),
    status: channelStatusEnum("status").default("pending").notNull(),
    displayName: varchar("displayName", { length: 120 }), // 渠道展示名，例如 Telegram Bot 的 @username
    externalId: varchar("externalId", { length: 128 }), // 渠道侧标识，例如 Telegram bot id
    credentials: jsonb("credentials")
      .$type<Record<string, string>>()
      .default(sql`'{}'::jsonb`)
      .notNull(), // 服务端专用凭证
    /** 出现在 webhook URL 路径中的随机串，同时用作 Telegram secret_token。 */
    webhookSecret: varchar("webhookSecret", { length: 64 }).notNull(),
    deliveryMode: varchar("deliveryMode", { length: 16 })
      .default("webhook")
      .notNull(), // webhook | polling；本地无公网地址时回落到 polling
    pollOffset: bigint("pollOffset", { mode: "number" }).default(0).notNull(), // Telegram getUpdates 游标
    autoReply: boolean("autoReply").default(true).notNull(), // 关闭后只收集消息不自动回复
    lastEventAt: timestamp("lastEventAt", { withTimezone: true }),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    workspaceProviderUnique: uniqueIndex(
      "idx_workspace_channels_workspaceId_provider"
    ).on(table.workspaceId, table.provider),
    webhookSecretUnique: uniqueIndex(
      "idx_workspace_channels_webhookSecret"
    ).on(table.webhookSecret),
    workspaceIdIdx: index("idx_workspace_channels_workspaceId").on(
      table.workspaceId
    ),
  })
);

export type WorkspaceChannel = typeof workspaceChannels.$inferSelect;
export type InsertWorkspaceChannel = typeof workspaceChannels.$inferInsert;

/**
 * Channel contacts table - 外部访客
 * 通过渠道联系工作区的终端客户。他们不注册、不登录，靠 (channelId, externalId) 识别。
 */
export const channelContacts = pgTable(
  "channel_contacts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: integer("channelId")
      .notNull()
      .references(() => workspaceChannels.id, { onDelete: "cascade" }),
    provider: channelProviderEnum("provider").notNull(),
    externalId: varchar("externalId", { length: 128 }).notNull(), // 渠道侧用户 ID
    externalChatId: varchar("externalChatId", { length: 128 }), // 回信目标会话 ID
    displayName: varchar("displayName", { length: 160 }),
    username: varchar("username", { length: 120 }),
    locale: varchar("locale", { length: 16 }),
    messageCount: integer("messageCount").default(0).notNull(),
    lastMessageAt: timestamp("lastMessageAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    channelExternalUnique: uniqueIndex(
      "idx_channel_contacts_channelId_externalId"
    ).on(table.channelId, table.externalId),
    workspaceLastMessageIdx: index(
      "idx_channel_contacts_workspaceId_lastMessageAt"
    ).on(table.workspaceId, table.lastMessageAt),
  })
);

export type ChannelContact = typeof channelContacts.$inferSelect;
export type InsertChannelContact = typeof channelContacts.$inferInsert;

/**
 * Tickets table - 工单表
 * 存储客户工单信息，包括状态、优先级、标题、描述等
 */
export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }), // 归属工作区
    userId: integer("userId").notNull(), // 工作区内发起工单的登录用户（渠道来单时为工作区所有者）
    contactId: integer("contactId").references(() => channelContacts.id, {
      onDelete: "set null",
    }), // 提出诉求的外部访客；工作区自己创建的工单为 null
    channelId: integer("channelId").references(() => workspaceChannels.id, {
      onDelete: "set null",
    }), // 工单来源渠道
    title: varchar("title", { length: 255 }).notNull(), // 工单标题
    description: text("description").notNull(), // 工单描述
    status: ticketStatusEnum("status").default("pending").notNull(), // 工单状态
    priority: ticketPriorityEnum("priority").default("medium").notNull(), // 优先级
    assignedTo: integer("assignedTo"), // 分配给的工作区成员 ID（可选）
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
    workspaceIdIdx: index("idx_tickets_workspaceId").on(table.workspaceId),
    contactIdIdx: index("idx_tickets_contactId").on(table.contactId),
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
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }), // 归属工作区；检索永远带上该过滤条件
    title: varchar("title", { length: 255 }).notNull(), // 知识库条目标题（导入文档时标题可能重复，故不再全局唯一）
    content: text("content").notNull(), // 知识库条目内容
    category: varchar("category", { length: 100 }).notNull(), // 分类（FAQ、产品说明、政策等）
    keywords: text("keywords"), // 关键词（逗号分隔）
    embedding: vector("embedding", { dimensions: 512 }), // BAAI/bge-small-zh-v1.5 向量嵌入
    documentId: integer("documentId"), // 来源上传文档 ID（手动添加的条目为 null）
    embeddingStatus: varchar("embeddingStatus", { length: 16 })
      .default("pending")
      .notNull(), // pending | completed | failed | blocked
    conflictWith: integer("conflictWith"), // 检测到内容/标题冲突时，指向最相似的已有条目 ID
    conflictScore: real("conflictScore"), // 与冲突条目的相似度（0~1，标题精确匹配记为 1）
    securityStatus: knowledgeSecurityStatusEnum("securityStatus")
      .default("approved")
      .notNull(), // 安全状态：仅 approved 且 embeddingStatus=completed 的条目可参与检索
    securityScannerVersion: varchar("securityScannerVersion", { length: 64 })
      .default("legacy-approved")
      .notNull(), // 最近一次安全扫描器版本；legacy-approved 表示迁移前存量条目
    securityContentHash: varchar("securityContentHash", { length: 64 }), // 扫描时内容 SHA-256，用于审核时检测内容是否已变化
    securityScore: integer("securityScore").default(0).notNull(), // 综合风险分数（0~100），越高表示 Prompt Injection 风险越大
    securityFindings: jsonb("securityFindings")
      .$type<
        Array<{
          ruleId: string;
          title: string;
          explanation: string;
          score: number;
          severity: "low" | "medium" | "high" | "critical";
          evidence: Array<{ text: string; start: number; end: number }>;
        }>
      >()
      .default(sql`'[]'::jsonb`)
      .notNull(), // 命中的安全规则、分值、严重程度及原文证据位置
    securityReviewedAt: timestamp("securityReviewedAt", { withTimezone: true }), // 最近一次人工审核时间
    securityReviewedBy: integer("securityReviewedBy"), // 最近一次人工审核的管理员用户 ID
    securityReviewReason: text("securityReviewReason"), // 管理员批准或拒绝时填写的审核理由
    securityScannedAt: timestamp("securityScannedAt", { withTimezone: true }), // 最近一次自动安全扫描时间
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    categoryIdx: index("idx_category").on(table.category),
    securityStatusIdx: index("idx_knowledge_base_securityStatus").on(
      table.securityStatus
    ),
    documentIdIdx: index("idx_knowledge_base_documentId").on(table.documentId),
    /**
     * 检索永远先按 workspaceId 收敛，再在该子集内做精确余弦排序。
     * 全局 HNSW 索引在带 workspace 过滤时会因 ef_search 候选被过滤而丢召回，
     * 而单个工作区的条目量级下精确扫描既准确又足够快，因此不再维护向量索引。
     */
    workspaceSearchIdx: index("idx_knowledge_base_workspaceId_searchable")
      .on(table.workspaceId)
      .where(
        sql`${table.embedding} IS NOT NULL AND ${table.securityStatus} = 'approved'`
      ),
    workspaceIdIdx: index("idx_knowledge_base_workspaceId").on(
      table.workspaceId
    ),
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
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }), // 归属工作区
    filename: varchar("filename", { length: 255 }).notNull(), // 原始文件名
    fileType: varchar("fileType", { length: 16 }).notNull(), // markdown | csv
    status: knowledgeDocumentStatusEnum("status").default("pending").notNull(),
    objectKey: text("objectKey"), // 对象存储中的文件唯一地址
    uploadId: text("uploadId"), // 对象存储的分片上传会话 ID
    uploadVersion: integer("uploadVersion").default(1).notNull(), // 上传版本，用于忽略过期的解析任务
    fileSize: bigint("fileSize", { mode: "number" }), // 原始文件总大小（字节）
    uploadPartSize: bigint("uploadPartSize", { mode: "number" }), // 单个上传分片大小（字节）
    uploadedBytes: bigint("uploadedBytes", { mode: "number" })
      .default(0)
      .notNull(), // 已上传字节数，用于显示进度和断点续传
    contentType: varchar("contentType", { length: 128 }), // 文件 MIME 类型
    category: varchar("category", { length: 128 }), // 上传时指定的知识条目分类
    totalChunks: integer("totalChunks").default(0).notNull(), // 解析出的条目总数（进度分母）
    parsedChunks: integer("parsedChunks").default(0).notNull(), // 已解析并写入的条目数
    approvedChunks: integer("approvedChunks").default(0).notNull(), // 已通过安全扫描、允许索引和检索的条目数
    quarantinedChunks: integer("quarantinedChunks").default(0).notNull(), // 被自动扫描隔离、等待人工复核的条目数
    rejectedChunks: integer("rejectedChunks").default(0).notNull(), // 已被管理员拒绝、禁止检索的条目数
    pendingSecurityChunks: integer("pendingSecurityChunks").default(0).notNull(), // 尚未完成安全扫描的条目数
    failureStage: varchar("failureStage", { length: 32 }), // 失败环节，例如 upload 或 parsing
    error: text("error"), // 失败原因
    uploadedBy: integer("uploadedBy"), // 上传者用户 ID
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
  },
  table => ({
    statusIdx: index("idx_knowledge_documents_status").on(table.status),
    workspaceIdIdx: index("idx_knowledge_documents_workspaceId").on(
      table.workspaceId
    ),
  })
);

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type InsertKnowledgeDocument = typeof knowledgeDocuments.$inferInsert;

/**
 * Append-only audit trail for every automated scan and administrator decision.
 * Application code must only insert rows; no update/delete helper is exposed.
 */
export const knowledgeSecurityEvents = pgTable(
  "knowledge_security_events",
  {
    id: serial("id").primaryKey(),
    knowledgeId: integer("knowledgeId").notNull(), // 关联的知识条目 ID
    documentId: integer("documentId"), // 来源文档 ID；手工创建条目时为 null
    action: knowledgeSecurityEventActionEnum("action").notNull(), // 本次审计事件的扫描或人工审核动作
    fromStatus: knowledgeSecurityStatusEnum("fromStatus"), // 动作执行前的安全状态；首次扫描时可为 null
    toStatus: knowledgeSecurityStatusEnum("toStatus").notNull(), // 动作执行后的安全状态
    scannerVersion: varchar("scannerVersion", { length: 64 }).notNull(), // 产生该判断的扫描器版本
    contentHash: varchar("contentHash", { length: 64 }).notNull(), // 事件发生时知识内容的 SHA-256
    securityScore: integer("securityScore").default(0).notNull(), // 事件对应的综合风险分数（0~100）
    findings: jsonb("findings")
      .$type<
        Array<{
          ruleId: string;
          title: string;
          explanation: string;
          score: number;
          severity: "low" | "medium" | "high" | "critical";
          evidence: Array<{ text: string; start: number; end: number }>;
        }>
      >()
      .default(sql`'[]'::jsonb`)
      .notNull(), // 当次扫描命中的规则、分值、严重程度及证据位置快照
    reason: text("reason"), // 人工审核理由；自动扫描事件通常为 null
    actorUserId: integer("actorUserId"), // 执行动作的管理员用户 ID；自动扫描时为 null
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    knowledgeIdIdx: index("idx_knowledge_security_events_knowledgeId").on(
      table.knowledgeId
    ),
    documentIdIdx: index("idx_knowledge_security_events_documentId").on(
      table.documentId
    ),
    createdAtIdx: index("idx_knowledge_security_events_createdAt").on(
      table.createdAt
    ),
  })
);

export type KnowledgeSecurityEvent = typeof knowledgeSecurityEvents.$inferSelect;
export type InsertKnowledgeSecurityEvent =
  typeof knowledgeSecurityEvents.$inferInsert;

/**
 * Chat messages table - 聊天记录表
 * 存储用户与智能客服的对话记录
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }), // 归属工作区
    ticketId: integer("ticketId"), // 关联的工单 ID（可选）
    userId: integer("userId").notNull(), // 工作区所有者 ID；渠道会话同样记在所有者名下
    contactId: integer("contactId").references(() => channelContacts.id, {
      onDelete: "cascade",
    }), // 外部访客；工作区内自己的测试对话为 null
    channelId: integer("channelId").references(() => workspaceChannels.id, {
      onDelete: "set null",
    }), // 消息来源渠道
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
    agentRunId: uuid("agentRunId"), // Agent 模式下关联的运行 UUID
    llmProvider: varchar("llmProvider", { length: 32 }), // 生成该回复的 LLM provider
    llmModel: varchar("llmModel", { length: 128 }), // 生成该回复的模型
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userIdIdx: index("idx_userId_chat").on(table.userId),
    ticketIdIdx: index("idx_ticketId_chat").on(table.ticketId),
    workspaceIdIdx: index("idx_chat_messages_workspaceId").on(
      table.workspaceId
    ),
    contactIdIdx: index("idx_chat_messages_contactId_id").on(
      table.contactId,
      table.id
    ),
    agentRunIdIdx: index("idx_chat_messages_agentRunId").on(table.agentRunId),
    agentRunRoleUnique: uniqueIndex("idx_chat_messages_agentRunId_role_unique")
      .on(table.agentRunId, table.role)
      .where(sql`${table.agentRunId} IS NOT NULL`),
  })
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * Per-user UTC-day quota counters. A row is retained even when enforcement is
 * disabled so reservation and actual usage remain observable.
 */
export const agentTokenDailyBuckets = pgTable(
  "agent_token_daily_buckets",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(), // 额度所属用户 ID
    bucketDate: date("bucketDate", { mode: "string" }).notNull(), // UTC 自然日，格式 YYYY-MM-DD
    quotaLimitTokens: integer("quotaLimitTokens").default(0).notNull(), // 当日 Token 上限；0 表示观测模式下不限额
    reservedTokens: integer("reservedTokens").default(0).notNull(), // 执行中 Run 已预留、尚未结算的 Token
    usedTokens: integer("usedTokens").default(0).notNull(), // 当日已结算并计入额度的 Token
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userBucketUnique: uniqueIndex(
      "idx_agent_token_daily_buckets_userId_bucketDate"
    ).on(table.userId, table.bucketDate),
    bucketDateIdx: index("idx_agent_token_daily_buckets_bucketDate").on(
      table.bucketDate
    ),
    nonNegativeCounters: check(
      "chk_agent_token_daily_buckets_non_negative",
      sql`${table.quotaLimitTokens} >= 0 AND ${table.reservedTokens} >= 0 AND ${table.usedTokens} >= 0`
    ),
  })
);

export type AgentTokenDailyBucket =
  typeof agentTokenDailyBuckets.$inferSelect;
export type InsertAgentTokenDailyBucket =
  typeof agentTokenDailyBuckets.$inferInsert;

/**
 * Agent runs table - Agent 执行记录
 * 保存一次 Agent 对话运行的状态、输入、最终输出和错误信息，用于刷新恢复和审计排查
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }), // 归属工作区
    userId: integer("userId").notNull(), // 计费与配额归属的登录用户（工作区所有者）
    contactId: integer("contactId").references(() => channelContacts.id, {
      onDelete: "set null",
    }), // 触发本次运行的外部访客
    channelId: integer("channelId").references(() => workspaceChannels.id, {
      onDelete: "set null",
    }), // 触发本次运行的渠道
    ticketId: integer("ticketId"),
    status: agentRunStatusEnum("status").default("queued").notNull(),
    input: text("input").notNull(),
    finalOutput: text("finalOutput"),
    error: text("error"),
    llmProvider: varchar("llmProvider", { length: 32 }),
    llmModel: varchar("llmModel", { length: 128 }),
    quotaBucketDate: date("quotaBucketDate", { mode: "string" }), // 本 Run 归属的 UTC 日额度桶；历史 Run 可为 null
    quotaLimitTokens: integer("quotaLimitTokens").default(0).notNull(), // Run 创建时固化的日额度上限快照
    quotaEnforced: boolean("quotaEnforced").default(false).notNull(), // Run 创建时是否启用硬额度拦截
    quotaAdminExempt: boolean("quotaAdminExempt").default(false).notNull(), // Run 创建时管理员是否豁免硬额度
    reservedTokens: integer("reservedTokens").default(0).notNull(), // 每个 attempt 的预留 Token 数
    usageState: agentTokenUsageStateEnum("usageState")
      .default("unknown")
      .notNull(), // 当前 Run 的用量可信状态，见 agent_token_usage_state
    retryOfRunId: uuid("retryOfRunId"),
    attemptCount: integer("attemptCount").default(0).notNull(),
    leaseOwner: varchar("leaseOwner", { length: 128 }),
    leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeatAt", { withTimezone: true }),
    traceId: varchar("traceId", { length: 32 }),
    spanId: varchar("spanId", { length: 16 }),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    durationMs: integer("durationMs"),
    inputTokens: integer("inputTokens"), // 模型报告的输入 Token；unknown 时为 null
    outputTokens: integer("outputTokens"), // 模型报告的输出 Token；unknown 时为 null
    totalTokens: integer("totalTokens"), // 模型报告的总 Token；unknown 时为 null
    countedTokens: integer("countedTokens"), // 实际计入用户额度的 Token；unknown 时按预留量保守计入
    llmRequestCount: integer("llmRequestCount"), // 本 Run 发起的模型请求次数
    contextWindowTokens: integer("contextWindowTokens"), // 模型上下文窗口参考值，仅用于展示
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
    workspaceIdIdx: index("idx_agent_runs_workspaceId").on(table.workspaceId),
    ticketIdIdx: index("idx_agent_runs_ticketId").on(table.ticketId),
    statusIdx: index("idx_agent_runs_status").on(table.status),
    statusLeaseIdx: index("idx_agent_runs_status_lease").on(
      table.status,
      table.leaseExpiresAt
    ),
    traceIdIdx: index("idx_agent_runs_traceId").on(table.traceId),
    retryOfRunIdIdx: index("idx_agent_runs_retryOfRunId").on(
      table.retryOfRunId
    ),
    quotaBucketIdx: index("idx_agent_runs_userId_quotaBucketDate").on(
      table.userId,
      table.quotaBucketDate
    ),
    nonNegativeQuotaSnapshot: check(
      "chk_agent_runs_quota_snapshot_non_negative",
      sql`${table.quotaLimitTokens} >= 0 AND ${table.reservedTokens} >= 0 AND (${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0) AND (${table.totalTokens} IS NULL OR ${table.totalTokens} >= 0) AND (${table.countedTokens} IS NULL OR ${table.countedTokens} >= 0)`
    ),
  })
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type InsertAgentRun = typeof agentRuns.$inferInsert;

/** One immutable reservation/usage record per Agent Run execution attempt. */
export const agentTokenAttemptLedgers = pgTable(
  "agent_token_attempt_ledgers",
  {
    id: serial("id").primaryKey(),
    runId: uuid("runId")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }), // 对应的 Agent Run；删除 Run 时级联删除账本
    userId: integer("userId").notNull(), // 额度所属用户 ID
    attemptNumber: integer("attemptNumber").notNull(), // Run 执行尝试序号，从 1 开始；Worker 重试时递增
    bucketDate: date("bucketDate", { mode: "string" }).notNull(), // 本 attempt 归属的 UTC 自然日
    status: agentTokenLedgerStatusEnum("status").default("reserved").notNull(), // 预留额度的生命周期状态
    usageState: agentTokenUsageStateEnum("usageState")
      .default("reserved")
      .notNull(), // 本 attempt 的用量可信状态
    reservedTokens: integer("reservedTokens").default(0).notNull(), // 模型调用前原子预留的 Token
    inputTokens: integer("inputTokens"), // 模型报告的输入 Token；unknown 时为 null
    outputTokens: integer("outputTokens"), // 模型报告的输出 Token；unknown 时为 null
    totalTokens: integer("totalTokens"), // 模型报告的总 Token；unknown 时为 null
    countedTokens: integer("countedTokens").default(0).notNull(), // 最终计入日额度的 Token
    llmProvider: varchar("llmProvider", { length: 32 }), // 执行该 attempt 的模型提供商
    llmModel: varchar("llmModel", { length: 128 }), // 执行该 attempt 的模型名称
    modelStartedAt: timestamp("modelStartedAt", { withTimezone: true }), // 发起模型调用前记录；用于区分 no_model 与 unknown
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(), // attempt 预留记录创建时间
    settledAt: timestamp("settledAt", { withTimezone: true }), // 用量完成结算或预留释放的时间
  },
  table => ({
    runAttemptUnique: uniqueIndex("idx_agent_token_attempt_ledgers_runId_attemptNumber").on(
      table.runId,
      table.attemptNumber
    ),
    userBucketIdx: index("idx_agent_token_attempt_ledgers_userId_bucketDate").on(
      table.userId,
      table.bucketDate
    ),
    bucketStatusIdx: index("idx_agent_token_attempt_ledgers_bucketDate_status").on(
      table.bucketDate,
      table.status
    ),
    validAttempt: check(
      "chk_agent_token_attempt_ledgers_attempt_positive",
      sql`${table.attemptNumber} > 0`
    ),
    nonNegativeTokens: check(
      "chk_agent_token_attempt_ledgers_tokens_non_negative",
      sql`${table.reservedTokens} >= 0 AND ${table.countedTokens} >= 0 AND (${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0) AND (${table.totalTokens} IS NULL OR ${table.totalTokens} >= 0)`
    ),
  })
);

export type AgentTokenAttemptLedger =
  typeof agentTokenAttemptLedgers.$inferSelect;
export type InsertAgentTokenAttemptLedger =
  typeof agentTokenAttemptLedgers.$inferInsert;

/**
 * Agent run steps table - Agent 执行步骤
 * 保存工具调用、工具结果、思考状态、最终回答和错误摘要
 */
export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: serial("id").primaryKey(),
    runId: uuid("runId").notNull(),
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

/** Persisted stream events used to replay an Agent Run after a client disconnects. */
export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: serial("id").primaryKey(),
    runId: uuid("runId").notNull(),
    eventType: varchar("eventType", { length: 32 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    runIdIdx: index("idx_agent_run_events_runId").on(table.runId),
    runIdIdIdx: index("idx_agent_run_events_runId_id").on(
      table.runId,
      table.id
    ),
  })
);

export type AgentRunEvent = typeof agentRunEvents.$inferSelect;
export type InsertAgentRunEvent = typeof agentRunEvents.$inferInsert;

/** Structured tool execution state used for retry, replay, and resume. */
export const agentToolInvocations = pgTable(
  "agent_tool_invocations",
  {
    id: serial("id").primaryKey(),
    rootRunId: uuid("rootRunId").notNull(),
    runId: uuid("runId").notNull(),
    toolCallId: varchar("toolCallId", { length: 255 }).notNull(),
    toolName: varchar("toolName", { length: 128 }).notNull(),
    argsHash: varchar("argsHash", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }),
    args: jsonb("args").$type<unknown>().notNull(),
    result: jsonb("result").$type<unknown>(),
    status: varchar("status", { length: 32 }).notNull(),
    error: text("error"),
    errorType: varchar("errorType", { length: 32 }),
    retryCount: integer("retryCount").default(0).notNull(),
    replayedFromInvocationId: integer("replayedFromInvocationId"),
    startedAt: timestamp("startedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    runIdIdx: index("idx_agent_tool_invocations_runId").on(table.runId),
    rootRunIdIdx: index("idx_agent_tool_invocations_rootRunId").on(
      table.rootRunId
    ),
    callIdIdx: index("idx_agent_tool_invocations_runId_toolCallId").on(
      table.runId,
      table.toolCallId
    ),
    replayIdx: index("idx_agent_tool_invocations_replay").on(
      table.rootRunId,
      table.toolName,
      table.argsHash,
      table.status
    ),
  })
);

export type AgentToolInvocation = typeof agentToolInvocations.$inferSelect;
export type InsertAgentToolInvocation =
  typeof agentToolInvocations.$inferInsert;

/** Committed side effects keyed across an Agent Run retry chain. */
export const agentToolEffects = pgTable(
  "agent_tool_effects",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    rootRunId: uuid("rootRunId").notNull(),
    runId: uuid("runId").notNull(),
    toolName: varchar("toolName", { length: 128 }).notNull(),
    argsHash: varchar("argsHash", { length: 64 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("idx_agent_tool_effects_idempotencyKey").on(
      table.idempotencyKey
    ),
    rootRunIdIdx: index("idx_agent_tool_effects_rootRunId").on(table.rootRunId),
    runIdIdx: index("idx_agent_tool_effects_runId").on(table.runId),
  })
);

export type AgentToolEffect = typeof agentToolEffects.$inferSelect;
export type InsertAgentToolEffect = typeof agentToolEffects.$inferInsert;
