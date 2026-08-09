import { ENV } from "./_core/env";
import {
  buildAgentModelOption,
  isSelectableChatModel,
  sortAgentModelOptions,
  type AgentModelOption,
} from "../shared/agentModels";

/**
 * What a workspace may pick. The list comes from the endpoint the deployment is
 * actually pointed at, so a key that cannot reach a model never sees it offered.
 */

const CACHE_TTL_MS = 10 * 60 * 1_000;
const LIST_TIMEOUT_MS = 5_000;

type CatalogCache = {
  expiresAt: number;
  options: AgentModelOption[];
};

let cache: CatalogCache | null = null;
let inFlight: Promise<AgentModelOption[]> | null = null;

export const clearAgentModelCatalogCache = () => {
  cache = null;
  inFlight = null;
};

const contextWindowFor = (id: string) =>
  ENV.openAiModelContextWindows[id] ??
  (id === ENV.openAiModel ? ENV.openAiContextWindowTokens || null : null);

const toOptions = (ids: string[]): AgentModelOption[] => {
  const unique = new Set(ids.filter(Boolean));
  // The deployment default is always offered, even if the endpoint omits it —
  // otherwise a listing hiccup would empty the picker.
  if (ENV.openAiModel) unique.add(ENV.openAiModel);

  return sortAgentModelOptions(
    Array.from(unique).map(id =>
      buildAgentModelOption(id, {
        isDefault: id === ENV.openAiModel,
        contextWindowTokens: contextWindowFor(id),
      })
    )
  );
};

export const parseModelListResponse = (payload: unknown): string[] => {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map(entry => (entry as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .filter(isSelectableChatModel);
};

const fetchModelIds = async () => {
  const response = await fetch(
    `${ENV.openAiBaseUrl.replace(/\/$/, "")}/v1/models`,
    {
      headers: { authorization: `Bearer ${ENV.openAiApiKey}` },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(`Model listing failed with HTTP ${response.status}`);
  }
  return parseModelListResponse(await response.json());
};

/**
 * Never throws: a picker that shows only the current model is a far better
 * failure than a settings page that will not load.
 */
export const listSelectableModels = async (): Promise<AgentModelOption[]> => {
  if (ENV.openAiModels.length > 0) return toOptions(ENV.openAiModels);
  if (!ENV.openAiApiKey) return toOptions([]);

  if (cache && cache.expiresAt > Date.now()) return cache.options;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const options = toOptions(await fetchModelIds());
      cache = { expiresAt: Date.now() + CACHE_TTL_MS, options };
      return options;
    } catch (error) {
      console.error("[Agent] Failed to list models", error);
      return cache?.options ?? toOptions([]);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};

export const isSelectableModelId = async (id: string) =>
  (await listSelectableModels()).some(option => option.id === id);

/**
 * The hot path: called for every run, so it stays synchronous and never lists.
 * A stored id that later disappears from the endpoint simply fails at the model
 * call, which surfaces as a normal run error rather than a silent downgrade.
 */
export const resolveWorkspaceModel = (agentModel?: string | null) => {
  const model = agentModel?.trim() || ENV.openAiModel;
  return {
    model,
    contextWindowTokens:
      ENV.openAiModelContextWindows[model] ?? ENV.openAiContextWindowTokens,
  };
};
