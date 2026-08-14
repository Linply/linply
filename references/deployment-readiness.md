# 上线准备与部署配置说明

## 关键环境变量

- `DATABASE_URL`：生产 PostgreSQL + pgvector 连接串。Web Service 通过 `railway.json` 的 `preDeployCommand` 自动执行 `pnpm db:migrate`；首次初始化或故障恢复时才手动执行。
- `REDIS_URL`：可选的 Web 登录 Session 缓存；Redis 故障时回退 PostgreSQL。Railway 可使用 `${{Redis.REDIS_URL}}` 引用 Redis Service。
- `QUEUE_REDIS_URL`：BullMQ 队列连接；Web 和 `knowledge-worker` 必须一致。BullMQ 使用的 Redis 应采用 `noeviction` 策略。
- `AWS_ENDPOINT_URL` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET_NAME` / `AWS_DEFAULT_REGION`：Railway Bucket 的 S3 兼容连接配置，Web 和 `knowledge-worker` 都需要。
- `AWS_S3_FORCE_PATH_STYLE`：按 Bucket Credentials 页面显示的 URL style 设置；新 Bucket 通常为 `false`。
- `KNOWLEDGE_PARSE_CONCURRENCY` / `KNOWLEDGE_EMBED_CONCURRENCY`：知识库 Worker 的解析与向量化并发。
- `SESSION_CACHE_TTL_MS`：认证/角色快照 TTL，默认 60 秒且代码限制不超过 5 分钟；不改变 30 天绝对 Session 到期。禁用或降权用户时必须撤销 Session 并失效缓存。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`：只用于首次运行 `pnpm auth:create-admin`，不要提交真实值。
- `APP_BASE_URL`：应用的 HTTPS origin，用于生成 Google OAuth callback。
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google OAuth Web Client 凭证。
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`：OpenAI 兼容服务配置。
- `EMBEDDING_PROVIDER=local|openai|voyage`：embedding 服务提供方。
- `RAG_EMBEDDINGS_ENABLED=true`：生产建议启用；服务不可用时仍会回退关键词检索。

## 部署步骤

1. 安装依赖并构建：`pnpm install --frozen-lockfile && pnpm build`。
2. 准备数据库：安装 pgvector，设置 `DATABASE_URL`。确认 Web Service 的 Config File Path 指向 `/railway.json`，由 Railway 在部署前执行 `pnpm db:migrate`。
3. 创建 Redis Service；Web 配置 `REDIS_URL`，Web 和 Knowledge Worker 配置相同的 `QUEUE_REDIS_URL`。
4. 配置 OpenAI 兼容模型和 embedding 服务。
5. 在 Google Cloud Console 配置 `${APP_BASE_URL}/api/auth/oauth/google/callback`。
6. 回填知识库向量：`pnpm kb:embed`。
7. 创建 Railway Bucket，把 AWS SDK 凭据注入 Web 和 Knowledge Worker，然后在生产变量环境执行一次 `pnpm kb:storage:cors`。
8. 启动 Web、Agent Worker 和 Knowledge Worker；Knowledge Worker 命令为 `pnpm knowledge:worker`。
9. 用管理员账号检查登录、multipart 上传、断点续传、知识库索引、RAG 调试页、智能客服和 Agent Run 详情页。

## 上线检查

- 登录与注册入口分别为 `/login` 和 `/register`，生产环境不提供免密开发登录。
- 日志只记录 LLM/embedding provider、model、耗时、token 或维度等元信息，不记录用户原文。
- OpenAI/API key、Authorization、cookie、password 类字段会在日志错误信息中脱敏。
- `AGENT_TRACING_ENABLED=true` 时仍保持 `includeSensitiveData=false`。
- 上线前确认 `agent_runs` / `agent_run_steps` 表已迁移成功。
- 上线前确认 `knowledge_documents` multipart 字段已迁移，并确认 Bucket CORS 仅允许 `APP_BASE_URL` 的 `PUT` 请求。
