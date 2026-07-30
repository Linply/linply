import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { ENV } from "./env";
import { logInfo, logWarn } from "./observability";

let telemetrySdk: NodeSDK | undefined;

export function startTelemetry(serviceName: "web" | "agent-worker" | "knowledge-worker") {
  if (!ENV.otelEnabled || process.env.OTEL_SDK_DISABLED === "true") {
    logInfo("[OpenTelemetry] Disabled", { serviceName });
    return;
  }

  telemetrySdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: `${ENV.otelServiceNamespace}-${serviceName}`,
      [ATTR_SERVICE_NAMESPACE]: ENV.otelServiceNamespace,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "1.0.0",
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
        process.env.NODE_ENV ?? "development",
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: request =>
          request.url === "/api/health" || request.url === "/favicon.ico",
      }),
      new ExpressInstrumentation(),
    ],
  });

  telemetrySdk.start();
  logInfo("[OpenTelemetry] Started", {
    serviceName,
    exporter:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      "http://localhost:4318/v1/traces",
  });
}


export async function shutdownTelemetry() {
  if (!telemetrySdk) return;
  const sdk = telemetrySdk;
  telemetrySdk = undefined;
  await sdk.shutdown().catch(error => {
    logWarn("[OpenTelemetry] Shutdown failed", { error });
  });
}
