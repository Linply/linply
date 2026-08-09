import { describe, expect, it } from "vitest";
import { buildAgentInstructions } from "./agentPersona";
import {
  describeThinking,
  describeToolCall,
  describeToolResult,
  sanitizeToolReason,
} from "./agentToolPresentation";
import {
  buildToolArgsHash,
  sanitizeAssistantReply,
  splitToolReason,
} from "./agentService";

describe("agent persona", () => {
  it("speaks as the workspace's own agent and carries its scripts", () => {
    const instructions = buildAgentInstructions({
      agentName: "小林",
      agentTone: "concise",
      fallbackReply: "这个我需要确认一下再回你",
      businessContext: "我们卖手冲咖啡器具，支持 7 天无理由退货。",
    });

    expect(instructions).toContain("「小林」");
    expect(instructions).toContain("能一句话说清就不写第二句");
    expect(instructions).toContain("手冲咖啡器具");
    expect(instructions).toContain("这个我需要确认一下再回你");
  });

  it("asks for short human turns instead of formatted documents", () => {
    const instructions = buildAgentInstructions(null);

    expect(instructions).toContain("第一人称、口语、短句");
    expect(instructions).toContain("一次只问一个问题");
    expect(instructions).toContain("用对方说话的语言回复");
    // Citations are chips in the UI; repeating them in prose is noise.
    expect(instructions).not.toContain("参考：知识库标题");
  });

  it("keeps the tool calls presentable and the write path gated", () => {
    const instructions = buildAgentInstructions(null);

    expect(instructions).toContain("每次调用工具都要填 reason");
    expect(instructions).toContain(
      "createTicket 和 addTicketNote 只在用户明确要求时才调用"
    );
    expect(instructions).toContain("不可信参考数据");
    expect(instructions).toContain("source=current_user_request");
    expect(instructions).toContain("不处理密码、API key、银行卡号");
  });

  it("falls back to the friendly tone for an unknown tone value", () => {
    const instructions = buildAgentInstructions({
      agentName: "  ",
      agentTone: "shouty",
      fallbackReply: null,
      businessContext: null,
    });

    expect(instructions).toContain("「智能客服」");
    expect(instructions).toContain("像一个愿意帮忙的同事");
  });
});

describe("tool activity copy", () => {
  it("describes a knowledge search by what it is looking for", () => {
    const call = describeToolCall("searchKnowledge", {
      query: "退货要几天",
      limit: 3,
    });

    expect(call.icon).toBe("knowledge");
    expect(call.phase).toBe("running");
    expect(call.key).toBe("searchKnowledge.running");
    expect(call.params.query).toBe("退货要几天");
    expect(call.text).toContain("退货要几天");
    expect(call.text).not.toContain("searchKnowledge");
  });

  it("prefers the model's own sentence over the templated one", () => {
    const call = describeToolCall(
      "searchKnowledge",
      { query: "return window" },
      "我查一下退货时限"
    );

    expect(call.reason).toBe("我查一下退货时限");
    expect(call.text).toBe("我查一下退货时限");
  });

  it("reports the outcome rather than repeating the intent", () => {
    const found = describeToolResult(
      "searchKnowledge",
      { query: "退货" },
      { count: 3, entries: [{ id: 1 }] }
    );
    const empty = describeToolResult(
      "searchKnowledge",
      { query: "退货" },
      { count: 0, entries: [] }
    );

    expect(found.key).toBe("searchKnowledge.done");
    expect(found.params.count).toBe(3);
    expect(found.meta).toBe("3");
    expect(empty.key).toBe("searchKnowledge.empty");
    expect(empty.meta).toBeUndefined();
  });

  it("names the ticket it touched", () => {
    expect(
      describeToolResult("createTicket", {}, { success: true, ticketId: 42 })
        .params.ticketId
    ).toBe(42);
    expect(
      describeToolResult(
        "createTicket",
        {},
        { success: true, ticketId: 42, idempotentReplay: true }
      ).key
    ).toBe("createTicket.replayed");
    expect(
      describeToolResult("addTicketNote", { ticketId: 7 }, { success: true })
        .params.ticketId
    ).toBe(7);
  });

  it("marks a failed tool without leaking the error text", () => {
    const failure = describeToolResult(
      "createTicket",
      { title: "退款" },
      { success: false, error: "connection refused to 10.0.0.3" }
    );

    expect(failure.phase).toBe("error");
    expect(failure.key).toBe("tool.error");
    expect(failure.text).not.toContain("10.0.0.3");
  });

  it("keeps a status line to one short row", () => {
    expect(sanitizeToolReason("  我查一下\n退货时限  ")).toBe(
      "我查一下 退货时限"
    );
    expect(sanitizeToolReason("很".repeat(200))?.length).toBe(60);
    expect(sanitizeToolReason("   ")).toBeUndefined();
    expect(sanitizeToolReason(42)).toBeUndefined();
  });

  it("opens every run with a human status line", () => {
    expect(describeThinking().phase).toBe("running");
    expect(describeThinking().key).toBe("thinking");
  });
});

describe("reply sanitizing", () => {
  it("leaves an ordinary answer untouched", () => {
    const reply = "可以的，7 天内没拆封都能退。要我帮你走一下流程吗？";
    const result = sanitizeAssistantReply(reply);

    expect(result.content).toBe(reply);
    expect(result.changed).toBe(false);
  });

  it("removes a structured summary the model leaked into the reply", () => {
    const result = sanitizeAssistantReply(
      '7 天内可以退货。\n\n```json\n{"category":"refund","riskLevel":"low","summary":"退货咨询","shouldCreateTicket":false}\n```'
    );

    expect(result.content).toBe("7 天内可以退货。");
    expect(result.changed).toBe(true);
  });

  it("removes a bare trailing structured object", () => {
    const result = sanitizeAssistantReply(
      '订单已经发出了。\n{"category":"shipping","riskLevel":"low","summary":"物流咨询"}'
    );

    expect(result.content).toBe("订单已经发出了。");
  });

  it("keeps code the customer actually asked for", () => {
    const reply = '你可以这样调用：\n\n```json\n{"orderId": 123}\n```';

    expect(sanitizeAssistantReply(reply).content).toBe(reply);
  });

  it("drops a written-out source list that the UI already shows", () => {
    const result = sanitizeAssistantReply(
      "运费满 99 免。\n\n参考：运费规则、包邮门槛"
    );

    expect(result.content).toBe("运费满 99 免。");
  });

  it("never empties a reply it cannot clean up", () => {
    const result = sanitizeAssistantReply(
      '{"category":"other","riskLevel":"low","summary":"x"}'
    );

    expect(result.content).not.toBe("");
  });
});

describe("tool reason handling", () => {
  it("keeps presentation copy out of the tool identity", () => {
    const withReason = splitToolReason({
      query: "退货",
      limit: 3,
      reason: "我查一下退货时限",
    });
    const withoutReason = splitToolReason({ query: "退货", limit: 3 });

    expect(withReason.reason).toBe("我查一下退货时限");
    expect(withReason.args).toEqual({ query: "退货", limit: 3 });
    expect(buildToolArgsHash(withReason.args)).toBe(
      buildToolArgsHash(withoutReason.args)
    );
  });

  it("ignores a non-string reason", () => {
    expect(
      splitToolReason({ id: 1, reason: 5 as unknown as string }).reason
    ).toBeUndefined();
  });
});
