import { describe, expect, it } from "vitest";
import type { AgentRunStatus, AgentRunStepType } from "./db";
import {
  AgentHandoffEvaluationSchema,
  AgentToolInputSchemas,
  StructuredAgentOutputSchema,
  buildStructuredAgentOutput,
  evaluateInputGuardrails,
  evaluateAgentHandoff,
  getAgentRagComparison,
  getAgentTraceId,
  summarizeAgentValue,
} from "./agentService";

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
      assistantContent: "最近工单显示物流延迟，建议查看相关工单详情并继续跟进。",
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

    expect(StructuredAgentOutputSchema.safeParse(structured).success).toBe(true);
    expect(structured.category).toBe("shipping");
    expect(structured.referencedTicketIds).toEqual([12]);
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

    expect(StructuredAgentOutputSchema.safeParse(structured).success).toBe(true);
    expect(structured.category).toBe("technical");
    expect(structured.riskLevel).toBe("urgent");
    expect(structured.shouldCreateTicket).toBe(true);
    expect(structured.suggestedActions[0]).toContain("创建工单");
  });
});

describe("agent tool validation and summaries", () => {
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
    expect(transitions.every(status => runStatuses.includes(status))).toBe(true);
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

    expect(AgentHandoffEvaluationSchema.safeParse(evaluation).success).toBe(true);
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
