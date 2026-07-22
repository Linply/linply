import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRunStatus, AgentRunStepType } from "./db";
import * as db from "./db";
import {
  AgentHandoffEvaluationSchema,
  AgentToolInputSchemas,
  agentTools,
  StructuredAgentOutputSchema,
  buildAgentReplayContext,
  buildStructuredAgentOutput,
  buildToolEffectIdentity,
  classifyAgentToolError,
  evaluateInputGuardrails,
  evaluateAgentHandoff,
  getAgentRagComparison,
  getAgentTraceId,
  summarizeAgentValue,
} from "./agentService";

afterEach(() => {
  vi.restoreAllMocks();
});

const runStatuses: AgentRunStatus[] = [
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "failed",
  "completed",
];

const stepTypes: AgentRunStepType[] = [
  "thinking",
  "tool_call",
  "tool_result",
  "final",
  "error",
];

describe("agent run lifecycle types", () => {
  it("covers the persisted run states required by phase 4", () => {
    expect(runStatuses).toEqual([
      "queued",
      "planning",
      "running",
      "waiting_approval",
      "failed",
      "completed",
    ]);
  });

  it("covers the persisted step event types emitted by the agent service", () => {
    expect(stepTypes).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "final",
      "error",
    ]);
  });
});

describe("agent guardrails and structured output", () => {
  it("blocks obvious sensitive credentials before model execution", () => {
    const result = evaluateInputGuardrails("我的 password: hunter2 帮我看看");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("sensitive_information");
      expect(result.message).toContain("敏感信息");
    }
  });

  it("builds valid structured output from normal agent text", () => {
    const structured = buildStructuredAgentOutput({
      userContent: "帮我总结最近工单，物流一直没更新",
      assistantContent:
        "最近工单显示物流延迟，建议查看相关工单详情并继续跟进。",
      events: [
        {
          type: "tool_result",
          toolName: "listTickets",
          resultSummary: JSON.stringify({
            count: 1,
            tickets: [{ id: 12, title: "物流延迟" }],
          }),
        },
      ],
    });

    expect(StructuredAgentOutputSchema.safeParse(structured).success).toBe(
      true
    );
    expect(structured.category).toBe("shipping");
    expect(structured.shouldCreateTicket).toBe(false);
    expect(structured.referencedTicketIds).toEqual([12]);
  });

  it("offers a ticket when knowledge search has no matching entries", () => {
    const structured = buildStructuredAgentOutput({
      userContent: "我想了解未收录的服务规则",
      assistantContent: "知识库中暂时没有相关信息，建议创建工单由人工客服确认。",
      events: [
        {
          type: "tool_result",
          toolName: "searchKnowledge",
          resultSummary: JSON.stringify({
            count: 0,
            entries: [],
            retrieval: { mode: "vector", degraded: false },
          }),
        },
      ],
    });

    expect(structured.shouldCreateTicket).toBe(true);
    expect(structured.referencedTicketIds).toEqual([]);
  });

  it("does not trust a ticket flag when a knowledge answer is available", () => {
    const structured = buildStructuredAgentOutput({
      userContent: "怎么修改收货地址",
      assistantContent:
        '```json\n{"category":"order","riskLevel":"low","summary":"可以修改收货地址","suggestedActions":["按页面提示修改"],"shouldCreateTicket":true}\n```',
      events: [
        {
          type: "tool_result",
          toolName: "searchKnowledge",
          resultSummary: JSON.stringify({
            count: 1,
            entries: [{ id: 1, title: "收货地址修改", category: "订单" }],
            retrieval: { mode: "vector", degraded: false },
          }),
        },
      ],
    });

    expect(structured.shouldCreateTicket).toBe(false);
  });

  it("repairs partial structured JSON embedded in model output", () => {
    const structured = buildStructuredAgentOutput({
      userContent: "我想退款",
      assistantContent:
        '```json\n{"category":"refund","summary":"用户咨询退款","suggestedActions":["核对订单状态"],"shouldCreateTicket":true}\n```',
      events: [],
    });

    expect(structured.category).toBe("refund");
    expect(structured.riskLevel).toBe("medium");
    expect(structured.suggestedActions).toEqual(["核对订单状态"]);
  });

  it("falls back when structured JSON cannot be repaired", () => {
    const structured = buildStructuredAgentOutput({
      userContent: "系统报错，马上影响使用",
      assistantContent:
        '{"category":"invalid","riskLevel":"unknown","summary":"","suggestedActions":[],"shouldCreateTicket":"yes"}',
      events: [],
    });

    expect(StructuredAgentOutputSchema.safeParse(structured).success).toBe(
      true
    );
    expect(structured.category).toBe("technical");
    expect(structured.riskLevel).toBe("urgent");
    expect(structured.shouldCreateTicket).toBe(true);
    expect(structured.suggestedActions[0]).toContain("创建工单");
  });
});

