import { describeToolCall, describeToolResult } from "../agentToolPresentation";
import * as db from "../db";
import type { AgentContext, AgentEvent } from "./types";

/**
 * The bridge between whatever engine is running the agent and the two places a
 * step has to land: the live stream the customer is watching, and the run
 * record an operator reads afterwards.
 */

export const MAX_SUMMARY_LENGTH = 600;

export const summarizeAgentValue = (
  value: unknown,
  maxLength = MAX_SUMMARY_LENGTH
) => {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 0);
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

/** Kept out of the columns so the run-detail view can replay the same copy. */
const stepPresentation = (event: AgentEvent) => {
  if (event.type === "final") return undefined;
  const metadata: Record<string, unknown> = {};
  if (event.activity) metadata.activity = event.activity;
  if (event.type !== "thinking" && event.callId) metadata.callId = event.callId;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

export const persistAgentEvent = async (runId: string, event: AgentEvent) => {
  if (event.type === "thinking") {
    await db.addAgentRunStep({
      runId,
      stepType: "thinking",
      content: event.message,
      metadata: stepPresentation(event),
    });
    return;
  }

  if (event.type === "tool_call") {
    await db.addAgentRunStep({
      runId,
      stepType: "tool_call",
      toolName: event.toolName,
      argsSummary: event.argsSummary,
      metadata: stepPresentation(event),
    });
    return;
  }

  if (event.type === "tool_result") {
    await db.addAgentRunStep({
      runId,
      stepType: "tool_result",
      toolName: event.toolName,
      resultSummary: event.resultSummary,
      metadata: stepPresentation(event),
    });
    return;
  }

  await db.addAgentRunStep({
    runId,
    stepType: "final",
    content: event.content,
  });
};

export const emitAgentEvent = async (
  context: AgentContext | undefined,
  event: AgentEvent
) => {
  const eventWithRun = context?.runId
    ? { ...event, runId: context.runId }
    : event;
  if (context?.runId) {
    await persistAgentEvent(context.runId, eventWithRun);
  }
  await context?.emit?.(eventWithRun);
};

export const emitToolCall = async (
  context: AgentContext | undefined,
  toolName: string,
  args: unknown,
  meta: { callId?: string; reason?: string }
) => {
  await emitAgentEvent(context, {
    type: "tool_call",
    toolName,
    argsSummary: summarizeAgentValue(args, 300),
    callId: meta.callId,
    activity: describeToolCall(toolName, args, meta.reason),
  });
};

export const emitToolResult = async (
  context: AgentContext | undefined,
  toolName: string,
  result: unknown,
  meta: { callId?: string; args?: unknown }
) => {
  await emitAgentEvent(context, {
    type: "tool_result",
    toolName,
    resultSummary: summarizeAgentValue(result),
    callId: meta.callId,
    activity: describeToolResult(toolName, meta.args, result),
  });
};
