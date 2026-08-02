type OutputItemStatus = "in_progress" | "completed" | "incomplete";

type SseRepairState = {
  statusById: Map<string, OutputItemStatus>;
  statusByIndex: Map<number, OutputItemStatus>;
};

const OUTPUT_ITEM_STATUSES = new Set<OutputItemStatus>([
  "in_progress",
  "completed",
  "incomplete",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseOutputItemStatus = (value: unknown): OutputItemStatus | undefined =>
  typeof value === "string" &&
  OUTPUT_ITEM_STATUSES.has(value as OutputItemStatus)
    ? (value as OutputItemStatus)
    : undefined;

const rememberCompletedOutputItem = (
  event: Record<string, unknown>,
  state: SseRepairState
) => {
  if (event.type !== "response.output_item.done" || !isRecord(event.item)) {
    return;
  }

  const status = parseOutputItemStatus(event.item.status);
  if (!status) return;

  if (typeof event.item.id === "string") {
    state.statusById.set(event.item.id, status);
  }
  if (typeof event.output_index === "number") {
    state.statusByIndex.set(event.output_index, status);
  }
};

const repairTerminalResponse = (
  event: Record<string, unknown>,
  state: SseRepairState
) => {
  const fallbackStatus =
    event.type === "response.completed"
      ? "completed"
      : event.type === "response.incomplete"
        ? "incomplete"
        : undefined;
  if (!fallbackStatus || !isRecord(event.response)) return false;

  const output = event.response.output;
  if (!Array.isArray(output)) return false;

  let changed = false;
  const repairedOutput = output.map((item, index) => {
    if (
      !isRecord(item) ||
      item.type !== "message" ||
      parseOutputItemStatus(item.status)
    ) {
      return item;
    }

    const rememberedStatus =
      (typeof item.id === "string"
        ? state.statusById.get(item.id)
        : undefined) ?? state.statusByIndex.get(index);
    changed = true;
    return { ...item, status: rememberedStatus ?? fallbackStatus };
  });

  if (changed) {
    event.response = { ...event.response, output: repairedOutput };
  }
  return changed;
};

const repairSseFrame = (frame: string, state: SseRepairState) => {
  const newline = frame.includes("\r\n") ? "\r\n" : "\n";
  const lines = frame.split(/\r?\n/);
  const dataIndexes = lines
    .map((line, index) => (line.startsWith("data:") ? index : -1))
    .filter(index => index >= 0);

  // OpenAI Responses events use one JSON data line per SSE frame. Leave any
  // non-standard multi-line event untouched rather than risking data loss.
  if (dataIndexes.length !== 1) return frame;

  const dataIndex = dataIndexes[0]!;
  const line = lines[dataIndex]!;
  const prefix = line.startsWith("data: ") ? "data: " : "data:";
  const payload = line.slice(prefix.length);
  if (!payload || payload === "[DONE]") return frame;

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return frame;
  }
  if (!isRecord(event)) return frame;

  rememberCompletedOutputItem(event, state);
  if (!repairTerminalResponse(event, state)) return frame;

  lines[dataIndex] = `${prefix}${JSON.stringify(event)}`;
  return lines.join(newline);
};

const isResponsesSse = (input: RequestInfo | URL, response: Response) => {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  let pathname = "";
  try {
    pathname = new URL(rawUrl).pathname.replace(/\/$/, "");
  } catch {
    return false;
  }

  return (
    pathname.endsWith("/responses") &&
    response.headers.get("content-type")?.includes("text/event-stream") === true
  );
};

const createRepairStream = (body: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: SseRepairState = {
    statusById: new Map(),
    statusByIndex: new Map(),
  };
  let buffer = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary || boundary.index === undefined) break;

        const frame = buffer.slice(0, boundary.index);
        const delimiter = boundary[0];
        buffer = buffer.slice(boundary.index + delimiter.length);
        controller.enqueue(
          encoder.encode(`${repairSseFrame(frame, state)}${delimiter}`)
        );
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) {
        controller.enqueue(encoder.encode(repairSseFrame(buffer, state)));
      }
    },
  });

  return body.pipeThrough(transform);
};

/**
 * Repairs a gateway compatibility defect without buffering the streamed answer.
 * Compliant Responses API payloads pass through unchanged.
 */
export const createOpenAiResponsesCompatibilityFetch = (
  baseFetch: typeof fetch = globalThis.fetch
): typeof fetch => {
  const compatibilityFetch: typeof fetch = async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.body || !isResponsesSse(input, response)) return response;

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(createRepairStream(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  return compatibilityFetch;
};
