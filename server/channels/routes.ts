import type { Express, Request, Response } from "express";
import { logWarn } from "../_core/observability";
import * as db from "../db";
import { handleInboundChannelMessage } from "./inbound";
import { parseTelegramUpdate, type TelegramUpdate } from "./telegram";

/**
 * Telegram retries any update it does not get a 200 for, so the handler acks
 * first and processes afterwards. A slow agent run must never turn into a
 * duplicate delivery.
 */
export function registerChannelRoutes(app: Express) {
  app.post(
    "/api/channels/telegram/:secret",
    async (req: Request, res: Response) => {
      const secret = req.params.secret;
      const headerSecret = req.get("x-telegram-bot-api-secret-token");

      const channel = await db
        .getChannelByWebhookSecret(secret)
        .catch(() => null);

      // Constant response for every rejection so probing cannot enumerate
      // which secrets exist.
      if (
        !channel ||
        channel.provider !== "telegram" ||
        headerSecret !== channel.webhookSecret
      ) {
        res.status(401).json({ ok: false });
        return;
      }

      res.status(200).json({ ok: true });

      const update = req.body as TelegramUpdate | undefined;
      if (!update) return;
      const message = parseTelegramUpdate(update);
      if (!message) return;

      void handleInboundChannelMessage(channel, message).catch(error => {
        logWarn("[Telegram] Webhook processing failed", {
          channelId: channel.id,
          error,
        });
      });
    }
  );
}
