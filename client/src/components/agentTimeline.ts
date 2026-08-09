import type {
  AgentActivity,
  AgentActivityKey,
  AgentActivityParams,
} from "@shared/agentActivity";

export type AgentEvent = {
  type: "thinking" | "tool_call" | "tool_result" | "final";
  message?: string;
  toolName?: string;
  argsSummary?: string;
  resultSummary?: string;
  content?: string;
  runId?: string;
  /** Pairs a result with its call even when tools run concurrently. */
  callId?: string;
  /** What to show the user for this step; see shared/agentActivity.ts. */
  activity?: AgentActivity;
};

export type AgentStep = {
  id: number;
  runId: string;
  stepType: "thinking" | "tool_call" | "tool_result" | "final" | "error";
  toolName: string | null;
  argsSummary: string | null;
  resultSummary: string | null;
  content: string | null;
  error: string | null;
  createdAt: string | Date;
  metadata?: { activity?: AgentActivity; callId?: string } | null;
};

export type AgentActivityDictionary = Record<
  AgentActivityKey,
  (params: AgentActivityParams) => string
>;

/**
 * The model writes its own status line in the customer's language, so it wins
 * outright; otherwise the server's key is rendered in the reader's language,
 * and the server's pre-rendered text is the last resort.
 */
export const formatAgentActivity = (
  activity: AgentActivity | undefined | null,
  dictionary: AgentActivityDictionary,
  overrides?: AgentActivityParams
) => {
  if (!activity) return "";
  if (activity.reason) return activity.reason;
  const render = dictionary[activity.key];
  if (!render) return activity.text;
  return render({ ...activity.params, ...overrides });
};

export const agentEventToStep = (
  event: AgentEvent,
  index: number,
  runId?: string
): AgentStep => ({
  id: index,
  runId: event.runId ?? runId ?? "",
  stepType: event.type,
  toolName: event.toolName ?? null,
  argsSummary: event.argsSummary ?? null,
  resultSummary: event.resultSummary ?? null,
  content: event.content ?? event.message ?? null,
  error: null,
  createdAt: new Date(),
  metadata: event.activity ? { activity: event.activity } : null,
});

export const formatJsonSummary = (value: string | null | undefined) => {
  if (!value) return "";

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};
