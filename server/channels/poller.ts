import { logWarn } from "../_core/observability";
import * as db from "../db";
import { handleInboundChannelMessage } from "./inbound";
import {
  fetchTelegramUpdates,
  parseTelegramUpdate,
  setTelegramPollOffset,
} from "./telegram";

/**
 * Telegram delivers over webhooks in production. Local development has no
 * public HTTPS origin, so channels activated there are marked `polling` and
 * this loop drains getUpdates instead. It is a development convenience, not a
 * second production path: one interval covers every polling channel.
 */

const POLL_INTERVAL_MS = 2_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function pollTelegramChannels() {
  const channels = await db.listChannelsByProvider("telegram", "connected");
  const polling = channels.filter(
    channel => channel.deliveryMode === "polling"
  );
  if (polling.length === 0) return;

  for (const channel of polling) {
    try {
      const updates = await fetchTelegramUpdates(channel);
      if (updates.length === 0) continue;

      for (const update of updates) {
        // Advance the cursor before handling so a failing message cannot wedge
        // the loop into replaying it forever.
        await setTelegramPollOffset(channel.id, update.update_id);
        const message = parseTelegramUpdate(update);
        if (!message) continue;
        await handleInboundChannelMessage(channel, message);
      }
    } catch (error) {
      logWarn("[Telegram] Polling cycle failed", {
        channelId: channel.id,
        error,
      });
      await db
        .updateWorkspaceChannel(channel.id, {
          lastError: error instanceof Error ? error.message : "轮询失败",
        })
        .catch(() => undefined);
    }
  }
}

export function startChannelPoller() {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void pollTelegramChannels()
      .catch(error => {
        logWarn("[Channel] Poller iteration failed", { error });
      })
      .finally(() => {
        running = false;
      });
  }, POLL_INTERVAL_MS);
  timer.unref();
}

export function stopChannelPoller() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
