# 客服工单 Agent 系统文档

AI 驱动的客服工单系统：工单全生命周期管理 + 基于 RAG/Agent 的智能客服 + 可维护的知识库 + Agent Run 可观测排查。

## 目录

1. [系统架构](#系统架构)
2. [核心模块](#核心模块)
3. [智能客服 Agent](#智能客服-agent)
4. [知识库管理](#知识库管理)
5. [用户使用手册](#用户使用手册)
6. [开发者指南](#开发者指南)
7. [部署与运维](#部署与运维)
8. [附录](#附录)

---

## 系统架构

```
前端 (React 19 + Tailwind + shadcn/ui)
   │  tRPC（端到端类型安全）+ SSE 流式聊天
后端 (Express + tRPC + OpenAI Agents SDK)
   │
   ├── PostgreSQL + pgvector   数据 & 向量存储
   ├── Embedding 服务          本地 bge-small-zh-v1.5 / OpenAI / Voyage
   └── LLM API                 OpenAI 兼容 / Manus Forge
```

- **前端**：页面分为首页、工单管理、智能客服、知识库、RAG 调试、Agent Run 详情、管理仪表盘；路由用 wouter，数据用 tRPC + React Query。
- **后端**：tRPC 路由按域划分（`tickets` / `knowledge` / `chat` / `agentRuns` / `auth` / `system`），数据库访问集中在 `server/db.ts`。
- **认证**：邮箱密码注册登录，随机 Session Token 的哈希保存在 PostgreSQL；普通用户与管理员实行接口级权限隔离。

---

## 核心模块

| 模块 | 职责 |
| --- | --- |
| 工单管理 | 创建、筛选/搜索、详情、状态与优先级流转、备注、统计 |
| 知识库 | 知识条目的存储、检索、文档批量导入、冲突检测、增删 |
| 智能客服 Agent | RAG 检索 + LLM/Agent 生成回答，展示执行过程，保存对话并标注引用来源 |
| Agent Run 排查 | 持久化 Agent 运行记录、步骤、失败原因、结构化结果，支持详情页查看和重试 |
| 认证与权限 | 邮箱密码登录、数据库 Session、角色与接口权限；账号表为后续 OAuth 预留 |

### 数据模型（概览）

- **users**：用户资料与角色（user / admin）。
- **auth_accounts**：登录凭证账号；第一阶段使用 password provider，后续 OAuth 复用此表。
- **sessions**：可撤销登录会话，只保存 Session Token 哈希、有效期和设备摘要。
- **tickets**：工单，含状态（pending / in_progress / resolved / closed）与优先级（low / medium / high / urgent）。
- **ticket_notes**：工单备注与状态变更记录。
- **knowledge_base**：知识条目，含向量 `embedding`、来源文档 `documentId`、嵌入状态、冲突标记（`conflictWith` / `conflictScore`）。
- **knowledge_documents**：上传文档，记录解析状态、索引进度（`totalChunks`）等。
- **chat_messages**：对话记录，保存引用的知识库条目快照。
- **agent_runs**：Agent 单次运行记录，保存输入、状态、最终回答、错误、模型、重试来源和 metadata。
- **agent_run_steps**：Agent 运行步骤，记录 `thinking` / `tool_call` / `tool_result` / `final` / `error`。

表结构以 `drizzle/schema.ts` 为准；变更通过 `pnpm db:generate` + `pnpm db:migrate` 管理。

---

## 智能客服 Agent

系统支持两种聊天运行模式，由 `CHAT_MODE` 控制：

- `CHAT_MODE=rag`：直接 RAG 流程，用户提问 → 检索知识库 → 组织 prompt 调用 LLM → 返回回答并保存引用来源。
- `CHAT_MODE=agent`：服务端 OpenAI Agents SDK 流程，用户提问 → 创建 Agent Run → Agent 调用工具 → SSE 推送执行事件和文本增量 → 保存最终回答、结构化结果和步骤。

聊天页优先使用 `/api/chat/stream`，以 SSE 返回 `agent_event`、`delta`、`meta`、`done` 或 `error`。非流式 tRPC `chat.sendMessage` 仍保留，用于兼容和测试。

**检索策略（RAG）**

- 默认本地 `BAAI/bge-small-zh-v1.5` 生成 512 维查询向量，PostgreSQL pgvector 按余弦距离 + HNSW 索引召回。
- Railway demo 使用 app 内置 `/v1/embeddings` endpoint，运行 `Xenova/bge-small-zh-v1.5`；本地也可用 compose 中的独立 TEI embeddings 服务。
- 嵌入服务不可用或条目未生成向量时，自动回退到关键词检索，保证可用性。
- 默认返回相关度最高的若干条，作为回答依据并展示给用户。

**Agent 工具**

- `searchKnowledge`：检索知识库，返回命中的标题、分类、摘要和分数。
- `createTicket`：在信息不足或需人工跟进时创建工单。
- `listTickets` / `getTicketById`：查询用户有权限访问的工单。
- `addTicketNote`：给工单追加备注或处理记录。

工具入参通过 Zod / JSON Schema 校验；工具参数和结果在前端展示前会做摘要，避免暴露过长内容或敏感信息。

**执行过程与排查**

- Agent Run 状态：`queued` / `planning` / `running` / `waiting_approval` / `failed` / `completed`。
- Agent Step 类型：`thinking` / `tool_call` / `tool_result` / `final` / `error`。
- `/runs/:runId` 为 Agent Run 详情页，管理员可从首页「Agent Run 排查」输入 Run ID 跳转。
- 详情页展示完整状态、步骤、最终回答、失败原因和重试入口；普通用户只能查看自己的 Run，管理员可查看全部。
- `AGENT_TRACING_ENABLED=true` 时启用 OpenAI Agents tracing；trace 不包含敏感原始数据。

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

支持单条手动维护，也支持文档批量导入（管理员，路径 `/admin/knowledge`）。

**文档导入**

- 支持 **Markdown**（按 `#` / `##` 标题切分为多条）与 **CSV**（表头 `title,content,category,keywords`）。
- 文件以文本经 tRPC 上传，后台异步解析、入库并逐条构建向量。
- 页面展示**解析状态**与**索引进度**（前端轮询），完成后停止刷新。

**冲突检测**

- 每条新条目嵌入后，与已有条目比对：向量余弦相似度 ≥ 0.88，或归一化标题相同，即标记为「可能冲突」。
- 冲突条目在列表中**置顶**并显示相似度及最相似条目，由管理员人工取舍。

**增删**

- 可新增、编辑、删除单条条目，或删除整份文档（级联删除其生成的全部条目）。
- 条目保存后会尝试重新生成 embedding；也可手动触发单条重新生成 embedding。
- 列表排序：冲突置顶，其余按更新时间从近到远。

**RAG 调试**

- 管理员可访问 `/admin/rag-debug`，输入问题查看召回条目、分类和分数。
- 用于检查知识库命中质量、关键词兜底效果和 embedding 服务状态。

---

## 用户使用手册

- **注册与登录**：用户访问 `/register` 创建邮箱账号，通过 `/login` 登录；密码使用 scrypt 哈希，浏览器只保存 HttpOnly Session Cookie。
- **创建工单**：填写标题、描述、优先级后提交，系统返回工单 ID。
- **查看工单**：支持按状态/优先级筛选与标题搜索；详情页查看信息、流转状态、添加备注。
- **智能客服**：在聊天页提问，AI 基于知识库回答并展示引用来源、执行过程和结构化摘要，多轮对话自动保存。
- **转为工单**：在 AI 回复上点击“转为工单”，系统会预填简短标题和对话摘要，用户确认后创建工单。
- **Agent Run 排查**：管理员可在首页输入 Run ID 跳转 `/runs/:runId`，查看 Agent 执行步骤和失败原因。
- **管理员**：仪表盘查看工单统计与分布；知识库页维护条目与导入文档；RAG 调试页检查召回效果。

**优先级与建议响应时间**：低 2–3 天 / 中 24 小时 / 高 4–8 小时 / 紧急 1–2 小时。

---

## 开发者指南

### 项目结构

```
client/          前端（pages 页面、components 组件、lib 工具）
server/          后端（routers.ts 路由、chatStream.ts 流式聊天、agentService.ts Agent、db.ts 数据访问、knowledge/ 文档解析与导入、_core/ 框架）
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
pnpm db:generate    # 由 schema 生成迁移
pnpm db:migrate     # 应用迁移
pnpm db:seed        # 灌入示例数据
pnpm auth:create-admin # 创建或提升管理员账号（需要 ADMIN_EMAIL / ADMIN_PASSWORD）
pnpm kb:embed       # 为未生成向量的条目回填 embedding
pnpm kb:embed:check # 检查 embedding 服务连通性
```

### 扩展约定

- **加表**：改 `drizzle/schema.ts` → `db:generate` → `db:migrate` → 在 `db.ts` 加查询函数。
- **加接口**：在 `server/routers.ts` 加 procedure（管理员能力需校验 `ctx.user.role`），调用 `db.ts` 函数。
- **加页面**：在 `client/src/pages/` 建组件，用 `trpc.*.useQuery/useMutation` 取数，在 `App.tsx` 注册路由。
- **加 Agent 工具**：在 `server/agentService.ts` 定义 tool、入参 schema、权限校验、脱敏摘要和事件持久化。
- **加流式能力**：在 `server/chatStream.ts` 扩展 SSE payload，并同步更新聊天页事件处理。
- **改 Agent Run schema**：修改 `agent_runs` 或 `agent_run_steps` 后必须执行 `pnpm db:generate` 与 `pnpm db:migrate`。

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
> 更新到包含 Agent Run 的版本后，务必执行 `pnpm db:migrate`，否则聊天在 `CHAT_MODE=agent` 下会因缺少 `agent_runs` / `agent_run_steps` 表而失败。

### 环境变量（要点）

```
# 数据库
DATABASE_URL=postgres://user:password@host:5432/customer_service_agent

# 管理员初始化命令使用，不需要长期注入应用运行环境
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_NAME=系统管理员

# LLM（openai 兼容 或 manus）
LLM_PROVIDER=openai
OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
CHAT_MODE=rag                  # rag 或 agent
AGENT_TRACING_ENABLED=false
AGENT_HANDOFFS_ENABLED=false

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
EMBEDDING_PROVIDER=local
LOCAL_EMBEDDING_BASE_URL=http://127.0.0.1:8080
LOCAL_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
LOCAL_EMBEDDING_RUNTIME_MODEL=Xenova/bge-small-zh-v1.5
LOCAL_EMBEDDING_PATH=/v1/embeddings
RAG_EMBEDDINGS_ENABLED=true
RAILPACK_NODE_VERSION=20
TRANSFORMERS_CACHE=/tmp/transformers-cache
```

`LOCAL_EMBEDDING_API_KEY` 在 Railway 中作为服务内 token 设置。公网未授权请求 `/v1/embeddings` 会返回 `401`，后端自调用会带 Bearer token。

旧的独立 `embeddings` Railway 服务已不再作为主路径使用；demo 主链路依赖 app 内置 embedding endpoint。

### 排查与维护

- 服务问题先看后端日志与 `.manus-logs/`；嵌入相关用 `pnpm kb:embed:check`，本地独立 TEI 服务可看 `docker logs customer_service_agent_embeddings`，Railway demo 主要看 app 日志。
- 聊天失败且错误指向 `agent_runs` 时，先执行 `pnpm db:migrate`，再重试 `/api/chat/stream`。
- Agent 回答生成了部分文本后出现 SDK 完成态异常时，后端会尽量保存最终回答和 Run metadata；详情页 `/runs/:runId` 可查看步骤和错误。
- OpenAI tracing 导出网络失败不会阻断聊天主流程；排查 tracing 时先看 `AGENT_TRACING_ENABLED` 和网络出口。
- 登录异常先检查 `sessions` 是否过期或撤销、Cookie 的 Secure/SameSite 属性与反向代理 HTTPS 头。
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
| LLM | OpenAI Responses API / Manus Forge |
| Agent | OpenAI Agents SDK |
| 认证 | 邮箱密码 + PostgreSQL Session；OAuth 预留账号模型 |

### 参考

- [tRPC](https://trpc.io) · [Drizzle ORM](https://orm.drizzle.team) · [React](https://react.dev) · [Tailwind CSS](https://tailwindcss.com) · [shadcn/ui](https://ui.shadcn.com) · [pgvector](https://github.com/pgvector/pgvector)
