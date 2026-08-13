import type { AgentRun } from "../drizzle/schema";
import {
  type MessageAttachment,
  parseMessageAttachments,
} from "../shared/attachments";
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
import { AGENT_LLM_PROVIDER, streamAgentChatResponse } from "./agentService";
import { resolveWorkspaceModel } from "./agentModelCatalog";
import type { ConversationScope } from "./workspace";

import { TokenQuotaExceededError } from "./tokenQuota";

/**
 * Postgres puts the useful part of a failure on `cause` — the driver's message
 * is just the SQL that failed. Losing it turns every database problem into the
 * same unactionable sentence.
 */
const describeErrorCause = (error: unknown): Record<string, unknown> => {
  const cause = (error as { cause?: unknown })?.cause;
  if (!cause || typeof cause !== "object") return {};
  const detail = cause as {
    message?: unknown;
    code?: unknown;
    detail?: unknown;
    column?: unknown;
    table?: unknown;
    constraint?: unknown;
    routine?: unknown;
  };
  return {
    causeMessage: detail.message,
    code: detail.code,
    detail: detail.detail,
    column: detail.column,
    table: detail.table,
    constraint: detail.constraint,
    routine: detail.routine,
  };
};

export const getPublicAgentErrorMessage = (
  error: unknown,
  context?: Record<string, unknown>
) => {
  if (error instanceof TokenQuotaExceededError) return error.message;
  const message =
    error instanceof Error ? error.message : "发送消息失败，请稍后重试";

  if (
    /^Failed query:/i.test(message) ||
    /insert into "agent_run/i.test(message) ||
    /relation "agent_run/i.test(message)
  ) {
    // The customer gets a short sentence; the operator gets the actual failure.
    console.error("[Agent] Database error while running the agent", {
      ...context,
      message,
      ...describeErrorCause(error),
    });
    return "Agent 运行记录写入失败，请稍后重试；若持续失败请检查服务端日志。";
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
  scope: ConversationScope;
  ticketId?: number;
  content: string;
  retryOfRunId?: string;
  /** Images and documents the customer attached to this message. */
  attachments?: MessageAttachment[];
}) {
  const telemetry = getActiveTraceContext();
  const authorization = deriveAgentWriteAuthorization(input.content);
  // Recorded up front so a queued run already shows which model will answer.
  const workspace = await db.getWorkspaceById(input.scope.workspaceId);
  const { model } = resolveWorkspaceModel(workspace?.agentModel);
  const run = await db.createAgentRun({
    workspaceId: input.scope.workspaceId,
    userId: input.scope.ownerUserId,
    contactId: input.scope.contactId,
    channelId: input.scope.channelId,
    ticketId: input.ticketId,
    input: input.content,
    attachments: input.attachments,
    status: "queued",
    llmProvider: AGENT_LLM_PROVIDER,
    llmModel: model,
    retryOfRunId: input.retryOfRunId,
    traceId: telemetry?.traceId,
    metadata: {
      mode: "stream",
      executionMode: ENV.agentExecutionMode,
      telemetry,
      authorization,
    },
  });

  const quota = await db.getTokenQuota(input.scope.ownerUserId);
  await appendAgentStreamEvent(run.id, "meta", {
    relatedKnowledge: [],
    retrieval: null,
    llmProvider: AGENT_LLM_PROVIDER,
    runId: run.id,
  });
  if (ENV.agentExecutionMode === "inline") {
    void executeAgentRun(run).catch(error => {
      console.error("[Agent] Inline execution failed", {
        runId: run.id,
        error,
      });
    });
  }
  return { ...run, quota };
}

async function executeAgentRunInternal(
  run: AgentRun,
  worker?: { workerId: string; leaseMs: number }
) {
  const scope: ConversationScope = {
    workspaceId: run.workspaceId,
    ownerUserId: run.userId,
    contactId: run.contactId,
    channelId: run.channelId,
  };

  if (run.attemptCount > 1) {
    await appendAgentStreamEvent(run.id, "reset", {
      reason: "worker_retry",
      attemptCount: run.attemptCount,
    });
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);
  const heartbeatId = worker
    ? setInterval(
        () => {
          void db
            .renewAgentRunLease({
              runId: run.id,
              workerId: worker.workerId,
              leaseMs: worker.leaseMs,
            })
            .then(renewed => {
              if (!renewed) abortController.abort();
            })
            .catch(error => {
              console.error("[Agent Worker] Failed to renew lease", {
                runId: run.id,
                error,
              });
            });
        },
        Math.max(1_000, Math.floor(worker.leaseMs / 3))
      )
    : undefined;

  try {
    const runMetadata = parseJsonValue<Record<string, unknown>>(
      run.metadata,
      {}
    );
    const authorization =
      parseAgentWriteAuthorization(runMetadata.authorization) ??
      deriveAgentWriteAuthorization(run.input);
    const result = await streamAgentChatResponse(
      {
        runId: run.id,
        scope,
        ticketId: run.ticketId ?? undefined,
        content: run.input,
        // Re-read from the run rather than the message, so a retry rebuilds the
        // same multimodal input the first attempt was given.
        attachments: parseMessageAttachments(run.attachments),
        authorization,
        retryOfRunId: run.retryOfRunId ?? undefined,
        executionFence: worker
          ? {
              workerId: worker.workerId,
              attemptCount: run.attemptCount,
            }
          : undefined,
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
      llmProvider: AGENT_LLM_PROVIDER,
      runId: result.runId,
      structuredOutput: result.structuredOutput,
      attemptCount: run.attemptCount,
    });
    await appendAgentStreamEvent(run.id, "done", {
      llmProvider: AGENT_LLM_PROVIDER,
      llmModel: result.llmModel,
      stats: { ...result.runStats, usageState: "actual" },
      attemptCount: run.attemptCount,
      // Only sent when the streamed text differs from what was saved, so the
      // bubble the customer is looking at matches the stored conversation.
      ...(result.replacedStreamedContent
        ? { finalContent: result.assistantContent }
        : {}),
    });
  } catch (error) {
    const message = getPublicAgentErrorMessage(
      abortController.signal.aborted
        ? new Error("LLM call timed out，请稍后重试")
        : error,
      { stage: "execute", runId: run.id, attempt: run.attemptCount }
    );
    await db
      .finalizeFailedAgentRun({
        runId: run.id,
        attemptNumber: run.attemptCount,
        error: message,
        executionFence: worker
          ? { workerId: worker.workerId, attemptCount: run.attemptCount }
          : undefined,
      })
      .catch(updateError => {
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
      "agent.workspace.id": run.workspaceId,
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
