import { describe, expect, it } from "vitest";

import {
  DEFAULT_AI_SETTINGS,
  mergeAiSettings,
  parseWorkspaceAiSettings,
  resolveAiSettings,
} from "../shared/aiSettings";

describe("ai settings merge", () => {
  it("merges a nested section without dropping its siblings", () => {
    const merged = mergeAiSettings(DEFAULT_AI_SETTINGS, {
      images: { maxPerMessage: 1 },
    });

    expect(merged.images.maxPerMessage).toBe(1);
    // The rest of the images section survives, which is the whole point of a
    // per-key merge rather than a section replacement.
    expect(merged.images.maxDimension).toBe(
      DEFAULT_AI_SETTINGS.images.maxDimension
    );
    expect(merged.images.allowedMimeTypes).toEqual(
      DEFAULT_AI_SETTINGS.images.allowedMimeTypes
    );
  });

  it("replaces arrays wholesale instead of appending to them", () => {
    const merged = mergeAiSettings(DEFAULT_AI_SETTINGS, {
      images: { allowedMimeTypes: ["image/png"] },
    });

    expect(merged.images.allowedMimeTypes).toEqual(["image/png"]);
  });

  it("applies later layers over earlier ones", () => {
    const { settings } = resolveAiSettings(
      { defaultModel: "deployment-model", maxTurns: 4 },
      { defaultModel: "workspace-model" }
    );

    expect(settings.defaultModel).toBe("workspace-model");
    expect(settings.maxTurns).toBe(4);
  });

  it("drops an out-of-bounds layer whole rather than clamping it", () => {
    const { settings, rejected } = resolveAiSettings(
      { maxTurns: 5 },
      // 999 exceeds the schema bound, so this layer never applies — including
      // the model change that rode along with it.
      { maxTurns: 999, defaultModel: "should-not-apply" }
    );

    expect(settings.maxTurns).toBe(5);
    expect(settings.defaultModel).toBe(DEFAULT_AI_SETTINGS.defaultModel);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("maxTurns");
  });

  it("keeps defaults when no layer is supplied", () => {
    const { settings, rejected } = resolveAiSettings(null, undefined);

    expect(settings).toEqual(DEFAULT_AI_SETTINGS);
    expect(rejected).toEqual([]);
  });
});

describe("workspace settings parsing", () => {
  it("accepts a settings document stored as JSON text", () => {
    const parsed = parseWorkspaceAiSettings(
      JSON.stringify({ images: { blockImages: true } })
    );

    expect(parsed).toEqual({ images: { blockImages: true } });
  });

  it("returns null for malformed or invalid documents", () => {
    expect(parseWorkspaceAiSettings("not json")).toBeNull();
    expect(parseWorkspaceAiSettings({ maxTurns: "many" })).toBeNull();
    expect(parseWorkspaceAiSettings(null)).toBeNull();
  });

  it("ignores keys that are not part of the schema", () => {
    const parsed = parseWorkspaceAiSettings({
      maxTurns: 3,
      somethingElse: "ignored",
    });

    expect(parsed).toEqual({ maxTurns: 3 });
  });
});
