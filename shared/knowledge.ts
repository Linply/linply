export const KNOWLEDGE_DOCUMENT_STATUSES = [
  "pending", // 等待开始上传
  "uploading", // 文件正在上传
  "uploaded", // 文件上传完成，等待解析
  "parse_queued", // 已进入解析任务队列，等待解析原始文件。 解析队列：knowledge-parse，消费上传的原始 Markdown/CSV 文件。
  "parsing", // 正在解析文档内容
  "embed_queued", // 解析完成，已进入向量生成与索引任务队列。 向量队列：knowledge-embed，消费解析后生成的知识条目，生成 embedding 并建立索引。
  "indexing", // 正在生成 embedding 并写入知识库索引
  "completed", // 导入、解析和索引均完成
  "failed", // 任一步骤失败
  "cancelled", // 任务被取消
] as const;

export type KnowledgeDocumentStatus =
  (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number];

export const KNOWLEDGE_SECURITY_STATUSES = [
  "pending", // 等待安全扫描，暂不允许进入检索
  "approved", // 已通过自动扫描或人工审核，允许建立索引并参与检索
  "quarantined", // 自动扫描发现高风险内容，已隔离并等待管理员复核
  "rejected", // 管理员确认拒绝，禁止建立索引和参与检索
] as const;

export type KnowledgeSecurityStatus =
  (typeof KNOWLEDGE_SECURITY_STATUSES)[number];
