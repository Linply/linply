import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { AiSettings } from "../../shared/aiSettings";
import { ENV } from "../_core/env";
import { AGENT_PROVIDER_ID } from "./settings";

/**
 * pi resolves models and credentials through a `ModelRuntime`. Its defaults are
 * built for a developer's laptop: `~/.pi/agent/auth.json`, `models.json`, and
 * whatever provider keys happen to be in the environment. A server must not
 * inherit any of that, so the runtime here is pinned to a throwaway directory
 * and given exactly one provider — the deployment's own gateway.
 */

export type AgentModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

/**
 * pi discovers models from the provider catalog; our gateway is an
 * OpenAI-compatible proxy whose model list comes from configuration. Anything
 * the deployment names is registered, which is also what makes it selectable.
 */
/**
 * Registering a provider replaces its whole model list, so the ids accumulate
 * here. Without this, two workspaces on different models would take turns
 * evicting each other from the catalog every time one of them ran.
 */
const registeredModelIds = new Set<string>();

const buildModelConfigs = (settings: AiSettings) => {
  for (const id of ENV.openAiModels) registeredModelIds.add(id);
  registeredModelIds.add(settings.defaultModel);
  if (ENV.openAiModel) registeredModelIds.add(ENV.openAiModel);

  return Array.from(registeredModelIds)
    .filter(Boolean)
    .map(id => ({
      id,
      name: id,
      /**
       * Thinking is driven by settings rather than probed: an OpenAI-compatible
       * gateway will accept a reasoning request for a model that ignores it,
       * and a wrong guess here silently changes every reply.
       */
      reasoning: settings.defaultThinkingLevel !== "off",
      /**
       * The whole point of the refactor. A gateway that fronts vision models
       * accepts image parts; one that does not rejects the request outright,
       * which is a far better failure than silently dropping the screenshot a
       * customer just sent.
       */
      input: ["text", "image"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow:
        ENV.openAiModelContextWindows[id] ??
        ENV.openAiContextWindowTokens ??
        272_000,
      maxTokens: 16_384,
    }));
};

let runtimePromise: Promise<ModelRuntime> | null = null;

/**
 * One runtime per process. Creating it touches the filesystem once, and every
 * run afterwards only reads the resolved catalog.
 */
export const getModelRuntime = async (
  settings: AiSettings
): Promise<ModelRuntime> => {
  runtimePromise ??= createModelRuntime(settings);
  return runtimePromise;
};

const createModelRuntime = async (settings: AiSettings) => {
  if (!ENV.openAiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for the customer service Agent"
    );
  }

  // A private directory, so pi never reads or writes the operator's own pi
  // credentials, and nothing it persists outlives the process.
  const isolatedDir = mkdtempSync(join(tmpdir(), "linply-agent-"));
  const runtime = await ModelRuntime.create({
    authPath: join(isolatedDir, "auth.json"),
    modelsPath: join(isolatedDir, "models.json"),
  });

  runtime.registerProvider(AGENT_PROVIDER_ID, {
    name: "Linply Gateway",
    baseUrl: resolveGatewayBaseUrl(),
    apiKey: ENV.openAiApiKey,
    api: "openai-completions",
    models: buildModelConfigs(settings),
  });

  return runtime;
};

/**
 * pi appends the API path to `baseUrl`, so it wants the `/v1` root while
 * `OPENAI_BASE_URL` is conventionally the host. A proxy that already ends in
 * `/v1` keeps it, rather than being sent to `/v1/v1`.
 */
export const resolveGatewayBaseUrl = (baseUrl = ENV.openAiBaseUrl) => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

/**
 * Registers a model the catalog has not seen yet. A workspace can hold a model
 * id that was added to the gateway after this process started; re-registering
 * the provider is cheaper than restarting, and pi keeps the newest definition.
 */
export const resolveAgentModel = async (
  settings: AiSettings
): Promise<AgentModel> => {
  const runtime = await getModelRuntime(settings);
  const existing = runtime.getModel(AGENT_PROVIDER_ID, settings.defaultModel);
  if (existing) return existing;

  runtime.registerProvider(AGENT_PROVIDER_ID, {
    name: "Linply Gateway",
    baseUrl: resolveGatewayBaseUrl(),
    apiKey: ENV.openAiApiKey,
    api: "openai-completions",
    models: buildModelConfigs(settings),
  });

  const model = runtime.getModel(AGENT_PROVIDER_ID, settings.defaultModel);
  if (!model) {
    throw new Error(
      `模型 ${settings.defaultModel} 不可用，请检查 OPENAI_MODEL / 工作区模型设置。`
    );
  }
  return model;
};

/** Only for tests, which swap the environment between cases. */
export const clearModelRuntimeCache = () => {
  runtimePromise = null;
  registeredModelIds.clear();
};
