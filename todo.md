# 客服工单 Agent 系统 - 阶段计划

## 阶段 0：本地开发与基础能力

- [x] 使用 Docker 启动本地 PostgreSQL + pgvector 服务
- [x] 修复数据库迁移，确保 `users` 与业务表可完整创建
- [x] 初始化知识库、示例用户、示例工单和备注数据
- [x] 增加本地开发登录入口（普通用户 / 管理员）
- [x] 修复工单列表筛选 Select 空值导致的页面崩溃
- [x] 移除未配置 analytics 时的占位脚本请求
- [x] 跑通基础冒烟测试：首页、工单列表、管理员统计、后端 router 调用

## 阶段 1：接入 OpenAI LLM（先不引入 Agent SDK）

- [x] 增加 OpenAI 环境变量：`LLM_PROVIDER`、`OPENAI_API_KEY`、`OPENAI_MODEL`
- [x] 保留 Manus Forge 配置作为可选 fallback，不直接删除旧实现
- [x] 将 `server/_core/llm.ts` 拆成 provider 分流：`manus` / `openai`
- [x] 使用 OpenAI Responses API 实现 `invokeLLM` 的 OpenAI 路径
- [x] 统一 OpenAI 返回结果为当前 `InvokeResult` 结构，减少上层改动
- [x] 给 LLM 调用增加清晰错误信息：缺少 key、模型错误、限流、网络失败
- [x] 更新 `.env.example` 或文档，说明本地 OpenAI 配置方式
- [ ] 验证智能客服在 OpenAI provider 下可正常回复并保存聊天记录（需要用户授权后向配置的 OpenAI endpoint 发送本地测试问题）

## 阶段 2：pgvector RAG（PostgreSQL 向量检索 + 关键词兜底）

- [x] 增加 OpenAI embedding 环境变量：`OPENAI_EMBEDDING_MODEL`
- [x] 增加代理兼容配置：`OPENAI_EMBEDDING_BASE_URL`、`OPENAI_EMBEDDING_PATH`
- [x] 确认 `knowledge_base.embedding` pgvector 字段可用于存储向量
- [x] 实现 embedding 生成函数，输入知识库标题、内容、分类、关键词
- [x] 增加知识库 embedding 回填脚本，例如 `pnpm run kb:embed`
- [x] 增加 embedding 连通性诊断命令：`npm run kb:embed:check`
- [x] 增加 `RAG_EMBEDDINGS_ENABLED=false` 开关，代理未开通 embedding 时走关键词 RAG
- [x] 优化 seed 脚本，避免重复插入知识库导致重复 embedding
- [x] 将 `searchKnowledge` 从标题 LIKE 升级为：
  - [x] query embedding
  - [x] 使用 pgvector cosine distance 排序
  - [x] 返回 topK 条目
- [x] 保留关键词 LIKE 作为无 embedding 或 OpenAI 不可用时的 fallback
- [ ] 在公司代理下验证 embedding endpoint 与模型是否可用
- [x] 在聊天返回里显示引用知识库条目，便于人工检查答案来源
- [x] 增加 RAG 质量测试用例：密码、退货、物流、保修等常见问题

## 阶段 3：提示词与客服回答质量

- [x] 重写客服 system prompt，要求只基于检索知识回答
- [x] 当知识库召回置信度低时，引导用户创建工单，而不是编造答案
- [x] 增加回答格式规范：简洁结论、步骤、必要提醒、引用来源
- [x] 增加多轮上下文：读取最近 N 条 `chat_messages` 作为对话历史
- [x] 控制上下文长度，避免把过多历史和知识库内容塞进一次请求
- [x] 增加 LLM 调用超时与前端失败提示
- [x] 记录 LLM provider、model、引用知识库 ID，方便后续排查

## 阶段 4：Agent SDK 版本（RAG 稳定后再做）

