import { describe, expect, it } from "vitest";
import {
  buildChatHistoryMessages,
  buildCustomerServiceSystemPrompt,
  buildKnowledgeContext,
  KNOWLEDGE_CONTEXT_CHAR_LIMIT,
  KNOWLEDGE_ENTRY_CHAR_LIMIT,
} from "./chatService";
import { rankKnowledgeEntriesByKeyword } from "./db";

const entries = [
  {
    id: 1,
    title: "如何重置密码？",
    content: "点击登录页面的忘记密码链接，输入注册邮箱，然后通过邮件重置密码。",
    category: "FAQ",
    keywords: "密码,重置,登录,忘记密码",
  },
  {
    id: 2,
    title: "产品退货政策",
    content: "我们提供30天内无条件退货服务，退货批准后将在7个工作日内处理退款。",
    category: "政策",
    keywords: "退货,退款,政策,返回",
  },
  {
    id: 3,
    title: "订单发货时间",
    content: "订单确认后通常在1-2个工作日内发货，标准快递3-5个工作日送达。",
    category: "物流",
    keywords: "发货,快递,物流,时间",
  },
  {
    id: 4,
    title: "产品保修期是多久？",
    content: "产品提供1年的有限保修，覆盖制造缺陷和正常使用中的硬件损坏。",
    category: "保修",
    keywords: "保修,保障,维修,损坏",
  },
];

describe("keyword RAG ranking", () => {
  it.each([
    ["忘记登录密码怎么办", "如何重置密码？"],
    ["我想退货退款", "产品退货政策"],
    ["快递多久能送到", "订单发货时间"],
    ["保修期多长", "产品保修期是多久？"],
  ])("matches common question: %s", (query, expectedTitle) => {
    const result = rankKnowledgeEntriesByKeyword(query, entries, 1);

    expect(result[0]?.title).toBe(expectedTitle);
  });

  it("does not pad keyword results with unrelated entries", () => {
    const result = rankKnowledgeEntriesByKeyword("密码", entries, 50);

    expect(result.map(entry => entry.title)).toEqual(["如何重置密码？"]);
  });
});

describe("chat prompt helpers", () => {
  it("builds a knowledge context with source titles", () => {
    const context = buildKnowledgeContext(entries.slice(0, 2));

    expect(context).toContain("[FAQ] 如何重置密码？");
    expect(context).toContain("[政策] 产品退货政策");
  });

  it("limits each knowledge entry before applying the total context budget", () => {
    const longEntries = Array.from({ length: 5 }, (_, index) => ({
      title: `长条目 ${index}`,
      category: "政策",
      content: `第 ${index} 条规则。${"这是一段较长的政策说明。".repeat(300)}`,
    }));

    const context = buildKnowledgeContext(longEntries);
    const blocks = context.split("\n\n");

    expect(context.length).toBeLessThanOrEqual(KNOWLEDGE_CONTEXT_CHAR_LIMIT);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every(block => block.length <= KNOWLEDGE_ENTRY_CHAR_LIMIT)).toBe(
      true
    );
  });

  it("truncates knowledge at a sentence boundary when the entry exceeds its budget", () => {
    const context = buildKnowledgeContext([
      {
        title: "退款规则",
        category: "政策",
        content: `${"前置说明。".repeat(500)}后续不应进入上下文。`,
      },
    ]);

    expect(context.length).toBeLessThanOrEqual(KNOWLEDGE_ENTRY_CHAR_LIMIT);
    expect(context).toMatch(/。\.\.\.$/);
    expect(context).not.toContain("后续不应进入上下文");
  });

  it("keeps the system prompt grounded in knowledge base answers", () => {
    const prompt = buildCustomerServiceSystemPrompt("暂无相关知识库信息");

    expect(prompt).toContain("只使用知识库中明确提供的信息");
    expect(prompt).toContain("建议用户创建工单");
    expect(prompt).toContain("参考：知识库标题");
  });

  it("limits multi-turn history before sending it to the model", () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `${index}: ${"很长的历史消息".repeat(120)}`,
    }));

    const messages = buildChatHistoryMessages(history);
    const totalLength = messages.reduce((sum, message) => {
      return sum + String(message.content).length;
    }, 0);

    expect(messages.length).toBeLessThanOrEqual(5);
    expect(totalLength).toBeLessThanOrEqual(4_020);
    expect(messages.at(-1)?.content).toContain("11:");
  });
});
