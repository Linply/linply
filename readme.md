# Linply

**English** · [简体中文](./readme.zh-CN.md)

Multi-tenant, self-serve AI customer support: **every account owns one workspace** —
its own knowledge base, its own customer conversations, its own channel connections.
There is no cross-workspace administrator; every row is isolated by `workspaceId`.

## Stack

- Frontend: React 19, Tailwind CSS 4, shadcn/ui, wouter
- Data & API: tRPC 11, React Query
- Backend: Express 4, OpenAI Agents SDK
- Storage: PostgreSQL 16 + pgvector, Drizzle ORM; Redis session cache + BullMQ; S3-compatible object storage
- Embeddings: local `BAAI/bge-small-zh-v1.5` (512-dim) / OpenAI / Voyage
- Auth: email + password, Google OAuth, database sessions, workspace-scoped
- Channels: Telegram bot (webhook / polling), sign-in-free share link
- i18n: English (default) and Simplified Chinese

## Plans

| | Free | Pro $5/mo | Business $20/mo | Self-hosted |
|---|---|---|---|---|
| Knowledge entries | 100 | 2,000 | 20,000 | Unlimited |
| Daily credits | 100 | 1,000 | 5,000 | Unlimited |
| Connected channels | 1 | 3 | 10 | Unlimited |
| Customers / 30 days | 100 | 2,000 | 20,000 | Unlimited |
| Remove Linply branding | — | ✅ | ✅ | ✅ |
| Customer cards | — | — | ✅ | ✅ |

The catalog lives in `shared/plans.ts`. The server enforces limits from it and the
`/plans` page renders from it, so advertised and enforced limits cannot drift.

**Payment is not wired up yet.** Choosing a plan writes a pending row to
`plan_requests`; nothing is charged and the workspace stays on its current plan.

## What it does

- **Workspace** — provisioned on sign-up. Holds the agent persona (name / tone /
  business context / fallback script), the share-link public key, and onboarding progress.
- **Onboarding** — `/onboarding`, four steps: describe your business → import knowledge →
  try it once → plug it in. New accounts land here before the workspace.
- **Knowledge** — paste Q&A, upload Markdown/CSV (multipart direct upload + BullMQ
  streaming parse), embedding backfill, conflict detection, prompt-injection scanning.
- **Agent** — OpenAI Agents SDK with knowledge and ticket tools. The system prompt is
  generated per workspace from its persona. SSE streaming with reconnect/replay.
- **Channels** — Telegram connects by pasting a bot token (webhook when a public HTTPS
  origin exists, otherwise automatic `getUpdates` polling). Sign-in-free share link at
  `/a/:publicKey`. Slack and Feishu are listed as planned.
- **Conversations** — external visitors are `channel_contacts`; they never register.
  The owner reads the full thread under Conversations.
- **Tickets** — what the agent produces when it hands off to a human, workspace-scoped too.
- **Agent Run inspection** — UUID-identified runs with steps, final output, errors,
  structured results, and retry.

### Isolation model

Authorization has two rules and no roles:

1. A row is reachable only from the workspace it belongs to.
2. Inside a workspace, the owner (console scope) sees everything; an external
   contact only ever sees rows attributed to that same contact.

`workspaceProcedure` injects `ctx.workspace` and `ctx.scope`; `server/accessControl.ts`
is the single decision point.

## Local setup

```bash
pnpm install
docker compose up -d postgres redis embeddings minio minio-init
pnpm db:migrate
pnpm dev
```

Default addresses:

- App: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379 (optional; without it auth reads PostgreSQL directly)
- Local embedding service: http://localhost:8080
- MinIO S3 API: http://localhost:9000, console: http://localhost:9001

Accounts:

- Sign up: http://localhost:3000/register — provisions a workspace and opens `/onboarding`
- Sign in: http://localhost:3000/login

Every account is the same kind. `pnpm db:seed` loads a sample workspace with knowledge
and tickets; `pnpm auth:create-user` provisions one from the CLI (useful for a demo login).

## Environment

```bash
cp .env.example .env
```

Key settings:

- `DATABASE_URL` — PostgreSQL connection string.
- `APP_BASE_URL` — public origin. Used for the OAuth callback and the share link, and it
  decides whether Telegram registers a webhook: only a public HTTPS origin does, otherwise
  channels fall back to `getUpdates` polling.
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` — OpenAI-compatible model config.
  **Without a key the agent cannot answer.**
- `AGENT_DAILY_TOKEN_QUOTA` — optional hard ceiling on top of the plan allowance. `0` means
  the plan alone decides.
- `EMBEDDING_PROVIDER=local|openai|voyage`, `RAG_EMBEDDINGS_ENABLED` — retrieval config;
  disabling embeddings falls back to keyword search.
- `DEMO_ACCOUNT_EMAIL` / `DEMO_ACCOUNT_PASSWORD` — optional one-click demo entry on the
  sign-in page. An ordinary account with no special rights; it must already exist.
- `REDIS_URL`, `QUEUE_REDIS_URL`, `AWS_*` — session cache, BullMQ, knowledge file storage.

See `.env.example` for the full list.

## Commands

```bash
pnpm dev              # dev server
pnpm check            # TypeScript
pnpm test             # Vitest
pnpm build            # production build
pnpm start            # run the production build
pnpm worker           # agent worker
pnpm knowledge:worker # knowledge worker
pnpm db:generate      # generate a migration from the schema
pnpm db:migrate       # apply migrations
pnpm db:seed          # sample workspace
pnpm auth:create-user # create an account and provision its workspace
pnpm kb:embed         # backfill knowledge embeddings
```

## Layout

```text
client/          pages, components, hooks, tRPC client
client/src/i18n/ en/zh dictionaries; `zh` is typed against `en`, so a missing key fails the build
server/          routers, chat streaming, agent, DB access, knowledge import
server/channels/ channel adapters: Telegram, inbound pipeline, webhook routes, share link
server/workspace.ts  workspace provisioning and scope definitions
shared/plans.ts  plan catalog shared by enforcement and pricing UI
drizzle/         schema and migrations
```

## Tests

```bash
pnpm check
pnpm test
```

Covered: workspace isolation (cross-workspace reads and writes rejected, list queries
forced to carry `workspaceId`, workspace provisioned on first access), OpenAI provider
mock and error redaction, embeddings, keyword RAG recall, agent tool validation and
structured output, agent run states, password hashing, Google OAuth PKCE/state,
database sessions, knowledge parsing, ticket smoke flow.

## Deploying

1. Set production environment variables — `DATABASE_URL`, `APP_BASE_URL`, model and
   embedding config.
2. Run `pnpm db:migrate`.
3. Optionally run `pnpm auth:create-user` and set `DEMO_ACCOUNT_*` for the demo entry.
4. Run `pnpm kb:embed` to backfill vectors; switching embedding models resets old vectors.
5. Point the Google OAuth callback at `${APP_BASE_URL}/api/auth/oauth/google/callback`.
6. Create an `agent-worker` service and set `AGENT_EXECUTION_MODE=worker` on the web service.
7. Create object storage and a `knowledge-worker` service, then run `pnpm kb:storage:cors` once.
8. Start with `NODE_ENV=production pnpm start` and verify: email sign-in, Google sign-in,
   **cross-workspace isolation**, multipart upload, knowledge parsing, agent run lease
   recovery, and the Telegram webhook at `${APP_BASE_URL}/api/channels/telegram/:secret`.

Chinese documentation, including Railway deployment notes, is in
[readme.zh-CN.md](./readme.zh-CN.md).
