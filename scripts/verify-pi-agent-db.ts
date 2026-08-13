/**
 * End-to-end check against a real database: exercises the paths the no-database
 * verification skips — run records, tool invocation bookkeeping, step
 * persistence and chat history. Point DATABASE_URL at a throwaway database.
 */
import { createAgentChatResponse } from "../server/agentService";
import * as db from "../server/db";

const scope = {
  workspaceId: 1,
  ownerUserId: 1,
  contactId: null,
  channelId: null,
};

const response = await createAgentChatResponse({
  scope,
  content: "你们的退货政策是什么？请查知识库后回答。",
});

console.log("\n=== reply ===");
console.log(response.assistantMessage);
console.log("\n=== run ===");
const run = await db.getAgentRunById(response.runId);
console.log({
  status: run?.status,
  provider: run?.llmProvider,
  model: run?.llmModel,
  inputTokens: run?.inputTokens,
  outputTokens: run?.outputTokens,
  totalTokens: run?.totalTokens,
  requests: run?.llmRequestCount,
  usageState: run?.usageState,
  durationMs: run?.durationMs,
});

console.log("\n=== persisted steps ===");
const steps = await db.getAgentRunSteps(response.runId);
for (const step of steps) {
  console.log(
    `${step.stepType.padEnd(12)} ${step.toolName ?? ""} ${(
      step.content ??
      step.argsSummary ??
      step.resultSummary ??
      ""
    )
      .toString()
      .slice(0, 90)}`
  );
}

console.log("\n=== knowledge cited ===");
console.log(response.relatedKnowledge);
console.log("\n=== structured output ===");
console.log({
  category: response.structuredOutput.category,
  riskLevel: response.structuredOutput.riskLevel,
  shouldCreateTicket: response.structuredOutput.shouldCreateTicket,
});

process.exit(0);
