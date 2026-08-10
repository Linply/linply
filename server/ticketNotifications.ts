import type { Ticket } from "../drizzle/schema";
import { logWarn } from "./_core/observability";
import * as db from "./db";
import { getChannelAdapter } from "./channels/registry";

export type TicketResolutionNotification =
  | { status: "not_applicable"; provider: null }
  | { status: "delivered"; provider: "web" | "telegram" }
  | { status: "failed"; provider: string | null };

export type TicketNotificationLocale = "en" | "zh";

export const resolveTicketNotificationLocale = (
  locale: string | null | undefined
): TicketNotificationLocale => {
  if (!locale) return "zh";
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
};

export const buildTicketResolvedMessage = (
  ticket: Pick<Ticket, "id" | "title">,
  locale: TicketNotificationLocale = "zh"
) =>
  locale === "en"
    ? `Your ticket #${ticket.id} "${ticket.title}" has been resolved. If the issue continues, reply to this message.`
    : `你的工单 #${ticket.id}「${ticket.title}」已处理完成。如果问题仍未解决，可以直接回复这条消息。`;

export async function notifyTicketResolved(
  ticket: Ticket,
  ownerUserId: number
): Promise<TicketResolutionNotification> {
  if (ticket.contactId == null || ticket.channelId == null) {
    return { status: "not_applicable", provider: null };
  }

  let provider: string | null = null;
  try {
    const [contact, channel] = await Promise.all([
      db.getChannelContactById(ticket.contactId, ticket.workspaceId),
      db.getWorkspaceChannelById(ticket.channelId, ticket.workspaceId),
    ]);
    provider = channel?.provider ?? null;

    if (!contact || !channel || contact.channelId !== channel.id) {
      throw new Error("Ticket channel contact is unavailable");
    }

    const content = buildTicketResolvedMessage(
      ticket,
      resolveTicketNotificationLocale(contact.locale)
    );
    if (channel.provider !== "web") {
      const adapter = getChannelAdapter(channel.provider);
      if (
        !adapter ||
        !contact.externalChatId ||
        channel.status === "disabled"
      ) {
        throw new Error("Ticket channel cannot deliver outbound messages");
      }
      await adapter.sendMessage(channel, contact.externalChatId, content);
    }

    await db.saveChatMessage({
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      userId: ownerUserId,
      contactId: contact.id,
      channelId: channel.id,
      role: "assistant",
      content,
    });

    return {
      status: "delivered",
      provider: channel.provider as "web" | "telegram",
    };
  } catch (error) {
    logWarn("[Tickets] Failed to notify external contact of resolution", {
      ticketId: ticket.id,
      workspaceId: ticket.workspaceId,
      provider,
      error,
    });
    return { status: "failed", provider };
  }
}
