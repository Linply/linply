import type { AgentActivity } from "../../shared/agentActivity";
import type { MessageAttachment } from "../../shared/attachments";
import type { AgentWriteAuthorization } from "../agentPolicy";
import type * as db from "../db";
import type { ConversationScope } from "../workspace";

/**
 * What the user is told the agent is doing. `activity` is the presentation
 * half — a localizable line with no tool names in it; `argsSummary` and
 * `resultSummary` stay raw for the run-detail view and for audits.
 */
export type AgentEvent =
  | {
      type: "thinking";
      message: string;
      runId?: string;
      activity?: AgentActivity;
    }
  | {
      type: "tool_call";
      toolName: string;
      argsSummary: string;
      /** Pairs a result with its call even when tools run concurrently. */
      callId?: string;
      activity?: AgentActivity;
      runId?: string;
    }
  | {
      type: "tool_result";
      toolName: string;
      resultSummary: string;
      callId?: string;
      activity?: AgentActivity;
      runId?: string;
    }
  | { type: "final"; content: string; runId?: string };

/**
 * Everything a tool needs to know about the run it is executing inside. pi's
 * tools take no run context of their own, so this is closed over when the
 * per-run tool set is built.
 */
export type AgentContext = {
  runId?: string;
  rootRunId?: string;
  executionFence?: db.AgentRunExecutionFence;
  /** Which workspace, and on whose behalf, this run is answering. */
  scope: ConversationScope;
  ticketId?: number;
  currentUserMessage?: string;
  /** What the customer attached to the message that started this run. */
  attachments?: MessageAttachment[];
  authorization?: AgentWriteAuthorization;
  emit?: (event: AgentEvent) => void | Promise<void>;
};
