import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";
import {
  getAgentModelLabel,
  getAgentModelTier,
  isSelectableChatModel,
  sortAgentModelOptions,
  buildAgentModelOption,
} from "../shared/agentModels";
import {
  clearAgentModelCatalogCache,
  listSelectableModels,
  parseModelListResponse,
  resolveWorkspaceModel,
} from "./agentModelCatalog";

/** Awaits the callback before restoring, so async work still sees the patch. */
const withEnv = async <T>(
  patch: Partial<typeof ENV>,
  run: () => T | Promise<T>
): Promise<T> => {
  const original = Object.fromEntries(
    Object.keys(patch).map(key => [key, (ENV as any)[key]])
  );
  Object.assign(ENV, patch);
  try {
    return await run();
  } finally {
    Object.assign(ENV, original);
  }
};

afterEach(() => {
  clearAgentModelCatalogCache();
  vi.restoreAllMocks();
});

describe("model id heuristics", () => {
  it("keeps chat models and drops everything else the endpoint lists", () => {
    expect(isSelectableChatModel("gpt-5.5")).toBe(true);
    expect(isSelectableChatModel("gpt-4.1-mini")).toBe(true);
    expect(isSelectableChatModel("o3")).toBe(true);

    expect(isSelectableChatModel("text-embedding-3-small")).toBe(false);
    expect(isSelectableChatModel("gpt-4o-realtime-preview")).toBe(false);
    expect(isSelectableChatModel("gpt-4o-audio-preview")).toBe(false);
    expect(isSelectableChatModel("gpt-3.5-turbo-instruct")).toBe(false);
    expect(isSelectableChatModel("dall-e-3")).toBe(false);
    expect(isSelectableChatModel("whisper-1")).toBe(false);
  });

  it("renders an id nobody has seen before as a readable name", () => {
    expect(getAgentModelLabel("gpt-5.5")).toBe("GPT-5.5");
    expect(getAgentModelLabel("gpt-4.1-mini")).toBe("GPT-4.1 mini");
    expect(getAgentModelLabel("o3")).toBe("O3");
    expect(getAgentModelLabel("gpt-9-quantum-preview")).toBe(
      "GPT-9 quantum preview"
    );
  });

  it("sorts a model into a tier so the picker can explain the trade-off", () => {
    expect(getAgentModelTier("gpt-5.5")).toBe("flagship");
    expect(getAgentModelTier("gpt-4.1-mini")).toBe("balanced");
    expect(getAgentModelTier("gpt-4.1-nano")).toBe("fast");
    expect(getAgentModelTier("o3")).toBe("reasoning");
  });

  it("puts the deployment default first and keeps the rest stable", () => {
    const sorted = sortAgentModelOptions([
      buildAgentModelOption("gpt-4.1"),
      buildAgentModelOption("gpt-5.5", { isDefault: true }),
      buildAgentModelOption("gpt-4.1-mini"),
    ]);

    expect(sorted.map(option => option.id)).toEqual([
      "gpt-5.5",
      "gpt-4.1",
      "gpt-4.1-mini",
    ]);
  });
});

describe("listing what the endpoint serves", () => {
  it("keeps only chat model ids out of a /v1/models payload", () => {
    expect(
      parseModelListResponse({
        object: "list",
        data: [
          { id: "gpt-5.5" },
          { id: "text-embedding-3-small" },
          { id: "gpt-4.1-mini" },
          { id: 42 },
          {},
        ],
      })
    ).toEqual(["gpt-5.5", "gpt-4.1-mini"]);
  });

  it("tolerates a payload that is not a listing at all", () => {
    expect(parseModelListResponse(null)).toEqual([]);
    expect(parseModelListResponse({ error: "nope" })).toEqual([]);
  });

  it("pins the list from the environment without calling the endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const models = await withEnv(
      {
        openAiModels: ["gpt-4.1", "gpt-4.1-mini"],
        openAiModel: "gpt-5.5",
        openAiApiKey: "sk-test",
      },
      () => listSelectableModels()
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(models.map(option => option.id)).toEqual([
      "gpt-5.5",
      "gpt-4.1",
      "gpt-4.1-mini",
    ]);
    expect(models[0]?.isDefault).toBe(true);
  });

  it("offers only the configured model when there is no key to ask with", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const models = await withEnv(
      { openAiModels: [], openAiApiKey: "", openAiModel: "gpt-5.5" },
      () => listSelectableModels()
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(models.map(option => option.id)).toEqual(["gpt-5.5"]);
  });

  it("falls back to the configured model when the endpoint refuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 401 })
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const models = await withEnv(
      { openAiModels: [], openAiApiKey: "sk-test", openAiModel: "gpt-5.5" },
      () => listSelectableModels()
    );

    expect(models.map(option => option.id)).toEqual(["gpt-5.5"]);
  });

  it("asks the endpoint once and serves the rest from cache", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ data: [{ id: "gpt-4.1" }, { id: "whisper-1" }] })
      );

    const models = await withEnv(
      { openAiModels: [], openAiApiKey: "sk-test", openAiModel: "gpt-5.5" },
      async () => {
        await listSelectableModels();
        return listSelectableModels();
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(models.map(option => option.id)).toEqual(["gpt-5.5", "gpt-4.1"]);
  });
});

describe("resolving the model for a run", () => {
  it("uses the workspace choice and its declared context window", async () => {
    const resolved = await withEnv(
      {
        openAiModel: "gpt-5.5",
        openAiContextWindowTokens: 272_000,
        openAiModelContextWindows: { "gpt-4.1": 1_047_576 },
      },
      () => resolveWorkspaceModel("gpt-4.1")
    );

    expect(resolved.model).toBe("gpt-4.1");
    expect(resolved.contextWindowTokens).toBe(1_047_576);
  });

  it("falls back to the deployment default when nothing is chosen", async () => {
    const resolved = await withEnv(
      { openAiModel: "gpt-5.5", openAiContextWindowTokens: 272_000 },
      () => resolveWorkspaceModel(null)
    );

    expect(resolved.model).toBe("gpt-5.5");
    expect(resolved.contextWindowTokens).toBe(272_000);
  });

  it("treats a blank stored value as unset", async () => {
    const resolved = await withEnv({ openAiModel: "gpt-5.5" }, () =>
      resolveWorkspaceModel("   ")
    );

    expect(resolved.model).toBe("gpt-5.5");
  });
});
