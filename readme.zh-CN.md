# Linply

**简体中文** · [English](./readme.md)

多租户的自助智能客服：**每个注册用户拥有一个只属于自己的工作区**——自己的知识库、自己的客户会话、自己的渠道连接。
系统里没有跨工作区的管理员，任何数据都按 `workspaceId` 隔离。

## 技术栈

- 前端：React 19、Tailwind CSS 4、shadcn/ui、wouter
- 数据与接口：tRPC 11、React Query
- 后端：Express 4、OpenAI Agents SDK
- 数据库、队列与存储：PostgreSQL 16 + pgvector、Drizzle ORM；Redis Session 缓存 + BullMQ；S3 兼容对象存储
- 向量服务：本地 `BAAI/bge-small-zh-v1.5`（512 维）/ OpenAI / Voyage
- LLM：OpenAI Agents SDK
- 认证：邮箱密码 + Google OAuth、数据库 Session、按工作区隔离
- 渠道：Telegram Bot（webhook / 轮询）、免登录分享链接

## 套餐

| | Free | Pro $5/月 | Business $20/月 | 自部署 |
|---|---|---|---|---|
| 知识条目 | 100 | 2,000 | 20,000 | 不限 |
| 每日 Credit | 100 | 1,000 | 5,000 | 不限 |
| 已接渠道 | 1 | 3 | 10 | 不限 |
| 客户数 / 30 天 | 100 | 2,000 | 20,000 | 不限 |
| 去掉 Linply 标识 | — | ✅ | ✅ | ✅ |
| 客户资料卡 | — | — | ✅ | ✅ |

套餐目录定义在 `shared/plans.ts`，服务端用它做额度校验，前端 `/plans` 用它渲染，两边不会漂移。
**支付尚未接入**：升级只会往 `plan_requests` 写一条待处理意向，不扣费、不改套餐。

## 核心能力

- **工作区**：注册即自动开通，包含名称、客服人设（名称/语气/业务背景/兜底话术）和一条内置的 `web` 渠道。
- **新用户引导**：`/onboarding` 四步向导——介绍业务 → 导入知识 → 试聊一次 → 接出去，走完才进工作台。
- **知识库**：粘贴问答、上传 Markdown/CSV（multipart 直传 + BullMQ 流式解析）、embedding 回填、冲突检测、Prompt Injection 扫描。
- **智能客服**：OpenAI Agents SDK 调用知识库与工单工具；系统提示词按工作区人设动态生成；SSE 流式事件与断线恢复。
- **渠道接入**：Telegram 粘贴 Bot Token 即接入（有公网 HTTPS 用 webhook，否则自动回落轮询）；免登录分享链接 `/a/:publicKey`。Slack / 飞书在渠道页标注为规划中。
- **客户会话**：外部访客以 `channel_contacts` 记录，不注册不登录；工作区所有者在「客户会话」只读查看完整对话。
- **工单**：客服答不上来时转人工产生的记录，同样按工作区隔离。
- **Agent Run 排查**：UUID 标识运行，保存步骤、最终回答、错误和结构化结果，支持查看与重试。

### 数据隔离模型

授权只有两条规则，没有角色：

1. 一行数据只能从它所属的 workspace 访问。
2. workspace 内部，所有者（console scope）看全部；外部访客（contact scope）只看自己的。

tRPC 侧由 `workspaceProcedure` 统一注入 `ctx.workspace` 与 `ctx.scope`，`server/accessControl.ts` 是唯一的判定入口。

## 本地启动

```bash
pnpm install
docker compose up -d postgres redis embeddings minio minio-init
pnpm db:migrate
pnpm dev
```

默认访问地址：

- 应用：http://localhost:3000
- PostgreSQL：localhost:5432
- Redis：localhost:6379（可选；未配置时认证直接查询 PostgreSQL）
- 本地 embedding 服务：http://localhost:8080
- MinIO S3 API：http://localhost:9000；管理界面：http://localhost:9001

账号入口：

- 注册：http://localhost:3000/register —— 注册后会自动开通工作区并进入 `/onboarding`
- 登录：http://localhost:3000/login

所有账号都是同一类：注册即拥有自己的工作区。`pnpm db:seed` 可灌入一份带知识库和工单的示例工作区，
`pnpm auth:create-user` 可在命令行直接开一个账号（用于预置体验入口）。

## 环境变量

复制 `.env.example` 并按环境配置：

```bash
cp .env.example .env
```

关键配置：