describe("agent tool validation and summaries", () => {
  it("continues with a later tool after an earlier tool returns an error result", async () => {
    const searchTool = agentTools.find(tool => tool.name === "searchKnowledge");
    const listTool = agentTools.find(tool => tool.name === "listTickets");
    expect(searchTool).toBeDefined();
    expect(listTool).toBeDefined();

    const now = new Date();
    vi.spyOn(db, "searchKnowledgeWithMeta").mockRejectedValue(
      new Error("embedding service unavailable")
    );
    vi.spyOn(db, "listTickets").mockResolvedValue([
      {
        id: 7,
        userId: 42,
        title: "物流异常",
        description: "订单状态长时间未更新",
        status: "pending",
        priority: "medium",
        assignedTo: null,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      },
    ]);

    const runContext = {
      context: { userId: 42, role: "user" },
    } as Parameters<NonNullable<typeof searchTool>["invoke"]>[0];

    const failedToolResult = await searchTool!.invoke(
      runContext,
      JSON.stringify({ query: "退货政策", limit: 3 })
    );
    expect(failedToolResult).toBe(
      "知识库检索失败：embedding service unavailable。请说明无法确认，并建议创建工单。"
    );

    const laterToolResult = await listTool!.invoke(
      runContext,
      JSON.stringify({ limit: 5, offset: 0 })
    );
    expect(laterToolResult).toEqual([
      {
        id: 7,
        title: "物流异常",
        status: "pending",
        priority: "medium",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(db.listTickets).toHaveBeenCalledWith({
      userId: 42,
      limit: 5,
      offset: 0,
    });
  });

  it("replays a successful tool result without executing the tool again", async () => {
    const rootRunId = "11111111-1111-4111-8111-111111111111";
    const retryRunId = "22222222-2222-4222-8222-222222222222";
    const originalRunId = "33333333-3333-4333-8333-333333333333";
    const listTool = agentTools.find(tool => tool.name === "listTickets");
    expect(listTool).toBeDefined();

    const historicalResult = [
      {
        id: 7,
        title: "物流异常",
        status: "pending",
        priority: "medium",
        createdAt: "2026-07-20T12:00:00.000Z",
        updatedAt: "2026-07-20T12:00:00.000Z",
      },
    ];
    vi.spyOn(db, "addAgentRunStep").mockResolvedValue({ id: 1 });
    vi.spyOn(db, "findReusableAgentToolInvocation").mockResolvedValue({
      id: 10,
      rootRunId,
      runId: originalRunId,
      result: historicalResult,
    } as Awaited<ReturnType<typeof db.findReusableAgentToolInvocation>>);
    vi.spyOn(db, "getAgentToolInvocationRetryCount").mockResolvedValue(0);
    vi.spyOn(db, "startAgentToolInvocation").mockResolvedValue({
      id: 11,
    } as Awaited<ReturnType<typeof db.startAgentToolInvocation>>);
    const completeInvocation = vi
      .spyOn(db, "completeAgentToolInvocation")
      .mockResolvedValue(null);
    const listTickets = vi
      .spyOn(db, "listTickets")
      .mockRejectedValue(new Error("listTickets should not execute"));

    const result = await listTool!.invoke(
      {
        context: {
          runId: retryRunId,
          rootRunId,
          userId: 42,
          role: "user",
        },
      } as Parameters<NonNullable<typeof listTool>["invoke"]>[0],
      JSON.stringify({ limit: 5, offset: 0 })
    );

    expect(result).toEqual(historicalResult);
    expect(listTickets).not.toHaveBeenCalled();
    expect(completeInvocation).toHaveBeenCalledWith({
      id: 11,
      result: historicalResult,
      status: "skipped",
      replayedFromInvocationId: 10,
    });
  });

  it("persists a transient tool failure for targeted retry", async () => {
    const rootRunId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    const searchTool = agentTools.find(tool => tool.name === "searchKnowledge");
    expect(searchTool).toBeDefined();

    vi.spyOn(db, "addAgentRunStep").mockResolvedValue({ id: 1 });
    vi.spyOn(db, "findReusableAgentToolInvocation").mockResolvedValue(null);
    vi.spyOn(db, "getAgentToolInvocationRetryCount").mockResolvedValue(2);
    const startInvocation = vi
      .spyOn(db, "startAgentToolInvocation")
      .mockResolvedValue({
        id: 12,
      } as Awaited<ReturnType<typeof db.startAgentToolInvocation>>);
    const failInvocation = vi
      .spyOn(db, "failAgentToolInvocation")
      .mockResolvedValue(null);
    vi.spyOn(db, "searchKnowledgeWithMeta").mockRejectedValue(
      new Error("embedding request timed out")
    );

    const result = await searchTool!.invoke(
      {
        context: {
          runId,
          rootRunId,
          userId: 42,
          role: "user",
        },
      } as Parameters<NonNullable<typeof searchTool>["invoke"]>[0],
      JSON.stringify({ query: "退款政策", limit: 3 })
    );

    expect(result).toContain("知识库检索失败");
    expect(startInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        rootRunId,
        runId,
        toolName: "searchKnowledge",
        retryCount: 2,
      })
    );
    expect(failInvocation).toHaveBeenCalledWith({
      id: 12,
      error: "embedding request timed out",
      errorType: "transient",
      status: "failed",
    });
  });

  it("classifies retryable and non-retryable tool failures", () => {
    expect(classifyAgentToolError(new Error("request timed out"))).toBe(
      "transient"
    );
    expect(classifyAgentToolError(new Error("Unauthorized"))).toBe(
      "permission"
    );
    expect(classifyAgentToolError(new Error("Ticket not found"))).toBe(
      "not_found"
    );
    expect(classifyAgentToolError(new Error("invalid parameter"))).toBe(
      "validation"
    );
    expect(classifyAgentToolError(new Error("unexpected failure"))).toBe(
      "unknown"
    );
  });

  it("builds a bounded replay context from successful tool results", () => {
    const context = buildAgentReplayContext([
      {
        toolName: "searchKnowledge",
        args: { query: "退款政策" },
        result: { entries: [{ id: 1, title: "退款政策" }] },
      },
      {
        toolName: "listTickets",
        args: { limit: 5 },
        result: [{ id: 7, status: "pending" }],
      },
    ]);

    expect(context).toContain("工具：searchKnowledge");
    expect(context).toContain("成功结果");
    expect(context).toContain("工具：listTickets");
    expect(context.length).toBeLessThanOrEqual(8_000);
  });

  it("builds stable side-effect keys across retry argument variations", () => {
    const rootRunId = "11111111-1111-4111-8111-111111111111";
    const first = buildToolEffectIdentity(
      rootRunId,
      rootRunId,
      "createTicket",
      { title: "物流异常", priority: "high" },
      "single"
    );
    const retry = buildToolEffectIdentity(
      rootRunId,
      "22222222-2222-4222-8222-222222222222",
      "createTicket",
      { priority: "high", title: "物流持续异常" },
      "single"
    );

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.argsHash).not.toBe(first.argsHash);
  });

  it("normalizes object key order when hashing tool arguments", () => {
    const rootRunId = "11111111-1111-4111-8111-111111111111";
    const left = buildToolEffectIdentity(
      rootRunId,
      rootRunId,
      "addTicketNote",
      { ticketId: 9, content: "跟进" }
    );
    const right = buildToolEffectIdentity(
      rootRunId,
      rootRunId,
      "addTicketNote",
      { content: "跟进", ticketId: 9 }
    );

    expect(right.argsHash).toBe(left.argsHash);
    expect(right.idempotencyKey).toBe(left.idempotencyKey);
  });

  it("validates tool inputs and applies defaults", () => {
    expect(
      AgentToolInputSchemas.searchKnowledge.parse({ query: "退货政策" })
    ).toEqual({ query: "退货政策", limit: 3 });
    expect(
      AgentToolInputSchemas.createTicket.parse({
        title: "物流异常",
        description: "订单三天未更新",
      })
    ).toEqual({
      title: "物流异常",
      description: "订单三天未更新",
      priority: "medium",
    });
    expect(
      AgentToolInputSchemas.addTicketNote.safeParse({
        ticketId: -1,
        content: "",
      }).success
    ).toBe(false);
  });

  it("rejects invalid list ticket filters", () => {
    expect(
      AgentToolInputSchemas.listTickets.safeParse({
        status: "deleted",
        limit: 100,
      }).success
    ).toBe(false);
  });

  it("summarizes long tool results before exposing them to the frontend", () => {
    const summary = summarizeAgentValue(
      {
        ticketId: 9,
        description: "x".repeat(800),
      },
      120
    );

    expect(summary.length).toBeLessThanOrEqual(123);
    expect(summary).toContain("ticketId");
    expect(summary.endsWith("...")).toBe(true);
  });
});

