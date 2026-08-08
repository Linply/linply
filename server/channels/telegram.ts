import type { WorkspaceChannel } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { logWarn } from "../_core/observability";
import * as db from "../db";
import type { ChannelAdapter, InboundChannelMessage } from "./types";

const TELEGRAM_API = "https://api.telegram.org";
/** Telegram rejects messages over 4096 UTF-16 code units. */
const MAX_MESSAGE_LENGTH = 4_000;
const REQUEST_TIMEOUT_MS = 15_000;

export class TelegramApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
  }
}

const getToken = (channel: WorkspaceChannel) => {
  const token = channel.credentials?.botToken;
  if (!token) throw new TelegramApiError("Telegram Bot Token 缺失", 400);
  return token;
};

async function callTelegram<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;

    if (!response.ok || !payload?.ok) {
      throw new TelegramApiError(
        payload?.description || `Telegram ${method} 调用失败`,
        response.status
      );
    }
    return payload.result as T;
  } catch (error) {
    if (error instanceof TelegramApiError) throw error;
    if (controller.signal.aborted) {
      throw new TelegramApiError("Telegram 接口超时，请稍后重试", 504);
    }
    throw new TelegramApiError(
      error instanceof Error ? error.message : "Telegram 接口调用失败",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const isPublicWebhookUrl = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
};

export const buildTelegramWebhookUrl = (secret: string) =>
  `${ENV.appBaseUrl.replace(/\/+$/, "")}/api/channels/telegram/${secret}`;

/** Splits a long answer on paragraph boundaries so Telegram accepts each part. */
export const splitTelegramMessage = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_MESSAGE_LENGTH) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > MAX_MESSAGE_LENGTH) {
    const window = remaining.slice(0, MAX_MESSAGE_LENGTH);
    const breakAt = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf("。"),
      window.lastIndexOf(". ")
    );
    const cut = breakAt > MAX_MESSAGE_LENGTH * 0.5 ? breakAt : MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat?: { id: number; type?: string };
  text?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

/** Maps a raw Telegram update onto the provider-neutral inbound shape. */
export const parseTelegramUpdate = (
  update: TelegramUpdate
): InboundChannelMessage | null => {
  const message = update.message ?? update.edited_message;
  const text = message?.text?.trim();
  if (!message?.from || !message.chat || !text) return null;
  // Group chats would need mention handling and different consent rules.
  if (message.chat.type && message.chat.type !== "private") return null;
  if (message.from.is_bot) return null;

  const isCommand = message.entities?.some(
    entity => entity.type === "bot_command" && entity.offset === 0
  );
  const command = isCommand ? text.split(/\s+/)[0]?.split("@")[0] : null;

  return {
    externalUserId: String(message.from.id),
    externalChatId: String(message.chat.id),
    text,
    displayName:
      [message.from.first_name, message.from.last_name]
        .filter(Boolean)
        .join(" ") || null,
    username: message.from.username ?? null,
    locale: message.from.language_code ?? null,
    isCommand: Boolean(isCommand),
    command: command ?? null,
  };
};

export const telegramAdapter: ChannelAdapter = {
  provider: "telegram",

  async verify(credentials) {
    const token = credentials.botToken?.trim();
    if (!token) throw new TelegramApiError("请填写 Bot Token", 400);
    const me = await callTelegram<TelegramUser>(token, "getMe");
    if (!me.is_bot) {
      throw new TelegramApiError("该 Token 不属于 Telegram 机器人", 400);
    }
    return {
      externalId: String(me.id),
      displayName: me.username ? `@${me.username}` : me.first_name || "Telegram Bot",
      inviteUrl: me.username ? `https://t.me/${me.username}` : undefined,
    };
  },

  /**
   * Prefers webhooks. Without a public HTTPS origin (local development) it
   * removes any stale webhook and reports polling so the built-in poller runs.
   */
  async activate(channel) {
    const token = getToken(channel);

    if (!isPublicWebhookUrl(ENV.appBaseUrl)) {
      await callTelegram(token, "deleteWebhook", {
        drop_pending_updates: true,
      }).catch(() => undefined);
      return { deliveryMode: "polling" };
    }

    await callTelegram(token, "setWebhook", {
      url: buildTelegramWebhookUrl(channel.webhookSecret),
      secret_token: channel.webhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
    return { deliveryMode: "webhook" };
  },

  async deactivate(channel) {
    const token = channel.credentials?.botToken;
    if (!token) return;
    await callTelegram(token, "deleteWebhook", {
      drop_pending_updates: true,
    }).catch(error => {
      logWarn("[Telegram] Failed to remove webhook on disconnect", { error });
    });
  },

  async sendMessage(channel, chatId, text) {
    const token = getToken(channel);
    for (const chunk of splitTelegramMessage(text)) {
      await callTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: chunk,
        // Plain text: agent answers are not guaranteed to be valid Markdown and
        // a parse failure would drop the whole reply.
        disable_web_page_preview: true,
      });
    }
  },

  async indicateTyping(channel, chatId) {
    const token = getToken(channel);
    await callTelegram(token, "sendChatAction", {
      chat_id: chatId,
      action: "typing",
    }).catch(() => undefined);
  },
};

export async function fetchTelegramUpdates(channel: WorkspaceChannel) {
  const token = getToken(channel);
  return callTelegram<TelegramUpdate[]>(token, "getUpdates", {
    offset: channel.pollOffset > 0 ? channel.pollOffset : undefined,
    timeout: 0,
    limit: 20,
    allowed_updates: ["message"],
  });
}

export async function setTelegramPollOffset(
  channelId: number,
  updateId: number
) {
  await db.updateWorkspaceChannel(channelId, { pollOffset: updateId + 1 });
}
