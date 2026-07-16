# 上线准备与部署配置说明

## 关键环境变量

- `DATABASE_URL`：生产 PostgreSQL + pgvector 连接串。上线前执行 `pnpm db:migrate`。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`：只用于首次运行 `pnpm auth:create-admin`，不要提交真实值。
- `LLM_PROVIDER=openai`：使用 OpenAI Responses API。
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`：OpenAI 兼容服务配置。
- `CHAT_MODE=rag|agent`：`rag` 为直接 RAG，`agent` 为 OpenAI Agents SDK。
- `EMBEDDING_PROVIDER=local|openai|voyage`：embedding 服务提供方。
- `RAG_EMBEDDINGS_ENABLED=true`：生产建议启用；服务不可用时仍会回退关键词检索。

## 部署步骤

1. 安装依赖并构建：`pnpm install --frozen-lockfile && pnpm build`。
2. 准备数据库：安装 pgvector，设置 `DATABASE_URL`，执行 `pnpm db:migrate`。
3. 配置 OpenAI 兼容模型和 embedding 服务。
4. 回填知识库向量：`pnpm kb:embed`。
5. 启动服务：`NODE_ENV=production pnpm start`。
6. 用管理员账号检查知识库、RAG 调试页、智能客服和 Agent Run 详情页。

## 上线检查

- 登录与注册入口分别为 `/login` 和 `/register`，生产环境不提供免密开发登录。
- 日志只记录 LLM/embedding provider、model、耗时、token 或维度等元信息，不记录用户原文。
- OpenAI/API key、Authorization、cookie、password 类字段会在日志错误信息中脱敏。
- `AGENT_TRACING_ENABLED=true` 时仍保持 `includeSensitiveData=false`。
- Agent 模式上线前确认 `agent_runs` / `agent_run_steps` 表已迁移成功。
