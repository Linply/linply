import {
  type AiSettings,
  type AiSettingsOverrides,
  parseWorkspaceAiSettings,
  resolveAiSettings,
} from "../../shared/aiSettings";
import { ENV } from "../_core/env";
import * as db from "../db";

/**
 * Resolves the settings document for one workspace, in pi's layer order:
 * built-in defaults, then what the deployment pins, then what the workspace
 * owner chose. See `shared/aiSettings.ts` for the schema and merge rule.
 */

export const AGENT_PROVIDER_ID = "linply";

/**
 * Recorded on every run and message so an operator can tell which engine
 * produced a reply. Rows written before the pi refactor still say
 * `openai-agents`, which is the point of storing it.
 */
export const AGENT_LLM_PROVIDER = "pi";

/**
 * The deployment layer. Discrete variables cover what operators actually tune,
 * and `AGENT_SETTINGS` takes a whole settings document for anything else — the
 * same JSON shape a workspace override uses, so there is one format to learn.
 */
const buildDeploymentLayer = (): AiSettingsOverrides => {
  const discrete: AiSettingsOverrides = {
    defaultProvider: AGENT_PROVIDER_ID,
    ...(ENV.openAiModel ? { defaultModel: ENV.openAiModel } : {}),
  };

  const document = parseWorkspaceAiSettings(ENV.agentSettings);
  if (!document) {
    if (ENV.agentSettings) {
      console.error(
        "[Agent] AGENT_SETTINGS is not a valid settings document; deployment overrides ignored"
      );
    }
    return discrete;
  }

  return { ...discrete, ...document };
};

let deploymentLayer: AiSettingsOverrides | null = null;

const getDeploymentLayer = () => {
  deploymentLayer ??= buildDeploymentLayer();
  return deploymentLayer;
};

/** Only for tests, which mutate `ENV` between cases. */
export const clearAiSettingsCache = () => {
  deploymentLayer = null;
  workspaceCache.clear();
};

type CachedSettings = { expiresAt: number; settings: AiSettings };

const WORKSPACE_CACHE_TTL_MS = 30_000;
const workspaceCache = new Map<number, CachedSettings>();

export const resolveDeploymentAiSettings = (): AiSettings =>
  resolveAiSettings(getDeploymentLayer()).settings;

/**
 * The hot path: every run resolves settings before it can call the model, so
 * the workspace row is cached briefly. A settings change takes effect within
 * the TTL rather than instantly, which is the trade every run paying for a
 * round-trip would otherwise cost.
 */
export const resolveWorkspaceAiSettings = async (
  workspaceId: number
): Promise<AiSettings> => {
  const cached = workspaceCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;

  const workspace = await db.getWorkspaceById(workspaceId);
  const settings = buildWorkspaceSettings(workspace);
  workspaceCache.set(workspaceId, {
    expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS,
    settings,
  });
  return settings;
};

export const invalidateWorkspaceAiSettings = (workspaceId: number) => {
  workspaceCache.delete(workspaceId);
};

/**
 * `agentModel` predates the settings document and remains the model picker's
 * storage, so it is applied as the narrowest layer rather than migrated.
 */
export const buildWorkspaceSettings = (
  workspace:
    | { agentModel?: string | null; agentSettings?: unknown }
    | null
    | undefined
): AiSettings => {
  const stored = parseWorkspaceAiSettings(workspace?.agentSettings);
  const model = workspace?.agentModel?.trim();
  const { settings, rejected } = resolveAiSettings(
    getDeploymentLayer(),
    stored,
    model ? { defaultModel: model } : null
  );

  if (rejected.length > 0) {
    console.warn("[Agent] Ignored invalid settings layer", { rejected });
  }
  return settings;
};
