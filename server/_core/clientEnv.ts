import type { ClientEnv } from "@shared/clientEnv";

/**
 * Builds the runtime config sent to the browser. Adding a field here also
 * requires adding it to `ClientEnv` — see that type for the allowlist rules.
 */
export function getClientEnv(): ClientEnv {
  const env: ClientEnv = {
    posthogKey: process.env.POSTHOG_KEY,
    posthogHost: process.env.POSTHOG_HOST,
  };

  // Drop unset keys so the client can rely on plain falsy checks.
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => Boolean(value))
  ) as ClientEnv;
}

/**
 * Inlines the client env into the document head. `<` is escaped so a value can
 * never break out of the script tag.
 */
export function injectClientEnv(html: string) {
  const serialized = JSON.stringify(getClientEnv()).replace(/</g, "\\u003c");
  return html.replace(
    "</head>",
    `  <script>window.__ENV__=${serialized};</script>\n  </head>`
  );
}
