import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { ENV } from "./_core/env";
import * as db from "./db";
import { executeAgentRun } from "./agentRunExecution";

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const pollMs = Math.max(100, ENV.agentWorkerPollMs);
const leaseMs = Math.max(10_000, ENV.agentWorkerLeaseMs);
const maxAttempts = Math.max(1, ENV.agentWorkerMaxAttempts);
let stopping = false;

const healthServer = process.env.PORT
  ? createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "agent-worker" }));
        return;
      }
      res.writeHead(404);
      res.end();
    }).listen(Number(process.env.PORT))
  : null;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log(`[Agent Worker] Received ${signal}; stopping after current Run`);
  });
}

async function startWorker() {
  if (!ENV.databaseUrl) throw new Error("DATABASE_URL is required for Agent worker");

  console.log("[Agent Worker] Started", {
    workerId,
    pollMs,
    leaseMs,
    maxAttempts,
  });

  while (!stopping) {
    try {
      const run = await db.claimNextAgentRun({
        workerId,
        leaseMs,
        maxAttempts,
      });
      if (!run) {
        await wait(pollMs);
        continue;
      }

      console.log("[Agent Worker] Claimed Run", {
        runId: run.id,
        attemptCount: run.attemptCount,
      });
      await executeAgentRun(run, { workerId, leaseMs });
    } catch (error) {
      console.error("[Agent Worker] Poll or execution failed", error);
      await wait(pollMs);
    }
  }

  if (healthServer) {
    await new Promise<void>((resolve, reject) => {
      healthServer.close(error => error ? reject(error) : resolve());
    });
  }
  console.log("[Agent Worker] Stopped", { workerId });
}

startWorker().catch(error => {
  console.error("[Agent Worker] Fatal error", error);
  healthServer?.close();
  process.exit(1);
});
