import {
  createAgentSession,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { AiSettings } from "../../shared/aiSettings";
import type { WorkspacePersona } from "../agentPersona";
import { buildAgentInstructions } from "../agentPersona";
import { getModelRuntime, resolveAgentModel } from "./provider";
import {
  createSealedResourceLoader,
  getSealedAgentDir,
} from "./resourceLoader";
import { AGENT_TOOL_NAMES, createAgentTools } from "./tools";
import type { AgentContext } from "./types";

/**
 * One pi session per customer message.
 *
 * pi is built around a long-lived session on disk that a developer keeps
 * talking to. A customer-service run is the opposite: it answers one message,
 * on behalf of one workspace, and its history lives in Postgres where the rest
 * of the product can read it. So the session here is in-memory, disposable, and
 * rebuilt with the conversation replayed into the prompt — which also keeps the
 * existing prompt-injection partitions intact.
 */

export type AgentTurnUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AgentTurnResult = {
  assistantContent: string;
  /** What the customer actually watched arrive, for comparison with the above. */
  streamedContent: string;
  usage: AgentTurnUsage;
  /** True when the turn limit stopped the run rather than the model. */
  turnLimitReached: boolean;
};

export type AgentTurnInput = {
  context: AgentContext;
  persona: WorkspacePersona | null;
  settings: AiSettings;
  /** The composed prompt: history partitions, replay context, current request. */
  prompt: string;
  images: Array<{ type: "image"; data: string; mimeType: string }>;
  signal: AbortSignal;
  onTextDelta?: (delta: string) => void | Promise<void>;
};

/**
 * pi's settings document drives retry, compaction and image handling inside the
 * engine; ours is the source for all three, so the relevant sections are handed
 * straight over rather than restated.
 */
const toPiSettings = (settings: AiSettings) => ({
  compaction: {
    enabled: settings.compaction.enabled,
    reserveTokens: settings.compaction.reserveTokens,
    keepRecentTokens: settings.compaction.keepRecentTokens,
  },
  retry: {
    enabled: settings.retry.enabled,
    maxRetries: settings.retry.maxRetries,
    baseDelayMs: settings.retry.baseDelayMs,
    provider: {
      timeoutMs: settings.retry.provider.timeoutMs,
      maxRetries: settings.retry.provider.maxRetries,
      maxRetryDelayMs: settings.retry.provider.maxRetryDelayMs,
    },
  },
  images: {
    autoResize: settings.images.autoResize,
    blockImages: settings.images.blockImages,
  },
});

/**
 * pi's message union carries more than model turns — branch summaries and other
 * bookkeeping entries have no `content` at all, so this reads defensively
 * rather than assuming the shape of whatever the session recorded.
 */
const textOf = (message: unknown) => {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "text"
    )
    .map(part => part.text)
    .join("");
};

export const runAgentTurn = async ({
  context,
  persona,
  settings,
  prompt,
  images,
  signal,
  onTextDelta,
}: AgentTurnInput): Promise<AgentTurnResult> => {
  const model = await resolveAgentModel(settings);
  const sealedDir = getSealedAgentDir();
  const resourceLoader = await createSealedResourceLoader(
    buildAgentInstructions(persona)
  );

  const { session } = await createAgentSession({
    cwd: sealedDir,
    agentDir: sealedDir,
    model,
    thinkingLevel: settings.defaultThinkingLevel,
    modelRuntime: await getModelRuntime(settings),
    /**
     * The single most important line in this file. pi ships read/bash/edit/write
     * and would happily run shell commands on the server if a customer asked
     * nicely; only the workspace's own business tools are exposed.
     */
    noTools: "all",
    tools: [...AGENT_TOOL_NAMES],
    customTools: createAgentTools(context),
    resourceLoader,
    sessionManager: SessionManager.inMemory(sealedDir),
    settingsManager: SettingsManager.inMemory(toPiSettings(settings)),
  });

  const usage: AgentTurnUsage = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let streamed = "";
  let failure: string | undefined;
  let turns = 0;
  let turnLimitReached = false;

  const unsubscribe = session.subscribe(event => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      const delta = event.assistantMessageEvent.delta;
      streamed += delta;
      void onTextDelta?.(delta);
      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const message = event.message as {
        usage?: { input?: number; output?: number; totalTokens?: number };
        stopReason?: string;
        errorMessage?: string;
      };
      usage.requests += 1;
      usage.inputTokens += message.usage?.input ?? 0;
      usage.outputTokens += message.usage?.output ?? 0;
      usage.totalTokens += message.usage?.totalTokens ?? 0;
      // pi reports a failed call as a finished message rather than a rejection,
      // so without this the run would be recorded as a successful empty reply.
      if (message.stopReason === "error") {
        failure = message.errorMessage || "模型调用失败";
      }
      return;
    }

    if (event.type === "turn_end") {
      turns += 1;
      /**
       * pi has no turn ceiling of its own — it loops until the model stops
       * calling tools. A customer-service run pays for every loop, so the
       * settings document caps it.
       */
      if (turns >= settings.maxTurns) {
        turnLimitReached = true;
        void session.abort();
      }
    }
  });

  const abort = () => void session.abort();
  signal.addEventListener("abort", abort);

  try {
    await session.prompt(prompt, images.length > 0 ? { images } : undefined);
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }

  if (signal.aborted) throw new Error("LLM call timed out，请稍后重试");
  if (failure) throw new Error(failure);

  /**
   * The last assistant message is the answer; the accumulated stream also holds
   * whatever the model said on its way through tool calls. Preferring the
   * message keeps the saved reply and the visible bubble in agreement.
   */
  const finalMessage = [...session.messages]
    .reverse()
    .find(message => message.role === "assistant" && textOf(message).trim());

  return {
    assistantContent: (finalMessage ? textOf(finalMessage) : streamed).trim(),
    streamedContent: streamed,
    usage,
    turnLimitReached,
  };
};
