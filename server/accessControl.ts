import type { User } from "../drizzle/schema";
import * as db from "./db";

export type AccessUser = Pick<User, "id" | "role">;

export type TicketListFilters = Omit<
  NonNullable<Parameters<typeof db.listTickets>[0]>,
  "userId"
>;

const isAdmin = (user: AccessUser) => user.role === "admin";

export async function getTicketForUser(ticketId: number, user: AccessUser) {
  const ticket = await db.getTicketById(ticketId);
  if (!ticket) throw new Error("Ticket not found");
  if (!isAdmin(user) && ticket.userId !== user.id) {
    throw new Error("Unauthorized");
  }
  return ticket;
}

export function listTicketsForUser(
  filters: TicketListFilters | undefined,
  user: AccessUser
) {
  return db.listTickets({
    ...filters,
    userId: isAdmin(user) ? undefined : user.id,
  });
}

export async function getTicketNotesForUser(
  ticketId: number,
  user: AccessUser
) {
  await getTicketForUser(ticketId, user);
  return db.getTicketNotes(ticketId);
}

export async function getTicketAndNotesForUser(
  ticketId: number,
  user: AccessUser
) {
  const ticket = await getTicketForUser(ticketId, user);
  const notes = await db.getTicketNotes(ticketId);
  return { ticket, notes };
}

export async function getTicketChatHistoryForUser(
  ticketId: number,
  limit: number,
  user: AccessUser
) {
  await getTicketForUser(ticketId, user);
  return db.getTicketChatHistory(ticketId, limit);
}

export async function getChatHistoryForUser(
  ticketId: number | undefined,
  limit: number,
  user: AccessUser
) {
  if (ticketId !== undefined) {
    await getTicketForUser(ticketId, user);
  }
  return db.getChatHistory(user.id, ticketId, limit);
}

export async function getRecentChatHistoryForUser(
  ticketId: number | undefined,
  limit: number,
  user: AccessUser
) {
  if (ticketId !== undefined) {
    await getTicketForUser(ticketId, user);
  }
  return db.getRecentChatHistory(user.id, ticketId, limit);
}

export async function getAgentRunForUser(runId: string, user: AccessUser) {
  const run = await db.getAgentRunWithSteps(runId);
  if (!run) throw new Error("Agent run not found");
  if (!isAdmin(user) && run.userId !== user.id) {
    throw new Error("Unauthorized");
  }
  return run;
}

export async function getAgentRunRecordForUser(
  runId: string,
  user: AccessUser
) {
  const run = await db.getAgentRunById(runId);
  if (!run) throw new Error("Agent run not found");
  if (!isAdmin(user) && run.userId !== user.id) {
    throw new Error("Unauthorized");
  }
  return run;
}
