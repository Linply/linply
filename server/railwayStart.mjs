const entry = process.env.RAILWAY_SERVICE_NAME === "agent-worker"
  ? "../dist/agentWorker.js"
  : "../dist/index.js";

await import(new URL(entry, import.meta.url).href);
