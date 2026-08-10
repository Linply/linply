import type { ChannelProvider } from "../db";
import { telegramAdapter } from "./telegram";
import type { ChannelAdapter } from "./types";

const ADAPTERS: Partial<Record<ChannelProvider, ChannelAdapter>> = {
  telegram: telegramAdapter,
};

export const getChannelAdapter = (provider: ChannelProvider) =>
  ADAPTERS[provider] ?? null;