- `DATABASE_URL`：PostgreSQL 连接串。
- `REDIS_URL`：可选的登录 Session 缓存连接串；缺失或 Redis 故障时自动回退 PostgreSQL。
- `QUEUE_REDIS_URL`：BullMQ 连接串；初期可与 `REDIS_URL` 相同，生产高负载时建议独立 Redis。
- `AWS_ENDPOINT_URL` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET_NAME`：知识库原始文件对象存储。未配置时仅保留旧的 50 MB 本地兼容上传路径。
- `KNOWLEDGE_UPLOAD_PART_SIZE_MB=16`：浏览器 multipart 分片基准大小；超大文件会自动增大分片以满足 S3 最多 10,000 片的约束。
- `SESSION_CACHE_TTL_MS=60000`：认证用户与权限快照的短 TTL，上限 5 分钟，不改变数据库中的 30 天绝对 Session 到期时间。角色降权或禁用用户时应同时撤销其 Session，而不是依赖 TTL 自然过期。
- `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`：`pnpm db:seed` 与 `pnpm auth:create-user` 使用的示例账号。
- `DEMO_ACCOUNT_EMAIL` / `DEMO_ACCOUNT_PASSWORD`：可选，登录页「一键进入体验账号」；账号需先存在，无任何特权。
- `APP_BASE_URL`：应用公网 origin。用于 OAuth callback，同时决定 Telegram 用 webhook 还是轮询——
  只有公网 HTTPS 地址才会注册 webhook，本地开发自动回落到 `getUpdates` 轮询。
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google OAuth Web Client 凭证；缺失时入口自动隐藏。
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`：OpenAI 兼容模型配置。
- `EMBEDDING_PROVIDER=local|openai|voyage`：embedding provider。
- `LOCAL_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5`：本地 embedding 对外模型名，向量维度为 512。
- `LOCAL_EMBEDDING_RUNTIME_MODEL=Xenova/bge-small-zh-v1.5`：app 内置 Transformers.js endpoint 的运行模型。
- `LOCAL_EMBEDDING_API_KEY`：可选；设置后 `/v1/embeddings` 需要 Bearer token。
- `RAG_EMBEDDINGS_ENABLED=true|false`：关闭后使用关键词检索兜底。
- `AGENT_TRACING_ENABLED=false`：开启 OpenAI Agents tracing 时仍不包含敏感原始数据。
- `OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=...`：通过 OTLP/HTTP 导出 Web、Worker、Agent 工具和模型 HTTP 链路；Web 与 Worker 应使用同一 Collector。
- `OPENAI_CONTEXT_WINDOW_TOKENS=272000`：仅用于聊天和 Run 详情中的 Token 窗口占比参考。
- `AGENT_EXECUTION_MODE=inline|worker`：本地默认 `inline`；Railway Web 服务使用 `worker`，只负责创建 queued Run。
- `AGENT_WORKER_POLL_MS` / `AGENT_WORKER_LEASE_MS` / `AGENT_WORKER_MAX_ATTEMPTS`：独立 worker 的轮询、租约和最大尝试次数。

完整说明见 `.env.example` 和 [上线准备说明](references/deployment-readiness.md)。

## 常用命令

```bash
pnpm dev            # 开发服务
pnpm check          # TypeScript 类型检查
pnpm test           # 运行 Vitest 测试
pnpm build          # 生产构建
pnpm start          # 启动生产构建
pnpm worker         # 启动生产 Agent worker
pnpm worker:dev     # 本地开发 Agent worker
pnpm knowledge:worker     # 启动生产知识库 Worker
pnpm knowledge:worker:dev # 本地开发知识库 Worker
pnpm db:generate    # 根据 schema 生成迁移
pnpm db:migrate     # 应用迁移
pnpm db:seed        # 初始化示例数据
pnpm auth:create-user  # 创建账号并开通其工作区
pnpm kb:embed       # 回填知识库 embedding
pnpm kb:embed:check # 检查 embedding 服务连通性
pnpm kb:storage:cors # 为 APP_BASE_URL 配置 Bucket 浏览器直传 CORS
```

## 项目结构

```text
client/          前端页面、组件、hooks、tRPC 客户端
server/          后端路由、聊天、Agent、数据库访问、知识库导入
server/channels/ 渠道适配层：Telegram 适配器、入站管线、webhook 路由、分享链接
server/workspace.ts  工作区开通与 scope 定义
drizzle/         数据库 schema 与迁移文件
scripts/         seed、embedding 回填和诊断脚本
references/      阶段说明和部署准备文档
test-data/       知识库导入测试数据
```

