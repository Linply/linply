/**
 * One line of "what the agent is doing right now", shared by the server (which
 * decides what happened) and the client (which decides how to say it).
 *
 * The server never ships a finished sentence as the primary copy: it ships a
 * key plus params so the browser can render it in the reader's language, and a
 * pre-rendered `text` that non-web channels — and older clients — can use as is.
 * The one exception is `reason`, written by the model in the user's own
 * language, which always wins when present.
 */

export type AgentActivityIcon =
  | "thinking"
  | "knowledge"
  | "ticketNew"
  | "ticketList"
  | "ticketDetail"
  | "ticketNote"
  | "tool";

export type AgentActivityPhase = "running" | "done" | "error";

export type AgentActivityKey =
  | "thinking"
  | "searchKnowledge.running"
  | "searchKnowledge.done"
  | "searchKnowledge.empty"
  | "createTicket.running"
  | "createTicket.done"
  | "createTicket.replayed"
  | "listTickets.running"
  | "listTickets.done"
  | "listTickets.empty"
  | "getTicketById.running"
  | "getTicketById.done"
  | "addTicketNote.running"
  | "addTicketNote.done"
  | "tool.running"
  | "tool.done"
  | "tool.error";

export type AgentActivityParams = {
  query?: string;
  count?: number;
  ticketId?: number;
  label?: string;
};

export type AgentActivity = {
  icon: AgentActivityIcon;
  phase: AgentActivityPhase;
  key: AgentActivityKey;
  params: AgentActivityParams;
  /** Model-authored, user-facing, already in the user's language. */
  reason?: string;
  /** Server-rendered fallback copy — used by channels without an i18n layer. */
  text: string;
  /** Short trailing meta, e.g. a result count. */
  meta?: string;
};
