# 客服工单 Agent 系统

AI 驱动的客服工单系统，覆盖工单全生命周期管理、基于 RAG/Agent 的智能客服、知识库维护、Agent Run 可观测排查与 demo 上线。

## 技术栈

- 前端：React 19、Tailwind CSS 4、shadcn/ui、wouter
- 数据与接口：tRPC 11、React Query
- 后端：Express 4、OpenAI Agents SDK
- 数据库：PostgreSQL 16 + pgvector、Drizzle ORM
- 向量服务：本地 `BAAI/bge-small-zh-v1.5`（512 维）/ OpenAI / Voyage
- LLM：OpenAI Agents SDK
- 认证：邮箱密码 + Google OAuth、数据库 Session、用户与管理员权限隔离

## 核心能力

- 工单管理：创建、筛选、搜索、详情、状态流转、备注、统计。
- 智能客服：通过 OpenAI Agents SDK 调用知识库和工单工具，支持 SSE 流式事件与断线恢复。
- 知识库管理：手动维护、Markdown/CSV 文档导入、embedding 回填、冲突检测。
- Agent Run 排查：使用 UUID 标识运行，保存步骤、最终回答、错误和结构化结果，支持从管理员聊天回复直接查看与重试。
- 观测与安全：记录 LLM/embedding 耗时和 token/维度元信息，日志脱敏敏感凭据。

## 本地启动

```bash
pnpm install
docker compose up -d postgres embeddings
pnpm db:migrate
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='replace-me' pnpm auth:create-admin
pnpm db:seed
pnpm kb:embed
pnpm dev
```

默认访问地址：

- 应用：http://localhost:3000
- PostgreSQL：localhost:5432
- 本地 embedding 服务：http://localhost:8080

账号入口：

- 登录：http://localhost:3000/login
- 注册：http://localhost:3000/register

普通账号通过注册页创建；管理员账号使用 `pnpm auth:create-admin` 初始化或提升已有账号。

## 环境变量

复制 `.env.example` 并按环境配置：

```bash
cp .env.example .env
```

关键配置：

- `DATABASE_URL`：PostgreSQL 连接串。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`：仅在运行管理员初始化命令时使用。
- `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`：可选，仅用于登录页的管理员演示入口；账号必须已通过 `pnpm auth:create-admin` 初始化并具有管理员角色。
- `APP_BASE_URL`：应用公网 origin，用于生成 OAuth callback。
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
pnpm db:generate    # 根据 schema 生成迁移
pnpm db:migrate     # 应用迁移
pnpm db:seed        # 初始化示例数据
pnpm auth:create-admin # 创建或提升管理员账号
pnpm kb:embed       # 回填知识库 embedding
pnpm kb:embed:check # 检查 embedding 服务连通性
```

## 项目结构

```text
client/          前端页面、组件、hooks、tRPC 客户端
server/          后端路由、聊天、Agent、数据库访问、知识库导入
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
- 用户工单/聊天隔离、知识库解析、基础工单 smoke flow

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
LOCAL_EMBEDDING_BASE_URL: ${{app.APP_BASE_URL}}
```

worker 还需与 app 使用相同的 `OPENAI_*` 和必要的 tracing 配置。它通过 PostgreSQL 租约领取 queued Run；Web 服务只负责入队和 SSE 事件订阅。Railway 的 `app.PORT` 不是可跨服务引用的配置变量，因此 worker 的 embedding 地址使用 app 的 HTTPS 地址，并继续携带 `LOCAL_EMBEDDING_API_KEY`。仓库也保留了 `/railway.worker.json`，可在 Dashboard 单独绑定时使用。
worker 会在 Railway 分配的 `PORT` 上提供内部 `/api/health` 探针，但不配置公网域名。

`LOCAL_EMBEDDING_API_KEY` 在 Railway 中已设置为服务内 token。公网直接访问 `/v1/embeddings` 会返回 `401`，后端自调用会带 Bearer token。

旧的独立 `embeddings` Railway 服务已不再作为主路径使用；demo 主链路依赖 app 内置 embedding endpoint。

## 部署要点

1. 设置生产环境变量，尤其是 `DATABASE_URL`、`APP_BASE_URL`、LLM 和 embedding 配置。
2. 执行 `pnpm db:migrate`。
3. 使用 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 运行一次 `pnpm auth:create-admin`。
4. 执行 `pnpm kb:embed` 回填知识库向量；切换模型后旧向量会被重置，需要重新生成。
5. 在 Google Cloud Console 把授权回调 URI 配置为 `${APP_BASE_URL}/api/auth/oauth/google/callback`。
6. 创建名为 `agent-worker` 的独立 Service；共享 `/railway.json` 会按服务名启动 `pnpm worker`，并给 Web 服务设置 `AGENT_EXECUTION_MODE=worker`。
7. 使用 `NODE_ENV=production pnpm start` 启动 Web 服务并检查邮箱登录、Google 登录、用户隔离、管理员页面和 Agent Run 租约恢复。

更完整的上线清单见 [references/deployment-readiness.md](references/deployment-readiness.md)。