## 测试覆盖

当前测试覆盖：

- OpenAI provider Responses API mock 与错误脱敏
- embedding 请求、解析、cosine similarity
- RAG 关键词召回质量
- Agent tool 入参校验、结果摘要、结构化输出兜底
- Agent Run 状态与步骤类型
- 密码哈希、Google OAuth PKCE/state、数据库 Session 与认证登出
- 工作区隔离（跨工作区读写全部拒绝、列表查询强制带 workspaceId、首次访问自动开通工作区）
- 知识库解析、基础工单 smoke flow

运行：

```bash
pnpm check
pnpm test
```

## Railway Demo 部署

当前 demo 已部署在 Railway：

- 应用：[https://app-production-35d3.up.railway.app](https://app-production-35d3.up.railway.app)
- 登录：`/login`；注册：`/register`
- 数据库：Railway Postgres + pgvector
- Embedding：app 内置 `/v1/embeddings`，运行 `Xenova/bge-small-zh-v1.5`，返回 512 维向量

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

Agent 模式使用独立 Railway Service：

```text
Service: agent-worker
Shared config: /railway.json
Start command: pnpm railway:start（按 RAILWAY_SERVICE_NAME 选择 Web 或 worker）
DATABASE_URL: ${{Postgres.DATABASE_URL}}
REDIS_URL: ${{Redis.REDIS_URL}}
LOCAL_EMBEDDING_BASE_URL: ${{app.APP_BASE_URL}}
```

worker 还需与 app 使用相同的 `OPENAI_*` 和必要的 tracing 配置。它通过 PostgreSQL 租约领取 queued Run；Web 服务只负责入队和 SSE 事件订阅。Redis 只用于 Web 登录认证缓存，因此 `REDIS_URL` 仅需配置在 app Web 服务，Worker 不需要。Railway 的 `app.PORT` 不是可跨服务引用的配置变量，因此 worker 的 embedding 地址使用 app 的 HTTPS 地址，并继续携带 `LOCAL_EMBEDDING_API_KEY`。仓库也保留了 `/railway.worker.json`，可在 Dashboard 单独绑定时使用。
worker 会在 Railway 分配的 `PORT` 上提供内部 `/api/health` 探针，但不配置公网域名。

大文件知识库导入还需要 Railway Bucket 和独立 `knowledge-worker` Service。Web 与 Knowledge Worker 都配置 Bucket 的 `AWS_*` 变量和 `QUEUE_REDIS_URL=${{Redis.REDIS_URL}}`，Worker 启动命令为 `pnpm knowledge:worker`。浏览器直传前，在 Web Service 的生产变量环境中运行一次 `pnpm kb:storage:cors`，将 Bucket CORS 限制到 `APP_BASE_URL`。

`LOCAL_EMBEDDING_API_KEY` 在 Railway 中已设置为服务内 token。公网直接访问 `/v1/embeddings` 会返回 `401`，后端自调用会带 Bearer token。

旧的独立 `embeddings` Railway 服务已不再作为主路径使用；demo 主链路依赖 app 内置 embedding endpoint。

## 部署要点

1. 设置生产环境变量，尤其是 `DATABASE_URL`、`APP_BASE_URL`、LLM 和 embedding 配置。
2. 执行 `pnpm db:migrate`。
3. 如需登录页的体验入口，运行一次 `pnpm auth:create-user` 并配置 `DEMO_ACCOUNT_*`。
4. 执行 `pnpm kb:embed` 回填知识库向量；切换模型后旧向量会被重置，需要重新生成。
5. 在 Google Cloud Console 把授权回调 URI 配置为 `${APP_BASE_URL}/api/auth/oauth/google/callback`。
6. 创建名为 `agent-worker` 的独立 Service；共享 `/railway.json` 会按服务名启动 `pnpm worker`，并给 Web 服务设置 `AGENT_EXECUTION_MODE=worker`。
7. 创建 Railway Bucket 和名为 `knowledge-worker` 的独立 Service，注入相同的 Bucket、Redis、数据库和 embedding 配置，并执行一次 `pnpm kb:storage:cors`。
8. 使用 `NODE_ENV=production pnpm start` 启动 Web 服务并检查：邮箱登录、Google 登录、**跨工作区隔离**、
   分片上传、知识库解析、Agent Run 租约恢复，以及 Telegram webhook（`${APP_BASE_URL}/api/channels/telegram/:secret`）。

更完整的上线清单见 [references/deployment-readiness.md](references/deployment-readiness.md)。