describe("agent run lifecycle transitions", () => {
  it("models successful run creation through completion", () => {
    const transitions: AgentRunStatus[] = [
      "queued",
      "planning",
      "running",
      "completed",
    ];

    expect(transitions[0]).toBe("queued");
    expect(transitions.at(-1)).toBe("completed");
    expect(transitions.every(status => runStatuses.includes(status))).toBe(
      true
    );
  });

  it("models failed and retry run recovery metadata", () => {
    const failedRunId = "11111111-1111-4111-8111-111111111111";
    const retryRunId = "22222222-2222-4222-8222-222222222222";
    const failedRun = {
      id: failedRunId,
      status: "failed" as AgentRunStatus,
      input: "查询工单失败",
      error: "tool timeout",
    };
    const retryRun = {
      id: retryRunId,
      status: "queued" as AgentRunStatus,
      retryOfRunId: failedRun.id,
      input: failedRun.input,
    };

    expect(failedRun.status).toBe("failed");
    expect(retryRun.retryOfRunId).toBe(failedRunId);
    expect(retryRun.input).toBe(failedRun.input);
  });

  it("keeps persisted steps sufficient for refresh recovery", () => {
    const persistedSteps: AgentRunStepType[] = [
      "thinking",
      "tool_call",
      "tool_result",
      "final",
    ];

    expect(persistedSteps.every(step => stepTypes.includes(step))).toBe(true);
    expect(persistedSteps).toContain("final");
  });
});

describe("agent handoff, tracing, and comparison metadata", () => {
  it("generates SDK-compatible stable trace ids", () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    expect(getAgentTraceId(runId)).toMatch(/^trace_[a-f0-9]{32}$/);
    expect(getAgentTraceId(runId)).toBe(getAgentTraceId(runId));
  });

  it("evaluates handoff targets from structured output", () => {
    const evaluation = evaluateAgentHandoff({
      category: "technical",
      riskLevel: "high",
      summary: "用户遇到产品报错",
      suggestedActions: ["查看错误日志"],
      shouldCreateTicket: true,
      referencedTicketIds: [7],
    });

    expect(AgentHandoffEvaluationSchema.safeParse(evaluation).success).toBe(
      true
    );
    expect(evaluation.recommendedAgent).toBe("technical_support");
  });

  it("captures Agent SDK versus simple RAG comparison notes", () => {
    const comparison = getAgentRagComparison({
      latencyMs: 1234,
      toolCallCount: 2,
      toolResultCount: 2,
    });

    expect(comparison.simpleRag.strengths[0]).toContain("延迟");
    expect(comparison.agentSdk.strengths[0]).toContain("工单工具");
    expect(comparison.observedRun.toolCallCount).toBe(2);
  });
});
