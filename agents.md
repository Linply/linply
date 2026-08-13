# Linply 系统文档

多租户自助智能客服：**每个注册用户拥有一个只属于自己的工作区**，自己导入知识、自己调教客服、自己接出渠道。
系统中不存在跨工作区的管理员角色，所有业务数据按 `workspaceId` 隔离。

## 目录

1. [系统架构](#系统架构)
2. [核心模块](#核心模块)
3. [智能客服 Agent](#智能客服-agent)
4. [知识库管理](#知识库管理)
5. [渠道接入](#渠道接入)
6. [新用户引导](#新用户引导)
7. [用户使用手册](#用户使用手册)
8. [开发者指南](#开发者指南)
9. [部署与运维](#部署与运维)
10. [附录](#附录)

---

## 系统架构

```
外部客户                          工作区所有者
  │ Telegram / 分享链接              │ 浏览器
  ▼                                  ▼
渠道适配层 server/channels/     前端 (React 19 + Tailwind + shadcn/ui)
  │  入站管线：识别 contact          │  tRPC + SSE 流式聊天
  └──────────────┬──────────────────┘
                 ▼
      后端 (Express + tRPC + pi Agent SDK)
      每个请求携带 ConversationScope
                 │
   ├── PostgreSQL + pgvector   数据 & 向量存储（全部按 workspaceId 过滤）
   ├── Embedding 服务          本地 bge-small-zh-v1.5 / OpenAI / Voyage
   ├── Agent Worker            queued Run 的独立执行进程
   └── LLM API                 OpenAI 兼容
```

- **前端**：页面分为首页、工单管理、智能客服、知识库、RAG 调试、Agent Run 详情、管理仪表盘；路由用 wouter，数据用 tRPC + React Query。
- **后端**：tRPC 路由按域划分（`tickets` / `knowledge` / `chat` / `agentRuns` / `auth`），数据库访问集中在 `server/db.ts`。
- **Agent 执行**：Web 进程负责创建 queued Run 和订阅 SSE；`AGENT_EXECUTION_MODE=inline` 时由应用进程执行，设为 `worker` 时由独立 Worker 通过 PostgreSQL 租约领取并执行。
- **认证与隔离**：邮箱密码与 Google OAuth 登录，随机 Session Token 的哈希保存在 PostgreSQL。
  登录后由 `workspaceProcedure` 解析（必要时懒创建）调用者的工作区，并注入 `ctx.workspace` 与 `ctx.scope`。
- **渠道**：`server/channels/` 提供适配层。Telegram 已完整实现（webhook + 本地轮询回落）；
  每个工作区自带一条 `web` 渠道，对应免登录分享链接 `/a/:publicKey`。

---

## 核心模块

| 模块 | 职责 |
| --- | --- |
| 工作区 | 注册即开通，保存客服人设（名称/语气/业务背景/兜底话术）、分享链接 publicKey 和引导进度 |
| 渠道接入 | Telegram Bot 接入与收发、免登录分享链接、外部访客识别与会话归集 |
| 新用户引导 | `/onboarding` 四步向导：介绍业务 → 导入知识 → 试聊一次 → 接出去 |
| 工单管理 | 创建、筛选/搜索、详情、状态与优先级流转、备注、统计 |
| 知识库 | 知识条目的存储、检索、文档批量导入、冲突检测、增删 |
| 智能客服 Agent | RAG 检索 + LLM/Agent 生成回答，展示执行过程，保存对话并标注引用来源 |
| Agent Run 排查 | 持久化 Agent 运行记录、步骤、失败原因、结构化结果，支持详情页查看和重试 |
| 认证与权限 | 邮箱密码、Google OAuth、数据库 Session、角色与接口权限 |

### 数据模型（概览）

- **workspaces**：工作区，`ownerUserId` 唯一。保存 `agentName` / `agentTone` / `greeting` / `fallbackReply` /
  `businessContext`（这些直接进入系统提示词）、`agentModel`（用哪个模型回答，为空跟随部署默认）、
  `publicKey`（分享链接）和 `onboardingStep`。
- **workspace_channels**：渠道连接，`(workspaceId, provider)` 唯一。`credentials` 存 bot token，
  **绝不可返回给客户端**（统一走 `toChannelDto` 剥离）；`webhookSecret` 同时用于 URL 路径与 Telegram `secret_token`。
- **channel_contacts**：外部访客，不注册不登录，靠 `(channelId, externalId)` 识别。
- **users**：登录账号资料。`role` 字段仍在表中，但**不再参与任何鉴权判断**。
- **auth_accounts**：登录凭证账号，支持 password 与 google provider。
- **sessions**：可撤销登录会话，只保存 Session Token 哈希、有效期和设备摘要。
- **oauth_states**：一次性 OAuth state 与 PKCE verifier，回调消费后立即删除。
- **tickets**：工单，含 `workspaceId`、可选 `contactId` / `channelId`、状态（pending / in_progress / resolved / closed）与优先级。
- **ticket_notes**：工单备注与状态变更记录。
- **knowledge_base**：知识条目，含 `workspaceId`、向量 `embedding`、来源文档 `documentId`、嵌入状态、冲突标记。
  检索先按 `workspaceId` 收敛再做精确余弦排序——全局 HNSW 索引在带 workspace 过滤时会丢召回，因此已移除。
- **knowledge_documents**：上传文档，记录对象存储 key、multipart 会话、文件/分片大小、解析状态与索引进度。
- **chat_messages**：对话记录，含 `workspaceId` 与可选 `contactId` / `channelId`。
  `contactId` 为空表示所有者在控制台的试聊线程，非空表示某个外部访客的线程，两者永不混合。
- **agent_runs**：Agent 单次运行记录，以 UUID 作为 Run ID，含 `workspaceId` / `contactId` / `channelId`，
  保存输入、状态、最终回答、错误、模型、重试来源和 metadata。
- **agent_run_steps**：Agent 运行步骤，记录 `thinking` / `tool_call` / `tool_result` / `final` / `error`。
- **agent_run_events**：持久化 SSE 事件及递增事件 ID，用于客户端断线后的 Partial Replay。
- **agent_tool_invocations**：记录工具调用状态、参数摘要、重试次数和可复用结果。
- **agent_tool_effects**：记录跨重试链的幂等副作用结果，当前用于避免重复创建工单或备注。

表结构以 `drizzle/schema.ts` 为准；变更通过 `pnpm db:generate` + `pnpm db:migrate` 管理。

### 授权模型

没有角色，只有两条规则：

1. 一行数据只能从它所属的 workspace 访问。
2. workspace 内部，所有者（console scope，`contactId == null`）看全部；
   外部访客（contact scope）只看归属自己的行。

实现位置：

- `server/workspace.ts`：`requireWorkspaceForUser` 懒开通工作区；`ConversationScope` 定义「谁在问」。
- `server/_core/trpc.ts`：`workspaceProcedure` 是业务数据的默认 procedure，注入 `ctx.workspace` 与 `ctx.scope`。
- `server/accessControl.ts`：唯一的判定入口，所有 `*ForScope` 函数都在这里。

---

## 智能客服 Agent

聊天固定使用服务端 pi Agent SDK（`server/ai/`）：用户提问 → 创建 Agent Run → Agent 调用工具 → SSE 推送执行事件和文本增量 → 保存最终回答、结构化结果和步骤。

`server/ai/` 的分工：`settings.ts` 按「内置默认 ← 部署 env ← 工作区」三层深合并出一份设置文档；`provider.ts` 只向 pi 注册部署自己的 OpenAI 兼容网关；`resourceLoader.ts` 关掉 pi 的全部本地发现（扩展、skills、AGENTS.md），避免仓库或运维机器上的指令混进客服回复；`session.ts` 每条消息起一个 in-memory 会话并以 `noTools: "all"` 关掉 read/bash/edit/write；`tools.ts` 只暴露 5 个业务工具，执行仍走 `toolRuntime.ts` 的幂等与重放记账。

多模态：图片随 `prompt(text, { images })` 直接进模型；PDF/文本按 pi 协议无法作为字节传入，改为服务端抽取文字后放进 untrusted 分区。附件本身只存对象存储 key，浏览器用预签名 URL 直传。

Agent 聊天先调用 `POST /api/chat/start` 创建 Run，再通过 `GET /api/chat/stream/:runId` 订阅事件。SSE 以 JSON `type` 区分 `agent_event`、`delta`、`meta`、`done`、`error` 和重试时的 `reset`，Agent 事件同时带有 SSE `id`，客户端通过 `afterSeq` 续接。

**模型选择**

每个工作区自己决定用哪个模型回答，存在 `workspaces.agentModel`；为空表示跟随部署的 `OPENAI_MODEL`。

- 候选清单不写死在代码里，而是**问端点要**：`server/agentModelCatalog.ts` 用当前 key 列 `/v1/models`，
  过滤掉 embedding / audio / image / realtime / instruct 等非对话模型，缓存 10 分钟。
  key 用不了的模型永远不会出现在选项里；列表拉不到时退回到当前配置的模型，设置页不会因此打不开。
- `OPENAI_MODELS` 设了就直接用它，不发网络请求——给只转发部分模型的代理，或者想收窄选择的部署。
- 展示名和档位（flagship / balanced / fast / reasoning）由 `shared/agentModels.ts` 从模型 id 推出来，
  所以出现没见过的新型号也能正常渲染。上下文窗口只有 `OPENAI_MODEL_CONTEXT_WINDOWS` 声明过才显示。
- 写入时在 `workspace.update` 里校验模型是否在候选内；执行时 `resolveWorkspaceModel` 是同步的，不发网络请求，
  聊天热路径不受影响。选中的模型会进 Agent 构造、`agent_runs.llmModel`、SSE `done` 和用量统计的上下文窗口。

**对话风格**

Agent 的人设写在 `server/agentPersona.ts`，目标是一个真人客服而不是一份文档：

- 第一人称、口语、短句，默认两三句话说完；先接住情绪再给答案；一次只问一个问题；跟着用户的语言走。
- 不写小标题、不堆项目符号（只有分步操作才编号）；不说“根据知识库”“作为 AI 助手”这类系统腔。
- 正文里不出现工具名、JSON、内部字段和“参考：xxx”——引用来源由界面渲染成 chips。
- 工作区的名称、语气、业务背景和兜底话术仍然直接进入这份人设；语气档位（professional / friendly / concise）只调语域，不改上面的结构。
- 模型仍可能把结构化 JSON 或来源列表写进正文，`sanitizeAssistantReply` 会在落库和返回前剥掉：
  只删除解析后确实是结构化摘要的代码块和结尾的来源清单，正常代码块不受影响。
  流式路径下删掉过内容时，`done` 事件会带上 `finalContent`，前端用它替换已经流出去的文本，保证气泡和历史一致。

**检索策略（RAG）**

- 默认本地 `BAAI/bge-small-zh-v1.5` 生成 512 维查询向量，PostgreSQL pgvector 按余弦距离 + HNSW 索引召回。
- Railway demo 使用 app 内置 `/v1/embeddings` endpoint，运行 `Xenova/bge-small-zh-v1.5`；本地也可用 compose 中的独立 TEI embeddings 服务。
- 嵌入服务不可用或条目未生成向量时，自动回退到关键词检索，保证可用性。
- `searchKnowledgeWithMeta` 会返回 `mode`、`degraded` 和 `fallbackReason`；降级原因包括 `embedding_disabled`、`no_vector_results` 和 `vector_error`。状态会传给 prompt、Agent 工具结果、SSE `meta`、Agent Run metadata 和聊天记录。
- 默认返回相关度最高的若干条，作为回答依据并展示给用户。

**Agent 工具**

- `searchKnowledge`：检索知识库，返回命中的标题、分类、摘要和分数。
- `createTicket`：在信息不足或需人工跟进时创建工单。
- `listTickets` / `getTicketById`：查询用户有权限访问的工单。
- `addTicketNote`：给工单追加备注或处理记录。

工具入参通过 Zod / JSON Schema 校验；工具参数和结果在前端展示前会做摘要，避免暴露过长内容或敏感信息。

每个工具还接受一个 `reason`：一句第一人称、用用户语言写的话，例如「我查一下退货时限」，**直接显示给用户**。
它是文案不是参数——`splitToolReason` 在校验、哈希和落库前把它摘掉，所以措辞变化不会影响幂等键和重放哈希。

**工具调用的呈现**

`server/agentToolPresentation.ts` 把每次调用翻译成一行给人看的话，形状定义在 `shared/agentActivity.ts`：

- 服务端发的是 `key` + `params`（`searchKnowledge.done` + `{count: 3}`），浏览器按当前语言渲染；
  同时带一份中文 `text`，给没有 i18n 层的渠道兜底。模型写了 `reason` 时，`reason` 永远优先。
- `tool_call` 与 `tool_result` 事件都带 `callId`，前端据此精确配对，并发调用也不会串行错位。
- 前端一行只显示一句：进行中用渐变扫光（`.agent-activity-pending`）表示在跑，完成后把结果接在意图后面，
  例如「我查一下退货时限 · 找到 3 条相关内容」；失败只说这一步没成功，不把原始错误抛给用户。
- 这份 activity 会写进 `agent_run_steps.metadata`，`/runs/:runId` 详情页复用同一套文案。

**执行过程与排查**

- Agent Run 状态：`queued` / `planning` / `running` / `waiting_approval` / `failed` / `completed`。
- Agent Step 类型：`thinking` / `tool_call` / `tool_result` / `final` / `error`。
- `/runs/:runId` 为 Agent Run 详情页，可从聊天回复底部复制 Run UUID 或直接跳转。
- 详情页展示完整状态、步骤、最终回答、失败原因和重试入口；只能查看本工作区的 Run。
- `AGENT_TRACING_ENABLED=true` 时在 Run 元数据里记录 tracing 开关；实际链路追踪由 OTEL 导出，不包含敏感原始数据。

**断线恢复与重试**

- Agent 流事件写入 `agent_run_events` 后再向客户端发送；客户端记录最后一个事件 ID，连接中断时按 `afterSeq` 拉取遗漏事件，最多自动续接 5 次。
- Worker 使用 `leaseOwner`、`leaseExpiresAt`、`heartbeatAt` 和 `attemptCount` 防止多个 Worker 同时执行同一 Run；租约失效后，未完成的工具调用会标记为 `unknown` 并按最大尝试次数恢复或失败。
- 重试链通过 `retryOfRunId` 关联。成功的工具结果可作为 replay context 复用，`createTicket` 和 `addTicketNote` 使用跨重试链的幂等键，避免重复产生业务副作用。
- Worker 重试会发送 `reset` 事件，前端清理上一轮未完成的展示内容，并忽略旧 attempt 的迟到事件。

**结构化结果与转人工**

- Agent 回答会生成结构化摘要：分类、风险等级、摘要、建议动作、是否建议创建工单、引用工单 ID。
- 聊天页展示结构化结果卡片和工具时间线；工具调用默认折叠，可展开查看摘要。
- “转为工单”会把当前用户问题、AI 摘要、建议动作、引用知识库和 Agent Run ID 带入描述；标题取简短问题摘要，不使用固定标题。
- 弹窗居中显示并限制高度，长描述区域可滚动，避免小屏遮挡。

**能力与边界**

- 回答基于知识库内容，降低幻觉；超出知识库范围的问题建议转人工/创建工单。
- 每条消息触发一次 LLM 调用，注意成本与延迟；知识库需定期审查更新。
- Agent 工具执行需遵守权限边界，普通用户不能读取或修改他人工单。

---

## 知识库管理

路径 `/knowledge`，支持单条手动维护与文档批量导入。知识只属于当前工作区，检索时永远带 `workspaceId` 过滤。

**文档导入**

- 支持 **Markdown**（按 `#` / `##` 标题切分为多条）与 **CSV**（表头 `title,content,category,keywords`）。
- 文件通过预签名 URL 分片直传 S3 兼容对象存储；完成后由 BullMQ 投递解析与向量化任务，独立 Knowledge Worker 流式读取文件并批量入库。
- 页面展示**解析状态**与**索引进度**（前端轮询），完成后停止刷新。

**冲突检测**

- 每条新条目嵌入后，与已有条目比对：向量余弦相似度 ≥ 0.88，或归一化标题相同，即标记为「可能冲突」。
- 冲突检测只在同一工作区内比较；冲突条目在列表中**置顶**并显示相似度及最相似条目，由工作区所有者人工取舍。

**增删**

- 可新增、编辑、删除单条条目，或删除整份文档（级联删除其生成的全部条目）。
- 条目保存后会尝试重新生成 embedding；也可手动触发单条重新生成 embedding。
- 列表排序：冲突置顶，其余按更新时间从近到远。

**RAG 调试**

- 访问 `/rag-debug`，输入问题查看召回条目、分类和分数（仅限本工作区的知识）。
- 用于检查知识库命中质量、关键词兜底效果和 embedding 服务状态。

---

## 渠道接入

`server/channels/` 是把工作区的客服接出去的适配层。所有渠道的入站消息都汇聚到同一条管线
`handleInboundChannelMessage`：识别/新建 `channel_contact` → 构造 contact scope 的 `ConversationScope`
→ 调用 `createAgentChatResponse` → 通过适配器回信。

### 为什么先做 Telegram

接入成本是唯一的选择依据：

| 渠道 | 接入成本 | 状态 |
| --- | --- | --- |
| 分享链接（web） | 0，工作区创建时自动开通 | ✅ |
| Telegram | 只需一个 Bot Token，无 OAuth、无应用审核 | ✅ |
| Slack | 需创建 Slack App + OAuth 安装流程 | 规划中 |
| 飞书 | 需在开放平台创建企业自建应用 + 事件订阅校验 | 规划中 |

### Telegram

- **接入**：用户在 @BotFather 拿到 Token 粘贴进来 → `getMe` 校验 → 存入 `workspace_channels.credentials`。
- **收信**：优先注册 webhook 到 `${APP_BASE_URL}/api/channels/telegram/:secret`，
  并带上 `secret_token`；请求必须同时匹配路径与 `X-Telegram-Bot-Api-Secret-Token` 头，否则一律返回 401。
  Webhook 先 ack 200 再异步处理，避免慢回答被 Telegram 判定失败而重投。
- **无公网地址时**：`APP_BASE_URL` 不是公网 HTTPS 时自动回落 `deliveryMode=polling`，
  由 `server/channels/poller.ts` 的单个 interval 统一拉取 `getUpdates`。这是本地开发便利，不是第二条生产路径。
- **并发**：同一 contact 同时只跑一次 Agent（内存锁），避免连发三条消息触发三个互相覆盖的 Run。
- **暂停自动回复**：`autoReply=false` 时只记录消息不回答，用于临时接管。

### 分享链接（web 渠道）

`/a/:publicKey` 是免登录页面。访客身份由浏览器本地的随机 `visitorId` 决定，映射为一个 `channel_contact`，
因此同一浏览器再次打开能续上历史。公开入口按工作区做了突发限流，`publicChatEnabled=false` 可立即关闭。

**安全**：`workspace_channels.credentials` 保存 bot token，任何面向客户端的响应都必须经 `toChannelDto` 剥离。

---

## 新用户引导

`/onboarding` 是注册后的默认落点，未完成前访问其它页面会被 `useWorkspace` 推回来。四步：

1. **介绍你的业务** —— 工作区名称、客服名称、语气、业务背景。这些直接进入系统提示词。
2. **导入知识** —— 粘贴 Markdown（`## 标题` 分段）、上传文件，或一键填入示例。
3. **试聊一次** —— 调用 `chat.ask`（阻塞式单轮，不走 SSE）确认回答质量。
4. **接出去** —— 复制分享链接，或粘贴 Telegram Bot Token。

进度存在 `workspaces.onboardingStep`，刷新或换设备都能续上；`onboardingCompletedAt` 落库后才算走完。
每一步都可跳过——引导是帮助，不是关卡。

---

## 用户使用手册

- **注册与登录**：邮箱密码或 Google OAuth；密码使用 scrypt 哈希，OAuth 使用 Authorization Code + PKCE，浏览器只保存 HttpOnly Cookie。
  注册后自动开通工作区并进入 `/onboarding` 四步引导，走完才进工作台。
- **创建工单**：填写标题、描述、优先级后提交，系统返回工单 ID。
- **查看工单**：支持按状态/优先级筛选与标题搜索；详情页查看信息、流转状态、添加备注。
- **智能客服**：在聊天页提问，AI 基于知识库回答并展示引用来源、执行过程和结构化摘要，多轮对话自动保存。
- **连接恢复**：Agent 回复过程中网络短暂中断时，聊天页会自动按 Run ID 续接已持久化事件；若知识库检索降级为关键词匹配，页面会提示答案需要人工确认。
- **转为工单**：在 AI 回复上点击“转为工单”，系统会预填简短标题和对话摘要，用户确认后创建工单。
- **Agent Run 排查**：从聊天回复跳转 `/runs/:runId`，查看 Agent 执行步骤和失败原因。
- **渠道接入**：`/channels` 复制免登录分享链接，或粘贴 Telegram Bot Token 接入。
  有公网 HTTPS 地址时注册 webhook，否则自动回落到 `getUpdates` 轮询，本地开发同样可用。
- **客户会话**：`/inbox` 只读查看外部访客的完整对话。想改变回答就去改知识库或客服设置。

**优先级与建议响应时间**：低 2–3 天 / 中 24 小时 / 高 4–8 小时 / 紧急 1–2 小时。

---

## 开发者指南

### 项目结构

```
client/          前端（pages 页面、components 组件、lib 工具）
server/          后端（routers.ts 路由、chatStream.ts 流式聊天、agentService.ts Agent、agentPersona.ts 人设与指令、
                 agentToolPresentation.ts 工具文案、agentRunExecution.ts 执行编排、
                 agentWorker.ts Worker、workspace.ts 工作区与 scope、accessControl.ts 权限边界、db.ts 数据访问、
                 channels/ 渠道适配与入站管线、knowledge/ 文档解析与导入、_core/ 框架）
shared/          前后端共用类型（agentActivity.ts 执行过程文案协议、agentModels.ts 模型展示规则、
                 plans.ts 套餐、types.ts 统一导出）
drizzle/         schema.ts 表定义 + 迁移文件
scripts/         seed-data、embed-knowledge 等工具脚本
compose.yaml     postgres + embeddings 本地服务；Railway demo 使用 app 内置 embedding endpoint
```

### 常用命令

```bash
pnpm dev            # 开发（前后端一体，默认 http://localhost:3000）
pnpm check          # TypeScript 类型检查
pnpm test           # 运行测试（vitest）
pnpm build          # 生产构建
pnpm worker         # 启动生产 Agent Worker
pnpm worker:dev     # 本地开发 Agent Worker
pnpm db:generate    # 由 schema 生成迁移
pnpm db:migrate     # 应用迁移
pnpm db:seed        # 灌入示例数据
pnpm auth:create-user  # 创建账号并开通其工作区（需要 SEED_USER_EMAIL / SEED_USER_PASSWORD）
pnpm kb:embed       # 为未生成向量的条目回填 embedding
pnpm kb:embed:check # 检查 embedding 服务连通性
```

### 扩展约定

- **加表**：改 `drizzle/schema.ts` → `db:generate` → `db:migrate` → 在 `db.ts` 加查询函数。
- **加接口**：在 `server/routers.ts` 用 `workspaceProcedure` 加 procedure，从 `ctx.workspace` / `ctx.scope` 取隔离条件，调用 `db.ts` 函数。
  任何读写业务数据的 `db.ts` 函数都必须接受并使用 `workspaceId`——这是隔离的唯一保障。
- **加渠道**：在 `server/channels/` 实现 `ChannelAdapter`，注册进 `inbound.ts` 的 `ADAPTERS`，
  并在 `types.ts` 的 `CHANNEL_PROVIDERS` 标记为 available。入站统一走 `handleInboundChannelMessage`。
- **加页面**：在 `client/src/pages/` 建组件，用 `trpc.*.useQuery/useMutation` 取数，在 `App.tsx` 注册路由。
- **加 Agent 工具**：在 `server/agentService.ts` 定义 tool、入参 schema（带 `reason`）、权限校验、脱敏摘要和事件持久化，
  再到 `server/agentToolPresentation.ts` 补上调用中/完成两句文案，并在 `shared/agentActivity.ts` 与 `client/src/i18n/*` 加对应 key。
- **改 Agent 说话方式**：只改 `server/agentPersona.ts`；安全边界那几条是 prompt injection 防线的一部分，改动前先看 `server/knowledge/prompt-injection-defense.md`。
- **加流式能力**：在 `server/chatStream.ts` 扩展 SSE payload，并同步更新聊天页事件处理。
- **改 Agent Run schema**：修改 `agent_runs`、`agent_run_steps`、`agent_run_events`、`agent_tool_invocations` 或 `agent_tool_effects` 后必须执行 `pnpm db:generate` 与 `pnpm db:migrate`。

---

## 部署与运维

### 本地启动

```bash
pnpm install
docker compose up -d postgres embeddings   # 启动数据库与本地 embedding 服务
pnpm db:migrate && pnpm db:seed            # 建表 + 示例数据
pnpm kb:embed                              # 回填知识库向量
pnpm dev
```

> 端口：应用 3000、PostgreSQL 5432、embeddings 8080。embeddings 镜像仅有 amd64 版本，Apple 芯片需在 `compose.yaml` 中以 `platform: linux/amd64` 经 Rosetta 运行；首次会下载 `BAAI/bge-small-zh-v1.5` 权重并缓存到 `tei_data` 卷。
>
> 部署前务必执行 `pnpm db:migrate`，否则聊天会因缺少 `agent_runs` / `agent_run_steps` 表而失败。

### 环境变量（要点）

```
# 数据库
DATABASE_URL=postgres://user:password@host:5432/customer_service_agent

# Google OAuth；缺失时登录入口自动隐藏
APP_BASE_URL=https://your-app.example.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# 命令行开号使用，不需要长期注入应用运行环境
SEED_USER_EMAIL=demo@example.com
SEED_USER_PASSWORD=replace-with-a-strong-password
SEED_USER_NAME=示例用户

# LLM（OpenAI 兼容）
OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
AGENT_TRACING_ENABLED=false
AGENT_HANDOFFS_ENABLED=false
AGENT_EXECUTION_MODE=inline    # inline 或 worker；生产 Web + Worker 使用 worker
AGENT_WORKER_POLL_MS=500
AGENT_WORKER_LEASE_MS=60000
AGENT_WORKER_MAX_ATTEMPTS=3

# Embedding（local / openai / voyage）
EMBEDDING_PROVIDER=local
LOCAL_EMBEDDING_BASE_URL=http://localhost:8080
LOCAL_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
LOCAL_EMBEDDING_PATH=/v1/embeddings
LOCAL_EMBEDDING_RUNTIME_MODEL=Xenova/bge-small-zh-v1.5
LOCAL_EMBEDDING_API_KEY=      # 设置后 /v1/embeddings 需要 Bearer token
RAG_EMBEDDINGS_ENABLED=true   # 设为 false 时仅用关键词检索
OPENAI_EMBEDDING_MODEL / VOYAGE_EMBEDDING_MODEL
```

完整项可参考 `.env.example`。

### Railway Demo

当前 demo 部署在 Railway：

- 应用：[https://app-production-35d3.up.railway.app](https://app-production-35d3.up.railway.app)
- 登录：`/login`；注册：`/register`
- 数据库：Railway Postgres + pgvector
- Embedding：app 内置 `/v1/embeddings`，运行 `Xenova/bge-small-zh-v1.5`，对外模型名 `BAAI/bge-small-zh-v1.5`，返回 512 维向量

Railway app 关键变量：

```bash
APP_BASE_URL=https://app-production-35d3.up.railway.app
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
EMBEDDING_PROVIDER=local
LOCAL_EMBEDDING_BASE_URL=http://127.0.0.1:8080
LOCAL_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
LOCAL_EMBEDDING_RUNTIME_MODEL=Xenova/bge-small-zh-v1.5
LOCAL_EMBEDDING_PATH=/v1/embeddings
RAG_EMBEDDINGS_ENABLED=true
RAILPACK_NODE_VERSION=20
TRANSFORMERS_CACHE=/tmp/transformers-cache
AGENT_EXECUTION_MODE=worker
```

Agent 模式的 Railway 部署需要单独创建 `agent-worker` Service。Web Service 只负责入队和 SSE 订阅，Worker 使用相同的数据库、LLM、聊天模式和 embedding 配置，通过 PostgreSQL 租约领取 queued Run；Worker 在 Railway `PORT` 上提供内部 `/api/health` 探针，不需要公网域名。

`LOCAL_EMBEDDING_API_KEY` 在 Railway 中作为服务内 token 设置。公网未授权请求 `/v1/embeddings` 会返回 `401`，后端自调用会带 Bearer token。

旧的独立 `embeddings` Railway 服务已不再作为主路径使用；demo 主链路依赖 app 内置 embedding endpoint。

### 排查与维护

- 服务问题先看后端日志；嵌入相关用 `pnpm kb:embed:check`，本地独立 TEI 服务可看 `docker logs customer_service_agent_embeddings`，Railway demo 主要看 app 日志。
- 聊天失败且错误指向 `agent_runs` 时，先执行 `pnpm db:migrate`，再重试 `/api/chat/stream`。
- Agent 连接中断时先确认 `agent_run_events` 已完成迁移；随后可按 Run ID 刷新 `/runs/:runId`，检查事件、attempt、租约和最终状态。
- Worker 反复重试或出现租约错误时，检查 `AGENT_WORKER_LEASE_MS`、数据库时钟、Worker 日志和 `agent_runs.leaseExpiresAt`；不要通过重复发送消息来恢复连接。
- 如果聊天显示关键词降级，使用 `pnpm kb:embed:check` 检查 embedding 服务，并确认 `RAG_EMBEDDINGS_ENABLED`、`LOCAL_EMBEDDING_API_KEY` 与服务端配置一致。
- Agent 回答生成了部分文本后出现 SDK 完成态异常时，后端会尽量保存最终回答和 Run metadata；详情页 `/runs/:runId` 可查看步骤和错误。
- OpenAI tracing 导出网络失败不会阻断聊天主流程；排查 tracing 时先看 `AGENT_TRACING_ENABLED` 和网络出口。
- 登录异常先检查 `sessions` 是否过期或撤销、Cookie 的 Secure/SameSite 属性与反向代理 HTTPS 头；Google 登录还需核对 `${APP_BASE_URL}/api/auth/oauth/google/callback` 与 Console 配置完全一致。
- 备份：`pg_dump "$DATABASE_URL" > backup.sql`；恢复：`psql "$DATABASE_URL" < backup.sql`。

---

## 附录

### 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、Tailwind CSS 4、shadcn/ui、wouter |
| 数据/状态 | tRPC 11、React Query |
| 后端 | Express 4、tRPC 11 |
| 数据库 | PostgreSQL 16 + pgvector、Drizzle ORM |
| 向量 | BAAI/bge-small-zh-v1.5（本地，512 维）/ OpenAI / Voyage |
| LLM | pi Agent SDK（OpenAI 兼容网关） |
| Agent | pi Agent SDK（`@earendil-works/pi-coding-agent`） |
| 认证 | 邮箱密码 + Google OAuth + PostgreSQL Session |
| 渠道 | Telegram Bot API（webhook / getUpdates 轮询） |

### 参考

- [tRPC](https://trpc.io) · [Drizzle ORM](https://orm.drizzle.team) · [React](https://react.dev) · [Tailwind CSS](https://tailwindcss.com) · [shadcn/ui](https://ui.shadcn.com) · [pgvector](https://github.com/pgvector/pgvector)
