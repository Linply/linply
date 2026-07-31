import type { AgentRun } from "../drizzle/schema";
import { SpanStatusCode } from "@opentelemetry/api";
import { ENV } from "./_core/env";
import {
  createRemoteTraceContext,
  getActiveTraceContext,
  type TelemetryTraceContext,
  withActiveSpan,
} from "./_core/observability";
import { LLM_TIMEOUT_MS, parseJsonValue } from "./agentUtils";
import {
  deriveAgentWriteAuthorization,
  parseAgentWriteAuthorization,
} from "./agentPolicy";
import * as db from "./db";
import { streamAgentChatResponse } from "./agentService";

import { TokenQuotaExceededError } from "./tokenQuota";

export const getPublicAgentErrorMessage = (error: unknown) => {
  if (error instanceof TokenQuotaExceededError) return error.message;
  const message =
    error instanceof Error ? error.message : "发送消息失败，请稍后重试";

  if (
    /^Failed query:/i.test(message) ||
    /insert into "agent_run/i.test(message) ||
    /relation "agent_run/i.test(message)
  ) {
    return "Agent 运行记录写入失败，请确认数据库迁移已执行后重试。";
  }

  return message;
};

export const appendAgentStreamEvent = async (
  runId: string,
  eventType: db.AgentRunEventType,
  payload: Record<string, unknown>
) => {
  try {
    return await db.appendAgentRunEvent({ runId, eventType, payload });
  } catch (error) {
    console.error("[Agent] Failed to persist stream event", {
      runId,
      eventType,
      error,
    });
    return null;
  }
};

export async function enqueueAgentRun(input: {
  userId: number;
  userRole?: "user" | "admin";
  ticketId?: number;
  content: string;
  retryOfRunId?: string;
}) {
  const telemetry = getActiveTraceContext();
  const authorization = deriveAgentWriteAuthorization(input.content);
  const run = await db.createAgentRun({
    userId: input.userId,
    userRole: input.userRole,
    ticketId: input.ticketId,
    input: input.content,
    status: "queued",
    llmProvider: "openai-agents",
    llmModel: ENV.openAiModel,
    retryOfRunId: input.retryOfRunId,
    traceId: telemetry?.traceId,
    metadata: {
      mode: "stream",
      executionMode: ENV.agentExecutionMode,
      telemetry,
      authorization,
    },
  });

  const quota = await db.getTokenQuota(input.userId, input.userRole);
  await appendAgentStreamEvent(run.id, "meta", {
    relatedKnowledge: [],
    retrieval: null,
    llmProvider: "openai-agents",
    runId: run.id,
  });
  if (ENV.agentExecutionMode === "inline") {
    void executeAgentRun(run).catch(error => {
      console.error("[Agent] Inline execution failed", { runId: run.id, error });
    });
  }
  return { ...run, quota };
}

