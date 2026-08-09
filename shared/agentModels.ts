/**
 * The model picker is built from whatever the configured endpoint actually
 * serves, not from a list baked into this repo — a hardcoded catalog goes stale
 * and lies about what a given key can use. Everything here is therefore derived
 * from the model id itself, so an id nobody has seen before still renders.
 */

/** Drives the one-line "when would I pick this" hint under each option. */
export type AgentModelTier = "flagship" | "balanced" | "fast" | "reasoning";

export type AgentModelOption = {
  id: string;
  label: string;
  tier: AgentModelTier;
  /** Unknown until the deployment declares it; the UI then hides the figure. */
  contextWindowTokens: number | null;
  /** The deployment default, shown first and used when nothing is chosen. */
  isDefault: boolean;
};

const CHAT_MODEL_PATTERN = /^(gpt-\d|o\d)/i;

/**
 * Endpoints list every model the key can touch, most of which are not chat
 * models. Excluding by capability keeps new chat releases visible while
 * embeddings, audio and image models stay out.
 */
const NON_CHAT_PATTERN =
  /(embedding|whisper|tts|audio|realtime|image|dall-e|moderation|transcribe|search|codex|instruct|davinci|babbage)/i;

export const isSelectableChatModel = (id: string) =>
  CHAT_MODEL_PATTERN.test(id) && !NON_CHAT_PATTERN.test(id);

export const getAgentModelTier = (id: string): AgentModelTier => {
  const normalized = id.toLowerCase();
  if (/nano/.test(normalized)) return "fast";
  if (/mini|flash|turbo/.test(normalized)) return "balanced";
  if (/^o\d/.test(normalized) || /thinking|reason/.test(normalized)) {
    return "reasoning";
  }
  return "flagship";
};

/** Dated snapshots like `gpt-5.4-2026-03-05` keep the date as one unit. */
const SNAPSHOT_DATE_PATTERN = /-(\d{4}-\d{2}-\d{2})$/;

/**
 * `gpt-4.1-mini` reads as "GPT-4.1 mini", `gpt-5.4-2026-03-05` as
 * "GPT-5.4 (2026-03-05)". Only the vendor prefix is upper-cased — the rest is
 * left alone so an unfamiliar suffix survives intact.
 */
export const getAgentModelLabel = (id: string) => {
  const snapshot = id.match(SNAPSHOT_DATE_PATTERN)?.[1];
  const base = snapshot ? id.replace(SNAPSHOT_DATE_PATTERN, "") : id;
  const withSnapshot = (label: string) =>
    snapshot ? `${label} (${snapshot})` : label;

  const [head, ...rest] = base.split("-");
  const family = /^(gpt|o)\d*/i.test(head ?? "")
    ? (head ?? "").toUpperCase()
    : (head ?? base);
  if (rest.length === 0) return withSnapshot(family);

  // The version travels with the family name: GPT-4.1, not GPT 4.1.
  const [version, ...suffix] = rest;
  const versioned = /^[\d.]+$/.test(version ?? "")
    ? `${family}-${version}`
    : `${family} ${version}`;
  return withSnapshot(
    suffix.length > 0 ? `${versioned} ${suffix.join(" ")}` : versioned
  );
};

export const buildAgentModelOption = (
  id: string,
  input: { isDefault?: boolean; contextWindowTokens?: number | null } = {}
): AgentModelOption => ({
  id,
  label: getAgentModelLabel(id),
  tier: getAgentModelTier(id),
  contextWindowTokens: input.contextWindowTokens ?? null,
  isDefault: input.isDefault ?? false,
});

/** The default sorts first; the rest stay alphabetical so the list is stable. */
export const sortAgentModelOptions = (options: AgentModelOption[]) =>
  [...options].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
