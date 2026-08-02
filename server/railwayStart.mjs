const entries = {
  "agent-worker": "../dist/agentWorker.js",
  "knowledge-worker": "../dist/knowledgeWorker.js",
};
const entry = entries[process.env.RAILWAY_SERVICE_NAME] ?? "../dist/index.js";

await import(new URL(entry, import.meta.url).href);