async function executeAgentRunInternal(
  run: AgentRun,
  worker?: { workerId: string; leaseMs: number }
) {
  const user = await db.getUserById(run.userId);
  if (!user) throw new Error("Agent Run user not found");

  if (run.attemptCount > 1) {
    await appendAgentStreamEvent(run.id, "reset", {
      reason: "worker_retry",
      attemptCount: run.attemptCount,
    });
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);
  const heartbeatId = worker
    ? setInterval(() => {
        void db.renewAgentRunLease({
          runId: run.id,
          workerId: worker.workerId,
          leaseMs: worker.leaseMs,
        }).then(renewed => {
          if (!renewed) abortController.abort();
        }).catch(error => {
          console.error("[Agent Worker] Failed to renew lease", {
            runId: run.id,
            error,
          });
        });
      }, Math.max(1_000, Math.floor(worker.leaseMs / 3)))
    : undefined;

  try {
    const runMetadata = parseJsonValue<Record<string, unknown>>(run.metadata, {});
    const authorization =
      parseAgentWriteAuthorization(runMetadata.authorization) ??
      deriveAgentWriteAuthorization(run.input);
    const result = await streamAgentChatResponse(
      {
        runId: run.id,
        userId: run.userId,
        userRole: user.role,
        ticketId: run.ticketId ?? undefined,
        content: run.input,
        authorization,
        retryOfRunId: run.retryOfRunId ?? undefined,
        executionFence: worker ? {
          workerId: worker.workerId,
          attemptCount: run.attemptCount,
        } : undefined,
      },
      abortController.signal,
      async event => {
        await appendAgentStreamEvent(run.id, "agent_event", {
          event,
          attemptCount: run.attemptCount,
        });
      },
      async content => {
        await appendAgentStreamEvent(run.id, "delta", {
          content,
          attemptCount: run.attemptCount,
        });
      }
    );

    await appendAgentStreamEvent(run.id, "meta", {
      relatedKnowledge: result.relatedKnowledgeSnapshot,
      retrieval: result.retrieval ?? null,
      llmProvider: "openai-agents",
      runId: result.runId,
      structuredOutput: result.structuredOutput,
      attemptCount: run.attemptCount,
    });
    await appendAgentStreamEvent(run.id, "done", {
      llmProvider: "openai-agents",
      llmModel: ENV.openAiModel,
      stats: { ...result.runStats, usageState: "actual" },
      attemptCount: run.attemptCount,
    });
  } catch (error) {
    const message = getPublicAgentErrorMessage(
      abortController.signal.aborted
        ? new Error("LLM call timed out，请稍后重试")
        : error
    );
    await db.finalizeFailedAgentRun({
      runId: run.id,
      attemptNumber: run.attemptCount,
      error: message,
      executionFence: worker
        ? { workerId: worker.workerId, attemptCount: run.attemptCount }
        : undefined,
    }).catch(updateError => {
      console.error("[Agent] Failed to mark run failed", updateError);
    });
    await appendAgentStreamEvent(run.id, "error", {
      message,
      stats: await db.getAgentRunById(run.id).then(currentRun =>
        currentRun
          ? {
              durationMs: currentRun.durationMs,
              inputTokens: currentRun.inputTokens,
              outputTokens: currentRun.outputTokens,
              totalTokens: currentRun.totalTokens,
              llmRequestCount: currentRun.llmRequestCount,
              contextWindowTokens: currentRun.contextWindowTokens,
              traceId: currentRun.traceId,
              spanId: currentRun.spanId,
              usageState: currentRun.usageState,
            }
          : undefined
      ),
      attemptCount: run.attemptCount,
    });
  } finally {
    clearTimeout(timeoutId);
    if (heartbeatId) clearInterval(heartbeatId);
    if (worker) {
      await db.clearAgentRunLease(run.id, worker.workerId).catch(error => {
        console.error("[Agent Worker] Failed to clear lease", {
          runId: run.id,
          error,
        });
      });
    }
  }
}

export async function executeAgentRun(
  run: AgentRun,
  worker?: { workerId: string; leaseMs: number }
) {
  const metadata = parseJsonValue<Record<string, unknown>>(run.metadata, {});
  const parentTrace = parseJsonValue<TelemetryTraceContext | null>(
    metadata.telemetry,
    null
  );
  const parentContext = createRemoteTraceContext(parentTrace);

  return withActiveSpan(
    "agent.run",
    {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.request.model": run.llmModel ?? ENV.openAiModel,
      "agent.run.id": run.id,
      "agent.run.attempt": run.attemptCount,
      "agent.execution.mode": worker ? "worker" : "inline",
      "agent.user.id": run.userId,
      ...(run.ticketId ? { "agent.ticket.id": run.ticketId } : {}),
    },
    async span => {
      const telemetry = getActiveTraceContext();
      if (telemetry) {
        await db.updateAgentRun(
          run.id,
          { traceId: telemetry.traceId, spanId: telemetry.spanId },
          worker
            ? {
                workerId: worker.workerId,
                attemptCount: run.attemptCount,
              }
            : undefined
        );
      }

      await executeAgentRunInternal(run, worker);
      const completedRun = await db.getAgentRunById(run.id);
      if (completedRun) {
        span.setAttributes({
          "agent.run.status": completedRun.status,
          "agent.run.duration_ms": completedRun.durationMs ?? 0,
          "gen_ai.usage.input_tokens": completedRun.inputTokens ?? 0,
          "gen_ai.usage.output_tokens": completedRun.outputTokens ?? 0,
          "gen_ai.usage.total_tokens": completedRun.totalTokens ?? 0,
        });
        if (completedRun.status === "failed") {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: completedRun.error ?? "Agent Run failed",
          });
        }
      }
    },
    parentContext
  );
}
