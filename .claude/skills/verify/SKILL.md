---
name: verify
description: 通过真实 HTTP、PostgreSQL 与 Redis 验证本项目 Web 运行时改动
---

# 项目运行时验证

1. 启动依赖：`docker compose up -d postgres redis embeddings`。
2. 启动 Web：`REDIS_URL=redis://localhost:6379 pnpm dev`，等待 `Server running on http://localhost:3000/`。
3. 通过 `/api/trpc/auth.register` 或 `/api/trpc/auth.login` 获取 Cookie jar，再访问 `/api/trpc/auth.me` 驱动认证链。
4. Session 缓存可用 `docker exec customer_service_agent_redis redis-cli --scan --pattern 'auth:session:v1:*'`、`GET`、`PTTL` 观察。
5. 故障验证可分别 `docker compose stop redis` 或 `stop postgres`，验证另一存储承担认证；完成后恢复服务。
6. 登出调用 `/api/trpc/auth.logout`，重放旧 Cookie 并检查 tombstone。注意 `auth.me` 是 public procedure，拒绝旧 Cookie 的表现是 HTTP 200 且 `result.data.json` 为 `null`。
7. 停止本次启动的 Web 进程；不要删除开发者原有 PostgreSQL/embedding 数据。
