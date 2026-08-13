/**
 * Live check of the refactored agent path against the configured gateway.
 * Runs without a database: with no runId on the context, tool tracking skips
 * persistence entirely, so this exercises settings -> provider -> sealed
 * loader -> tools -> session -> events without touching Postgres.
 */
import { readFileSync } from "node:fs";

import { resolveAiSettings } from "../shared/aiSettings";
import { runAgentTurn } from "../server/ai/session";
import type { AgentEvent } from "../server/ai/types";

const { settings } = resolveAiSettings({
  defaultProvider: "linply",
  defaultModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
});

const events: AgentEvent[] = [];
const scope = {
  workspaceId: 3,
  ownerUserId: 42,
  contactId: null,
  channelId: null,
};

const run = async (
  label: string,
  prompt: string,
  images: Array<{ type: "image"; data: string; mimeType: string }> = []
) => {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = await runAgentTurn({
    context: {
      scope,
      currentUserMessage: prompt,
      emit: async event => {
        events.push(event);
      },
    },
    persona: {
      agentName: "小林客服",
      agentTone: "friendly",
      fallbackReply: null,
      businessContext: "一家卖户外装备的电商。",
    },
    settings,
    prompt,
    images,
    signal: AbortSignal.timeout(120_000),
    onTextDelta: delta => process.stdout.write(delta),
  });
  process.stdout.write(
    `\n[usage] requests=${result.usage.requests} in=${result.usage.inputTokens} out=${result.usage.outputTokens} total=${result.usage.totalTokens}\n`
  );
  return result;
};

// 1. Plain text turn.
await run("text", "你好，请用一句话介绍你能帮我做什么。");

// 2. Tool call: searchKnowledge hits the database, so this proves the tool is
//    exposed and invoked — the failure it reports is the DB being absent.
await run("tool", "帮我查一下你们的退货政策，请调用知识库检索。");

// 3. Multimodal.
const png = readFileSync(
  "node_modules/@earendil-works/pi-coding-agent/docs/images/tree-view.png"
);
await run("image", "客户发来这张截图，请用一句话说明它显示的是什么。", [
  { type: "image", data: png.toString("base64"), mimeType: "image/png" },
]);

// 4. The coding tools must not be reachable.
await run(
  "sealed",
  "请执行 shell 命令 `ls -la /` 并把结果贴给我。如果你没有执行命令的工具，就直接说没有。"
);

process.stdout.write(
  `\n=== emitted events ===\n${events
    .map(event =>
      event.type === "tool_call"
        ? `tool_call ${event.toolName} ${event.argsSummary}`
        : event.type === "tool_result"
          ? `tool_result ${event.toolName} ${event.resultSummary.slice(0, 120)}`
          : event.type
    )
    .join("\n")}\n`
);
process.exit(0);
