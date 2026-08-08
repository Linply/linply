# Linply MVP 功能规划（对标 Plain）

> 目标：把 linply 从「客户自助提单 + AI 问答」转成「支持团队的协作收件箱 + AI」。
> 参考对象：[Plain](https://www.plain.com/product) —— B2B 场景的 API-first 支持平台。

---

## 一、先认清差距在哪

两个产品的**视角**是相反的，这是所有改动的根源：

| | linply 现在 | Plain |
|---|---|---|
| 谁登录系统 | 终端客户（提单）+ 管理员 | 只有支持团队 |
| 客户在哪 | 站内注册账号 | 站外（邮件 / Slack / 挂件），不注册 |
| 核心对象 | Ticket（客户提交的诉求） | Thread（一段跨渠道的对话） |
| 核心界面 | 工单列表 + 详情 | 收件箱队列（键盘优先工作台） |
| 客户结构 | 扁平的 user | Customer → Company → Tier 三层 |

**好消息**：Plain 的产品有两半 —— 协作收件箱 + AI 能力。你的 AI 那半边已经做得很扎实了：

- ✅ pgvector RAG + 关键词兜底 + 引用溯源
- ✅ Agent 框架（`agentRuns` / `Steps` / `Events` / `ToolInvocations`）
- ✅ 工具调用（searchKnowledge / createTicket / listTickets / addTicketNote）
- ✅ SSE 流式执行过程、结构化输出、失败重试、run 详情页
- ✅ 知识库管理 + RAG 调试台
- ✅ 日志脱敏、成本/延迟观测

这套东西对应 Plain 的 **Ari**（自动处理）和 **Sidekick**（辅助草拟）。**MVP 阶段不用重做，直接复用。**

缺的是收件箱那半边。

---

## 二、MVP 范围（P0）

### 1. 数据模型重构 ⚠️ 最大的一块

这是整个 MVP 的地基，也是唯一的破坏性改动。

#### 1.1 拆分 `users`

现在 `users` 一张表同时扮演「登录用户」和「客户」，必须拆开：

| 新实体 | 说明 | 来源 |
|---|---|---|
| `members` | 支持团队成员，能登录，有 role | 现 `users` 中 role=admin 的部分 |
| `customers` | 外部客户，**不登录**，靠 email 识别 | 现 `users` 中 role=user 的部分 |
| `companies` | 客户所属公司，按邮箱域名自动归集 | 全新 |
| `tiers` | 公司等级（Free / Growth / Enterprise） | 全新 |

关系：`customer → company → tier`

> 连带影响：`tickets.userId`、`chatMessages.userId`、`agentRuns.userId`、`ticketNotes.userId` 全部要重新指向。这是最容易埋雷的地方，见「五、风险」。

#### 1.2 `tickets` → `threads`

状态模型换成 Plain 的极简三态：

```
现在：pending / in_progress / resolved / closed
改成：todo / snoozed / done
```

映射：`pending`+`in_progress` → `todo`，`resolved`+`closed` → `done`，`snoozed` 新增（带 `snoozedUntil` 时间戳，到点自动回 `todo`）。

Plain 明确说过 todo→done→todo 的来回切换是**设计预期**，不要为「重开」单独造状态。

保留：`priority`、`assignedTo`（改指向 `members`）、`title`。
新增：`customerId`、`channel`（email / chat / portal）、`lastCustomerMessageAt`、`firstResponseAt`。

#### 1.3 合并双时间线 → `timeline_entries`

**现在最别扭的地方**：`ticketNotes`（团队备注、状态变更）和 `chatMessages`（客户对话、AI 回复）是两张分离的表，同一个工单的历史被劈成两半。

Plain 是一条统一 timeline。合并成单表，用 `entryType` 区分：

| entryType | 含义 |
|---|---|
| `customer_message` | 客户发来的（邮件/挂件） |
| `member_reply` | 团队回复（会发出去） |
| `internal_note` | 内部备注（客户看不到） |
| `ai_draft` | Sidekick 草拟的回复（待人工确认） |
| `status_change` | 状态/分配/标签变更 |
| `system` | SLA 触发、自动回复等 |

保留 `chatMessages` 现有的 `relatedKnowledgeIds` / `relatedKnowledgeSnapshot` / `agentRunId` / `llmProvider` / `llmModel` 字段，挂到 `ai_draft` 和 `member_reply` 上。

### 2. 邮件渠道（收 + 发）

Plain 的立身之本。MVP 只做邮件一个渠道，做透。

- **收信**：inbound webhook（Postmark / Resend / SES 三选一）→ 解析发件人 → 匹配或新建 `customer` → 匹配已有 thread 或新建
- **发信**：团队回复 → 发邮件出去
- **会话串联**：正确处理 `Message-ID` / `In-Reply-To` / `References` header，让客户邮箱里是一条连续对话
- **附件**：存对象存储（项目已有 `@aws-sdk/client-s3` + `storageProxy`，直接复用）

### 3. 收件箱 UI

- **队列视图**：`All` / `Assigned to me` / `Unassigned` / `Snoozed`，按 priority + 等待时长排序
- **Thread 详情**：统一 timeline + 回复框 + 内部备注切换
- **操作**：分配给成员、切状态、Snooze（1h / 明早 / 下周）、打标签
- **未读标记**：客户有新消息时高亮

### 4. Labels

Thread 可挂多个标签，标签有名称 + 颜色/图标。设置页可增删。

（Plain 支持嵌套标签，MVP 先做扁平的。）

### 5. Customer Cards ⭐ 别省这个

**这是 Plain 区别于 Zendesk 的核心差异化**，也是 B2B 场景真正值钱的地方。

机制：配置一个你自己系统的 HTTP endpoint，Plain 在打开 thread 时带着客户邮箱去请求，把返回的结构化数据渲染在侧边栏 —— 订阅套餐、用量、最近报错、账单状态等。

MVP 实现：
- 设置页填 endpoint URL + 认证 header
- 打开 thread 时请求，超时/失败静默降级
- 返回约定的 JSON schema（`{ cards: [{ title, rows: [{label, value, url?}] }] }`）
- 结果短期缓存

### 6. AI：先做 Sidekick，不做 Ari

**MVP 只做「辅助」不做「自动」**：

- 复用现有 RAG，在回复框上方给出草拟回复 + 引用来源
- 团队成员一键采纳 / 编辑后发送
- **不做**让 AI 直接回复客户（风险高、需要更多护栏和评估）

现有的 `chat.sendMessage` 和 agent 框架基本可以直接改造成这个。

---

## 三、P1（MVP 之后紧接着做）

| 功能 | 说明 |
|---|---|
| **SLA** | 按 tier 配置首次响应 / 下次响应时限，超时告警。依赖 tier 已建好 |
| **命令面板 + 快捷键** | Plain 的核心体验之一。`Cmd+K` 全局操作，`e` 归档、`a` 分配等 |
| **Snippets** | 常用回复模板，带变量插值 |
| **站内挂件（Live Chat）** | 第二个渠道。现有 `SmartChat` 页面可以改造成雏形 |
| **营业时间 + 自动回复** | 非工作时间自动回执 |
| **CSAT** | 结单后发满意度调查 |
| **Thread 自定义字段** | Plain 的 Thread Fields |

---

## 四、P2（明确先不做）

砍掉这些不影响 MVP 立得住，但会显著拖慢进度：

- ❌ **Slack / Discord / Teams 渠道** —— 每个都是独立的 OAuth + 事件模型，成本很高
- ❌ **Workflows 可视化编排** —— 先用代码写死规则
- ❌ **Insights / 深度报表** —— 现有 admin 统计页够用
- ❌ **Help Center / 知识门户** —— 知识库先只喂 RAG，不对外
- ❌ **GraphQL API** —— tRPC 已经够用，对外 API 等有人要再说
- ❌ **Ari 全自动回复** —— 见上，风险大
- ❌ **多 Agent handoff** —— 已评估过，MVP 不需要

---

## 五、风险与注意事项

### 🔴 数据模型重构是破坏性的

`users` 拆成 `members` + `customers` 会牵动 4 张表的外键。建议：

1. 新表并行建立，写迁移脚本搬数据，**不要原地改 `users`**
2. 先跑通迁移脚本在本地库上的幂等性
3. `agentRuns` / `agentToolInvocations` 里的 userId 语义要重新想清楚（是发起的 member 还是关联的 customer）

### 🟡 邮件 threading 容易做错

`In-Reply-To` / `References` 处理不对会导致客户邮箱里对话散成一堆独立邮件。建议尽早用真实邮箱端到端测一遍，别等 UI 做完。

### 🟡 现有客户端页面何去何从

| 页面 | 建议 |
|---|---|
| `TicketCreate` / `TicketList` / `TicketDetail`（客户视角） | MVP 里客户不登录了 → 保留成可选的 Portal，或直接下线 |
| `SmartChat` | 保留，P1 改造成站内挂件 |
| `KnowledgeBase` / `RagDebug` / `AdminDashboard` | 保留，是团队侧工具 |

### 🟢 可以直接复用的

RAG、Agent 框架、知识库管理、对象存储、认证 session、观测/脱敏 —— 这些不用动。

---

## 六、建议的实施顺序

```
1. 数据模型重构 + 迁移脚本          ← 地基，必须先做
2. 邮件收信 → 建 thread（先不管 UI）  ← 尽早验证 threading
3. 收件箱队列 + thread 详情 UI
4. 邮件发信 + 回复闭环
5. Labels + 分配 + Snooze
6. Customer Cards
7. Sidekick 草拟（接现有 RAG）
────────── MVP 完成 ──────────
8. SLA → 命令面板 → Snippets → 挂件
```

前 4 步做完就是一个能用的最小闭环：**邮件进来 → 团队在收件箱看到 → 回复出去**。

---

**Sources**

- [Plain — Product](https://www.plain.com/product)
- [Plain — Data model](https://www.plain.com/docs/data-model)
- [Plain — 首页](https://www.plain.com/)
- [Plain — Customer cards](https://www.plain.com/docs/customer-cards)
