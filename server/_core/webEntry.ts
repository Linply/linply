import "./loadEnv";
import { configureHostedAgentTracing } from "./agentTracing";
import { closeSessionCache } from "./sessionCache";
import { shutdownTelemetry, startTelemetry } from "./telemetry";

configureHostedAgentTracing();

async function bootstrap() {
  startTelemetry("web");

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= Promise.allSettled([
      closeSessionCache(),
      shutdownTelemetry(),
    ]).then(() => undefined);
    return shutdownPromise;
  };

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdown();
    });
  }

  await import("./index");
}

void bootstrap().catch(error => {
  console.error("[Web] Failed to start", error);
  process.exitCode = 1;
});
