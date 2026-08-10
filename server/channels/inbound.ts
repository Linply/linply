import type { WorkspaceChannel } from "../../drizzle/schema";
import { logWarn } from "../_core/observability";
import { createAgentChatResponse } from "../agentService";
import * as db from "../db";
import { TokenQuotaExceededError } from "../tokenQuota";
import type { ConversationScope } from "../workspace";
import { getChannelAdapter } from "./registry";
import type { InboundChannelMessage } from "./types";

export const DEFAULT_GREETING =
  "你好，我是这里的智能客服。直接把问题发给我就行，我会基于知识库回答；答不上来的会转给人工。";

const DEFAULT_ERROR_REPLY =
  "抱歉，我这边暂时出了点问题，请稍后再发一次。如果一直失败，我会转交人工同事跟进。";

const MAX_INBOUND_LENGTH = 4_000;

/**
 * One conversation at a time per contact. Without this a customer sending three
 * quick messages would start three agent runs that each see a partial history
 * and answer over each other.
 */
const activeContacts = new Set<number>();

export type InboundResult =
  | { status: "ignored"; reason: string }
  | { status: "greeted" }
  | { status: "stored" }
  | { status: "answered"; runId: string }
  | { status: "failed"; error: string };

export async function handleInboundChannelMessage(
  channel: WorkspaceChannel,
  message: InboundChannelMessage
): Promise<InboundResult> {
  const adapter = getChannelAdapter(channel.provider);
  if (!adapter) return { status: "ignored", reason: "unsupported_provider" };
  if (channel.status === "disabled") {
    return { status: "ignored", reason: "channel_disabled" };
  }

  const workspace = await db.getWorkspaceById(channel.workspaceId);
  if (!workspace) return { status: "ignored", reason: "workspace_missing" };

  const contact = await db.upsertChannelContact({
    workspaceId: channel.workspaceId,
    channelId: channel.id,
    provider: channel.provider,
    externalId: message.externalUserId,
    externalChatId: message.externalChatId,
    displayName: message.displayName,
    username: message.username,
    locale: message.locale,
  });

  await db.updateWorkspaceChannel(channel.id, {
    lastEventAt: new Date(),
    lastError: null,
    ...(channel.status === "connected" ? {} : { status: "connected" as const }),
  });

  const scope: ConversationScope = {
    workspaceId: workspace.id,
    ownerUserId: workspace.ownerUserId,
    contactId: contact.id,
    channelId: channel.id,
  };

  if (message.command === "/start") {
    const greeting = workspace.greeting?.trim() || DEFAULT_GREETING;
    await db.saveChatMessage({
      workspaceId: workspace.id,
      userId: workspace.ownerUserId,
      contactId: contact.id,
      channelId: channel.id,
      role: "assistant",
      content: greeting,
    });
    await adapter.sendMessage(channel, message.externalChatId, greeting);
    return { status: "greeted" };
  }

  const text = message.text.slice(0, MAX_INBOUND_LENGTH);

  // Collection-only mode: record what the customer said, answer nothing.
  if (!channel.autoReply) {
    await db.saveChatMessage({
      workspaceId: workspace.id,
      userId: workspace.ownerUserId,
      contactId: contact.id,
      channelId: channel.id,
      role: "user",
      content: text,
    });
    return { status: "stored" };
  }

  if (activeContacts.has(contact.id)) {
    return { status: "ignored", reason: "contact_busy" };
  }
  activeContacts.add(contact.id);

  try {
    await adapter.indicateTyping?.(channel, message.externalChatId);
    const response = await createAgentChatResponse({ scope, content: text });
    await adapter.sendMessage(
      channel,
      message.externalChatId,
      response.assistantMessage
    );
    return { status: "answered", runId: response.runId };
  } catch (error) {
    const reply =
      error instanceof TokenQuotaExceededError
        ? "今天的对话额度已经用完了，请稍后再试，或直接留言等待人工回复。"
        : workspace.fallbackReply?.trim() || DEFAULT_ERROR_REPLY;

    logWarn("[Channel] Failed to answer inbound message", {
      provider: channel.provider,
      channelId: channel.id,
      error,
    });
    await db
      .updateWorkspaceChannel(channel.id, {
        lastError: error instanceof Error ? error.message : "回复失败",
      })
      .catch(() => undefined);
    await adapter
      .sendMessage(channel, message.externalChatId, reply)
      .catch(() => undefined);
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "回复失败",
    };
  } finally {
    activeContacts.delete(contact.id);
  }
}
