import "dotenv/config";
import { shutdownTelemetry, startTelemetry } from "./telemetry";

async function bootstrap() {
  startTelemetry("web");

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdownTelemetry();
    });
  }

  await import("./index");
}

void bootstrap().catch(error => {
  console.error("[Web] Failed to start", error);
  process.exitCode = 1;
});
