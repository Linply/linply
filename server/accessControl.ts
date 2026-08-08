import * as db from "./db";
import { isConsoleScope, type ConversationScope } from "./workspace";

/**
 * Authorization is workspace-scoped, not role-scoped. Two rules cover every
 * read/write in the app:
 *
 * 1. A row is reachable only from the workspace it belongs to.
 * 2. Inside a workspace, the owner (console scope) sees everything; an external
 *    contact only ever sees rows attributed to that same contact.
 */

export type TicketListFilters = Omit<
  NonNullable<Parameters<typeof db.listTickets>[0]>,
  "workspaceId" | "contactId" | "userId"
>;

export class WorkspaceAccessError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export async function getTicketForScope(
  ticketId: number,
  scope: ConversationScope
) {
  const ticket = await db.getTicketById(ticketId);
  if (!ticket) throw new WorkspaceAccessError("Ticket not found");
  if (ticket.workspaceId !== scope.workspaceId) {
    throw new WorkspaceAccessError();
  }
  if (!isConsoleScope(scope) && ticket.contactId !== scope.contactId) {
    throw new WorkspaceAccessError();
  }
  return ticket;
}

export function listTicketsForScope(
  filters: TicketListFilters | undefined,
  scope: ConversationScope
) {
  return db.listTickets({
    ...filters,
    workspaceId: scope.workspaceId,
    ...(isConsoleScope(scope) ? {} : { contactId: scope.contactId ?? undefined }),
  });
}

export async function getTicketNotesForScope(
  ticketId: number,
  scope: ConversationScope
) {
  await getTicketForScope(ticketId, scope);
  return db.getTicketNotes(ticketId);
}

export async function getTicketAndNotesForScope(
  ticketId: number,
  scope: ConversationScope
) {
  const ticket = await getTicketForScope(ticketId, scope);
  const notes = await db.getTicketNotes(ticketId);
  return { ticket, notes };
}

export async function getTicketChatHistoryForScope(
  ticketId: number,
  limit: number,
  scope: ConversationScope
) {
  await getTicketForScope(ticketId, scope);
  return db.getTicketChatHistory(scope.workspaceId, ticketId, limit);
}

export async function getChatHistoryForScope(
  ticketId: number | undefined,
  limit: number,
  scope: ConversationScope
) {
  if (ticketId !== undefined) {
    await getTicketForScope(ticketId, scope);
  }
  return db.getChatHistory(
    {
      workspaceId: scope.workspaceId,
      contactId: scope.contactId,
      ticketId,
    },
    limit
  );
}

export async function getRecentChatHistoryForScope(
  ticketId: number | undefined,
  limit: number,
  scope: ConversationScope
) {
  if (ticketId !== undefined) {
    await getTicketForScope(ticketId, scope);
  }
  return db.getRecentChatHistory(
    {
      workspaceId: scope.workspaceId,
      contactId: scope.contactId,
      ticketId,
    },
    limit
  );
}

export async function getAgentRunForWorkspace(
  runId: string,
  workspaceId: number
) {
  const run = await db.getAgentRunWithSteps(runId);
  if (!run) throw new WorkspaceAccessError("Agent run not found");
  if (run.workspaceId !== workspaceId) throw new WorkspaceAccessError();
  return run;
}

export async function getAgentRunRecordForWorkspace(
  runId: string,
  workspaceId: number
) {
  const run = await db.getAgentRunById(runId);
  if (!run) throw new WorkspaceAccessError("Agent run not found");
  if (run.workspaceId !== workspaceId) throw new WorkspaceAccessError();
  return run;
}
