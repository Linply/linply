import type { WorkspaceChannel } from "../../drizzle/schema";
import type { ChannelProvider } from "../db";

/**
 * Catalog shown on the 渠道接入 page. Telegram is implemented end to end because
 * it needs nothing but a bot token — no OAuth app, no review, no public
 * callback during setup. Slack and Feishu keep their entries so the page states
 * plainly what is and is not available yet.
 */
export type ChannelProviderInfo = {
  provider: ChannelProvider;
  name: string;
  tagline: string;
  /** Implemented and connectable today. */
  available: boolean;
  setupMinutes: number;
  docsUrl?: string;
};

export const CHANNEL_PROVIDERS: ChannelProviderInfo[] = [
  {
    provider: "web",
    name: "分享链接",
    tagline: "生成一个免登录的对话页面，发给客户就能用",
    available: true,
    setupMinutes: 0,
  },
  {
    provider: "telegram",
    name: "Telegram",
    tagline: "在 BotFather 里创建机器人，粘贴 Token 即可接入",
    available: true,
    setupMinutes: 3,
    docsUrl: "https://core.telegram.org/bots/features#botfather",
  },
  {
    provider: "slack",
    name: "Slack",
    tagline: "需要创建 Slack App 并配置 OAuth，规划中",
    available: false,
    setupMinutes: 15,
  },
  {
    provider: "feishu",
    name: "飞书",
    tagline: "需要在开放平台创建企业自建应用，规划中",
    available: false,
    setupMinutes: 20,
  },
];

export type InboundChannelMessage = {
  externalUserId: string;
  externalChatId: string;
  text: string;
  displayName?: string | null;
  username?: string | null;
  locale?: string | null;
  /** True for slash commands like Telegram's `/start`. */
  isCommand?: boolean;
  command?: string | null;
};

export type ChannelAdapter = {
  provider: ChannelProvider;
  /** Validates credentials and returns the identity to show in the UI. */
  verify(credentials: Record<string, string>): Promise<{
    externalId: string;
    displayName: string;
    /** Deep link a workspace owner can share with their customers. */
    inviteUrl?: string;
  }>;
  /** Points the provider at this deployment, or falls back to polling. */
  activate(channel: WorkspaceChannel): Promise<{ deliveryMode: string }>;
  deactivate(channel: WorkspaceChannel): Promise<void>;
  sendMessage(
    channel: WorkspaceChannel,
    chatId: string,
    text: string
  ): Promise<void>;
  /** Optional "typing…" hint while the agent is working. */
  indicateTyping?(
    channel: WorkspaceChannel,
    chatId: string
  ): Promise<void>;
};

/** Strips secrets before a channel row is handed to the client. */
export const toChannelDto = (channel: WorkspaceChannel) => ({
  id: channel.id,
  provider: channel.provider,
  status: channel.status,
  displayName: channel.displayName,
  externalId: channel.externalId,
  deliveryMode: channel.deliveryMode,
  autoReply: channel.autoReply,
  lastEventAt: channel.lastEventAt,
  lastError: channel.lastError,
  createdAt: channel.createdAt,
  updatedAt: channel.updatedAt,
});

export type ChannelDto = ReturnType<typeof toChannelDto>;
