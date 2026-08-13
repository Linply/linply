import { z } from "zod";

/**
 * The agent's configuration, shaped after pi's `settings.json`
 * (https://pi.dev/docs/latest/settings): one typed document, split into
 * sections, resolved by deep-merging layers rather than by reading a scattered
 * set of environment variables at each call site.
 *
 * Three layers, lowest priority first:
 *
 *   built-in defaults  →  deployment (env)  →  workspace (db)
 *
 * The layer split is the point. A deployment pins what its gateway can serve;
 * a workspace owner tunes what their own customers experience; neither can
 * silently widen what the deployment allows, because every merge runs back
 * through the same schema and its bounds.
 */

export const AGENT_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];

/**
 * Only formats every vision-capable endpoint we target accepts. SVG is absent
 * on purpose: it is a script-bearing document, not an image, and models that
 * rasterise it do so inconsistently.
 */
export const DEFAULT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/**
 * Documents never reach the model as bytes — pi's user messages carry text and
 * images only — so these are the formats we can turn into text ourselves.
 */
export const DEFAULT_FILE_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

const thinkingLevel = z.enum(AGENT_THINKING_LEVELS);

const thinkingBudgets = z.object({
  minimal: z.number().int().positive().optional(),
  low: z.number().int().positive().optional(),
  medium: z.number().int().positive().optional(),
  high: z.number().int().positive().optional(),
  xhigh: z.number().int().positive().optional(),
  max: z.number().int().positive().optional(),
});

const retrySettings = z.object({
  enabled: z.boolean(),
  maxRetries: z.number().int().min(0).max(10),
  baseDelayMs: z.number().int().min(0).max(60_000),
  provider: z.object({
    timeoutMs: z.number().int().min(1_000).max(3_600_000),
    maxRetries: z.number().int().min(0).max(10),
    maxRetryDelayMs: z.number().int().min(0).max(600_000),
  }),
});

/**
 * pi compacts a long session in place. We run one session per inbound message
 * and rebuild context from stored history, so `keepRecentTokens` bounds how
 * much of that history we replay rather than when a summary is taken.
 */
const compactionSettings = z.object({
  enabled: z.boolean(),
  reserveTokens: z.number().int().min(0).max(1_000_000),
  keepRecentTokens: z.number().int().min(0).max(1_000_000),
});

const imageSettings = z.object({
  /** pi's own kill switch: no image ever reaches the model while this is on. */
  blockImages: z.boolean(),
  autoResize: z.boolean(),
  /** pi resizes to 2000x2000 by default; the longest edge is what we bound. */
  maxDimension: z.number().int().min(64).max(8_192),
  maxBytes: z
    .number()
    .int()
    .min(1_024)
    .max(50 * 1024 * 1024),
  maxPerMessage: z.number().int().min(0).max(20),
  allowedMimeTypes: z.array(z.string().min(1)).min(1),
});

const fileSettings = z.object({
  blockFiles: z.boolean(),
  maxBytes: z
    .number()
    .int()
    .min(1_024)
    .max(100 * 1024 * 1024),
  maxPerMessage: z.number().int().min(0).max(20),
  allowedMimeTypes: z.array(z.string().min(1)).min(1),
  /** Extracted text is untrusted input, so a runaway PDF cannot flood context. */
  maxExtractedChars: z.number().int().min(0).max(200_000),
});

export const AiSettingsSchema = z.object({
  defaultProvider: z.string().min(1),
  defaultModel: z.string().min(1),
  defaultThinkingLevel: thinkingLevel,
  thinkingBudgets,
  /** How many tool round-trips one customer message may cost. */
  maxTurns: z.number().int().min(1).max(20),
  retry: retrySettings,
  compaction: compactionSettings,
  images: imageSettings,
  files: fileSettings,
});

export type AiSettings = z.infer<typeof AiSettingsSchema>;

/** Every layer above the defaults is partial, and nested sections merge. */
export type AiSettingsOverrides = {
  [K in keyof AiSettings]?: AiSettings[K] extends Record<string, unknown>
    ? Partial<AiSettings[K]>
    : AiSettings[K];
};

export const AiSettingsOverridesSchema = AiSettingsSchema.partial().extend({
  thinkingBudgets: thinkingBudgets.optional(),
  retry: retrySettings
    .partial()
    .extend({ provider: retrySettings.shape.provider.partial().optional() })
    .optional(),
  compaction: compactionSettings.partial().optional(),
  images: imageSettings.partial().optional(),
  files: fileSettings.partial().optional(),
});

export const DEFAULT_AI_SETTINGS: AiSettings = {
  defaultProvider: "linply",
  defaultModel: "gpt-5.5",
  defaultThinkingLevel: "off",
  thinkingBudgets: {},
  maxTurns: 6,
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2_000,
    provider: {
      timeoutMs: 120_000,
      maxRetries: 0,
      maxRetryDelayMs: 60_000,
    },
  },
  compaction: {
    enabled: true,
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
  },
  images: {
    blockImages: false,
    autoResize: true,
    maxDimension: 2_000,
    maxBytes: 10 * 1024 * 1024,
    maxPerMessage: 4,
    allowedMimeTypes: [...DEFAULT_IMAGE_MIME_TYPES],
  },
  files: {
    blockFiles: false,
    maxBytes: 20 * 1024 * 1024,
    maxPerMessage: 2,
    allowedMimeTypes: [...DEFAULT_FILE_MIME_TYPES],
    maxExtractedChars: 20_000,
  },
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * pi's merge rule: a child object replaces only the keys it names and leaves
 * its siblings alone, while arrays and scalars replace wholesale. An
 * `allowedMimeTypes` override is a decision about the whole list, not an
 * addition to it.
 */
export const mergeAiSettings = <T>(base: T, overrides: unknown): T => {
  if (!isPlainObject(overrides)) return base;
  if (!isPlainObject(base)) return overrides as T;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    merged[key] = isPlainObject(value)
      ? mergeAiSettings((base as Record<string, unknown>)[key], value)
      : value;
  }
  return merged as T;
};

/**
 * Applies layers in order and validates the result once. An override that
 * would produce an out-of-bounds document is dropped as a whole layer rather
 * than silently clamped, because a half-applied settings change is harder to
 * explain than one that visibly did not take.
 */
export const resolveAiSettings = (
  ...layers: Array<AiSettingsOverrides | null | undefined>
): { settings: AiSettings; rejected: string[] } => {
  let settings = DEFAULT_AI_SETTINGS;
  const rejected: string[] = [];

  layers.forEach((layer, index) => {
    if (!layer) return;
    const candidate = mergeAiSettings(settings, layer);
    const parsed = AiSettingsSchema.safeParse(candidate);
    if (parsed.success) {
      settings = parsed.data;
      return;
    }
    rejected.push(
      `layer ${index}: ${parsed.error.issues
        .map(issue => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`
    );
  });

  return { settings, rejected };
};

/** What the workspace settings form may send; unknown keys are ignored. */
export const parseWorkspaceAiSettings = (
  value: unknown
): AiSettingsOverrides | null => {
  if (value === null || value === undefined) return null;
  const source = typeof value === "string" ? safeJsonParse(value) : value;
  const parsed = AiSettingsOverridesSchema.safeParse(source);
  return parsed.success ? (parsed.data as AiSettingsOverrides) : null;
};

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
