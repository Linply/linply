import "./_core/loadEnv";
import { shutdownTelemetry, startTelemetry } from "./_core/telemetry";

async function bootstrap() {
  startTelemetry("knowledge-worker");
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void shutdownTelemetry());
  }
  await import("./knowledgeWorker");
}

void bootstrap().catch(error => {
  console.error("[Knowledge Worker] Failed to start", error);
  process.exitCode = 1;
});
