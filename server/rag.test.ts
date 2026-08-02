import { describe, expect, it } from "vitest";
import {
  isKnowledgeEntrySearchable,
  rankKnowledgeEntriesByKeyword,
} from "./db";

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

  it("requires both approved security and completed indexing before retrieval", () => {
    expect(
      isKnowledgeEntrySearchable({
        securityStatus: "approved",
        embeddingStatus: "pending",
      })
    ).toBe(false);
    expect(
      isKnowledgeEntrySearchable({
        securityStatus: "quarantined",
        embeddingStatus: "completed",
      })
    ).toBe(false);
    expect(
      isKnowledgeEntrySearchable({
        securityStatus: "approved",
        embeddingStatus: "completed",
      })
    ).toBe(true);
  });
});