- [x] 引入 `@openai/agents`，只在服务端使用
- [x] 将知识库检索封装为 Agent tool：`searchKnowledge`
- [x] 将创建工单封装为 Agent tool：`createTicket`
- [x] 将查询工单封装为 Agent tool：`listTickets` / `getTicketById`
- [x] 将添加备注封装为 Agent tool：`addTicketNote`
- [x] 为 Agent tools 定义统一结构：`name`、`description`、`parameters` schema、`execute`
- [x] 使用 Zod / JSON Schema 校验工具入参，校验失败时返回可读错误并让 Agent 修正或兜底
- [x] 定义 Agent 执行事件格式：`thinking` / `tool_call` / `tool_result` / `final`
- [x] Agent tool 调用时通过 SSE 输出工具调用事件，便于前端实时展示执行过程
- [x] 对用户可见的工具参数和执行结果做脱敏与摘要，避免暴露敏感信息或过长原始数据
- [x] 增加工单查询 Agent 示例任务：根据自然语言查询客户最近工单并生成问题总结
- [x] 为需要稳定渲染或落库的 AI 结果定义结构化输出 schema，例如工单分类、风险等级、摘要、建议动作
- [x] 结构化输出在后端做校验，校验失败时尝试让模型修复或走人工处理兜底
- [x] 定义 Agent Run / Agent Step 数据模型，包含 `queued` / `planning` / `running` / `waiting_approval` / `failed` / `completed` 状态
- [x] 持久化 Agent Run 与步骤列表，支持刷新恢复、审计排查和后续失败重试
- [x] 提供 Agent Run 查询与重试 API：按 `runId` 获取状态、步骤、最终回答和错误信息
- [x] 设计客服 Agent 指令：优先回答，必要时创建工单或建议人工处理
- [x] 增加 guardrail：敏感信息、超出知识库范围、越权工单访问
- [x] 评估 handoff：普通客服、技术支持、售后/退款等多 Agent 分流
- [x] 接入 tracing，便于观察 Agent 为什么调用工具或拒答
- [x] 对比 Agent SDK 版本与阶段 2 简单 RAG 版本的成本、延迟和稳定性

## 阶段 5：前端体验与管理能力

- [x] 聊天页显示 AI 回复加载状态、失败重试和引用来源
- [x] 聊天页展示 Agent 执行过程：分析中、工具调用、执行结果、最终回答
- [x] Agent 工具调用过程默认折叠，支持展开查看工具名、参数摘要和结果摘要
- [x] 拆分工具调用展示组件：`ToolCallCard`、`ToolTimeline`、`ToolArgsViewer`、`ToolResultViewer`、`ToolErrorPanel`
- [x] 聊天页支持渲染结构化 AI 结果，例如工单分类、风险等级、总结卡片和建议动作
- [x] 增加独立 Agent Run 详情页 `/runs/:runId`：用于管理员/开发者排查，展示完整状态、步骤、失败原因、重试入口，并支持刷新后恢复
- [x] 聊天页支持一键“转工单”，把当前对话摘要带入工单描述
- [x] 工单详情页显示关联聊天记录
- [x] 管理员增加知识库管理页面：新增、编辑、删除、重新生成 embedding
- [x] 管理员增加 RAG 调试页面：输入问题，查看召回条目和分数
- [x] 普通用户访问受保护页面时跳转邮箱登录，生产环境不提供免密登录

## 阶段 6：测试、观测与上线准备

- [x] 为 OpenAI provider 增加单元测试，mock Responses API 返回
- [x] 为 embedding / cosine similarity 增加单元测试
- [x] 为 `chat.sendMessage` 增加集成测试：召回、回复、保存消息
- [x] 为 Agent tool 入参校验、工具执行成功/失败、工具结果脱敏增加单元测试
- [x] 为结构化输出增加测试：schema 校验成功、缺字段兜底、模型修复失败兜底
- [x] 为 Agent Run 状态流转增加测试：创建、执行中、失败、重试、完成、刷新恢复
- [x] 增加基础 e2e 冒烟测试：登录、创建工单、查看列表、智能客服问答
- [x] 增加日志脱敏，避免记录 API key、session cookie、用户敏感内容
- [x] 增加成本与延迟观测：每次 LLM/embedding 调用耗时、token 使用量
- [x] 编写部署配置说明：OpenAI key、模型、数据库迁移、embedding 回填
- [x] 上线前关闭或限制本地开发登录入口，确保只在 development 生效
