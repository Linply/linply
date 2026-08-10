import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getChannelContactById: vi.fn(),
  getWorkspaceChannelById: vi.fn(),
  saveChatMessage: vi.fn(),
}));

vi.mock("./channels/registry", () => ({
  getChannelAdapter: vi.fn(),
}));

import type { Ticket } from "../drizzle/schema";
import { getChannelAdapter } from "./channels/registry";
import * as db from "./db";
import {
  buildTicketResolvedMessage,
  notifyTicketResolved,
  resolveTicketNotificationLocale,
} from "./ticketNotifications";

const mockedDb = vi.mocked(db);
const mockedGetChannelAdapter = vi.mocked(getChannelAdapter);

const ticket: Ticket = {
  id: 42,
  workspaceId: 7,
  userId: 10,
  contactId: 21,
  channelId: 31,
  title: "退款进度",
  description: "退款还没有到账",
  status: "resolved",
  priority: "medium",
  assignedTo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  resolvedAt: new Date(),
};

const contact = {
  id: 21,
  workspaceId: 7,
  channelId: 31,
  externalChatId: "external-chat-21",
  locale: null,
};

const channel = {
  id: 31,
  workspaceId: 7,
  provider: "web" as const,
  status: "connected" as const,
};

describe("ticket resolution notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.getChannelContactById.mockResolvedValue(contact as never);
    mockedDb.getWorkspaceChannelById.mockResolvedValue(channel as never);
    mockedDb.saveChatMessage.mockResolvedValue(undefined as never);
  });

  it("skips tickets created in the owner's console", async () => {
    const result = await notifyTicketResolved(
      { ...ticket, contactId: null, channelId: null },
      10
    );

    expect(result).toEqual({ status: "not_applicable", provider: null });
    expect(mockedDb.getChannelContactById).not.toHaveBeenCalled();
  });

  it("writes the completion notice into a web visitor's conversation", async () => {
    const result = await notifyTicketResolved(ticket, 10);

    expect(result).toEqual({ status: "delivered", provider: "web" });
    expect(mockedGetChannelAdapter).not.toHaveBeenCalled();
    expect(mockedDb.saveChatMessage).toHaveBeenCalledWith({
      workspaceId: 7,
      ticketId: 42,
      userId: 10,
      contactId: 21,
      channelId: 31,
      role: "assistant",
      content: buildTicketResolvedMessage(ticket),
    });
  });

  it("uses English for an English-speaking contact", async () => {
    mockedDb.getChannelContactById.mockResolvedValue({
      ...contact,
      locale: "en-US",
    } as never);

    await notifyTicketResolved(ticket, 10);

    expect(mockedDb.saveChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: buildTicketResolvedMessage(ticket, "en"),
      })
    );
    expect(resolveTicketNotificationLocale("en-GB")).toBe("en");
    expect(resolveTicketNotificationLocale("zh-hans")).toBe("zh");
    expect(resolveTicketNotificationLocale("fr")).toBe("en");
    expect(resolveTicketNotificationLocale(null)).toBe("zh");
  });

  it("pushes the completion notice through Telegram and records it", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    mockedDb.getWorkspaceChannelById.mockResolvedValue({
      ...channel,
      provider: "telegram",
    } as never);
    mockedGetChannelAdapter.mockReturnValue({ sendMessage } as never);

    const result = await notifyTicketResolved(ticket, 10);

    expect(result).toEqual({ status: "delivered", provider: "telegram" });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 31, provider: "telegram" }),
      "external-chat-21",
      buildTicketResolvedMessage(ticket)
    );
    expect(mockedDb.saveChatMessage).toHaveBeenCalledOnce();
  });

  it("reports a delivery failure without recording an unsent Telegram message", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error("Telegram unavailable"));
    mockedDb.getWorkspaceChannelById.mockResolvedValue({
      ...channel,
      provider: "telegram",
    } as never);
    mockedGetChannelAdapter.mockReturnValue({ sendMessage } as never);

    const result = await notifyTicketResolved(ticket, 10);

    expect(result).toEqual({ status: "failed", provider: "telegram" });
    expect(mockedDb.saveChatMessage).not.toHaveBeenCalled();
  });
});
