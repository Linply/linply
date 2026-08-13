import { createHash, randomUUID } from "node:crypto";

import { withActiveSpan } from "../_core/observability";
import {
  AGENT_POLICY_DENIED_CODE,
  AgentPolicyDeniedError,
} from "../agentPolicy";
import * as db from "../db";
import { emitToolCall, emitToolResult } from "./events";
import type { AgentContext } from "./types";

/**
 * Tool execution that survives a retry. Every call is recorded against the run
 * it belongs to, keyed by the arguments it was given, so a run that dies
 * halfway through can be resumed without creating a second ticket or writing
 * the same note twice.
 *
 * This is engine-independent on purpose: it wrapped the OpenAI Agents SDK's
 * tools before, and wraps pi's now.
 */

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)])
    );
  }
  return value;
};

export const buildToolArgsHash = (args: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stableJsonValue(args)))
    .digest("hex");

export const buildToolEffectIdentity = (
  rootRunId: string,
  runId: string,
  toolName: string,
  args: unknown,
  scope?: string
) => {
  const argsHash = buildToolArgsHash(args);
  return {
    rootRunId,
    runId,
    argsHash,
    idempotencyKey: `${rootRunId}:${toolName}:${scope ?? argsHash}`,
  };
};

export const getToolEffectIdentity = (
  context: AgentContext,
  toolName: string,
  args: unknown,
  scope?: string
) => {
  if (!context.runId) throw new Error("缺少 Agent Run 上下文");
  return buildToolEffectIdentity(
    context.rootRunId ?? context.runId,
    context.runId,
    toolName,
    args,
    scope
  );
};

const addReplayMetadata = (summary: unknown, replayedFromRunId: string) => {
  const replay = {
    partialReplay: true,
    replayedFromRunId,
  };
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    return { ...(summary as Record<string, unknown>), ...replay };
  }
  return { ...replay, result: summary };
};

type TrackedToolOptions<TResult> = {
  context: AgentContext | undefined;
  /** pi hands the tool its own call id; a local one keeps untracked calls pairable. */
  callId?: string;
  toolName: string;
  input: unknown;
  /** Model-authored status line for the user; never part of the tool identity. */
  reason?: string;
  idempotencyKey?: string;
  authorize?: () => void;
  execute: () => Promise<TResult>;
  summarizeResult?: (result: TResult) => unknown;
};

export const executeTrackedAgentTool = async <TResult>({
  context,
  callId: providedCallId,
  toolName,
  input,
  reason,
  idempotencyKey,
  authorize,
  execute,
  summarizeResult,
}: TrackedToolOptions<TResult>): Promise<TResult> =>
  withActiveSpan(
    `agent.tool.${toolName}`,
    {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": toolName,
      "agent.run.id": context?.runId ?? "untracked",
      "agent.tool.has_idempotency_key": Boolean(idempotencyKey),
    },
    async span => {
      const callId = providedCallId ?? randomUUID();
      await emitToolCall(context, toolName, input, { callId, reason });

      const summarize = (result: TResult) =>
        summarizeResult?.(result) ?? result;
      const finish = (result: unknown) =>
        emitToolResult(context, toolName, result, { callId, args: input });
      if (!context?.runId) {
        const result = await execute();
        await finish(summarize(result));
        return result;
      }

      const argsHash = buildToolArgsHash(input);
      const identity = {
        rootRunId: context.rootRunId ?? context.runId,
        toolName,
        argsHash,
      };
      const [reusable, retryCount] = await Promise.all([
        db.findReusableAgentToolInvocation(identity),
        db.getAgentToolInvocationRetryCount(identity),
      ]);
      const invocation = await db.startAgentToolInvocation({
        ...identity,
        runId: context.runId,
        toolCallId: callId,
        idempotencyKey,
        args: input,
        retryCount,
      });
      span.setAttribute("agent.tool.retry_count", retryCount);

      try {
        authorize?.();
      } catch (error) {
        const errorType = classifyAgentToolError(error);
        span.setAttribute("error.type", errorType);
        span.setAttribute("agent.policy.denied", true);
        await db.failAgentToolInvocation({
          id: invocation.id,
          error: toolError(error),
          errorType,
          status: "failed",
        });
        await finish({
          success: false,
          code: AGENT_POLICY_DENIED_CODE,
          retryable: false,
          error: toolError(error),
        });
        throw error;
      }

      if (reusable) {
        span.setAttribute("agent.tool.replayed", true);
        const result = reusable.result as TResult;
        await db.completeAgentToolInvocation({
          id: invocation.id,
          result,
          status: "skipped",
          replayedFromInvocationId: reusable.id,
        });
        await finish(addReplayMetadata(summarize(result), reusable.runId));
        return result;
      }

      try {
        const result = await execute();
        await db.completeAgentToolInvocation({ id: invocation.id, result });
        await finish(summarize(result));
        return result;
      } catch (error) {
        const errorType = classifyAgentToolError(error);
        span.setAttribute("error.type", errorType);
        await db
          .failAgentToolInvocation({
            id: invocation.id,
            error: toolError(error),
            errorType,
            status: errorType === "unknown" ? "unknown" : "failed",
          })
          .catch(persistError => {
            console.error("[Agent] Failed to persist tool failure", {
              runId: context.runId,
              toolName,
              persistError,
            });
          });
        await finish({
          success: false,
          error: toolError(error),
          errorType,
        }).catch(() => undefined);
        throw error;
      }
    }
  );

export const toolError = (error: unknown) =>
  error instanceof Error ? error.message : "工具执行失败";

export const classifyAgentToolError = (
  error: unknown
): db.AgentToolErrorType => {
  if (error instanceof AgentPolicyDeniedError) return "permission";
  const message = toolError(error).toLowerCase();

  if (/lease is no longer owned|lease.*expired|租约/.test(message)) {
    return "lease_lost";
  }
  if (/unauthorized|forbidden|无权|权限|403/.test(message)) {
    return "permission";
  }
  if (/not found|不存在|找不到|404/.test(message)) {
    return "not_found";
  }
  if (/invalid|validation|参数|格式|zod/.test(message)) {
    return "validation";
  }
  if (
    /timeout|timed out|econnreset|econnrefused|network|fetch failed|temporar|unavailable|429|5\d\d/.test(
      message
    )
  ) {
    return "transient";
  }
  return "unknown";
};
