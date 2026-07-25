import posthog from "posthog-js";
import type { ClientEnv } from "@shared/clientEnv";

const env: ClientEnv =
  (typeof window !== "undefined" && window.__ENV__) || {};

let enabled = false;

/**
 * Initializes PostHog for web analytics and session replay. The project token
 * comes from `window.__ENV__`, which the server inlines into the document at
 * request time, so changing it needs a restart rather than a rebuild.
 *
 * Stays a no-op when POSTHOG_KEY is unset on the server. Pageviews, autocapture,
 * and session recording all come from the `defaults` preset — there are no
 * custom capture calls anywhere else in the codebase.
 */
export function initAnalytics() {
  if (enabled || !env.posthogKey) return;

  posthog.init(env.posthogKey, {
    api_host: env.posthogHost || "https://us.i.posthog.com",
    defaults: "2026-05-30",
  });
  enabled = true;
}

/** Attaches a person to the current session so replays are attributable. */
export function identifyUser(
  userId: number | string,
  properties?: Record<string, unknown>
) {
  if (!enabled) return;
  posthog.identify(String(userId), properties);
}

export function resetAnalytics() {
  if (!enabled) return;
  posthog.reset();
}
