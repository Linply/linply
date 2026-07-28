import "dotenv/config";
import { shutdownTelemetry, startTelemetry } from "./_core/telemetry";

async function bootstrap() {
  startTelemetry("agent-worker");

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdownTelemetry();
    });
  }

  await import("./agentWorker");
}

void bootstrap().catch(error => {
  console.error("[Agent Worker] Failed to start", error);
  process.exitCode = 1;
});
