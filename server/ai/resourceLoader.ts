import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

/**
 * pi is a coding agent: left to its own defaults it discovers extensions,
 * skills, prompt templates and `AGENTS.md` from the working directory, its
 * ancestors, and the operator's home. In a customer-service server every one of
 * those is a way for this repository's own instructions — or a developer's
 * personal skills — to end up in a reply sent to someone else's customer.
 *
 * So the loader is sealed: discovery is switched off at the source, the
 * directories it is pointed at are empty and private, and the only instruction
 * that survives is the workspace's own system prompt.
 */

let sealedDir: string | null = null;

/** Empty, per-process, and outside any repository — nothing to discover. */
export const getSealedAgentDir = () => {
  sealedDir ??= mkdtempSync(join(tmpdir(), "linply-agent-resources-"));
  return sealedDir;
};

const getSealedDir = getSealedAgentDir;

export const createSealedResourceLoader = async (systemPrompt: string) => {
  const dir = getSealedDir();
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    // Settings come from our own resolved document, never from a settings.json
    // that happens to exist on the host.
    settingsManager: SettingsManager.inMemory({}),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    // Belt and braces: even if discovery found something, nothing survives.
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });

  await loader.reload();
  return loader;
};
