export type AgentEvent = {
  type: "thinking" | "tool_call" | "tool_result" | "final";
  message?: string;
  toolName?: string;
  argsSummary?: string;
  resultSummary?: string;
  content?: string;
  runId?: string;
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
});

export const formatJsonSummary = (value: string | null | undefined) => {
  if (!value) return "";

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};
