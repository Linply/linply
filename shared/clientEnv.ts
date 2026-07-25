/**
 * Runtime configuration the server hands to the browser.
 *
 * This type is an explicit allowlist: a value reaches the client only if
 * someone types its field name here AND wires it up in
 * `server/_core/clientEnv.ts`. There is no prefix convention and no wildcard,
 * so no server secret can leak by accident.
 *
 * Never add anything that is not safe to publish — the object is inlined into
 * the HTML document and is readable by anyone.
 */
export type ClientEnv = {
  posthogKey?: string;
  posthogHost?: string;
};

declare global {
  interface Window {
    __ENV__?: ClientEnv;
  }
}
