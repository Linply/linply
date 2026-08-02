import { describe, expect, it, vi } from "vitest";
import { createOpenAiResponsesCompatibilityFetch } from "./openaiResponsesCompatibility";

const sse = (event: unknown, newline = "\n") =>
  `data: ${JSON.stringify(event)}${newline}${newline}`;

const streamingResponse = (
  chunks: string[],
  contentType = "text/event-stream"
) => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": "999",
      },
    }
  );
};

const readEvents = async (response: Response) =>
  (await response.text())
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map(frame => JSON.parse(frame.replace(/^data:\s*/, "")));

describe("OpenAI Responses SSE compatibility", () => {
  it("restores a missing terminal message status from output_item.done", async () => {
    const done = sse({
      type: "response.output_item.done",
      output_index: 0,
      item: { id: "msg_1", type: "message", status: "completed" },
    });
    const terminal = sse({
      type: "response.completed",
      response: {
        id: "resp_1",
        status: "completed",
        output: [{ id: "msg_1", type: "message", content: [] }],
      },
    });
    const splitAt = done.length + Math.floor(terminal.length / 2);
    const source = `${done}${terminal}`;
    const baseFetch = vi.fn(async () =>
      streamingResponse([source.slice(0, splitAt), source.slice(splitAt)])
    );

    const response = await createOpenAiResponsesCompatibilityFetch(baseFetch)(
      "https://gateway.example/v1/responses"
    );
    const events = await readEvents(response);

    expect(events[1].response.output[0].status).toBe("completed");
    expect(response.headers.has("content-length")).toBe(false);
  });

  it("uses the terminal state when the done item was not observed", async () => {
    const baseFetch = vi.fn(async () =>
      streamingResponse([
        sse(
          {
            type: "response.incomplete",
            response: {
              status: "incomplete",
              output: [{ id: "msg_2", type: "message", content: [] }],
            },
          },
          "\r\n"
        ),
      ])
    );

    const response = await createOpenAiResponsesCompatibilityFetch(baseFetch)(
      new URL("https://gateway.example/responses")
    );
    const [event] = await readEvents(response);

    expect(event.response.output[0].status).toBe("incomplete");
  });

  it("does not overwrite existing statuses or alter unrelated responses", async () => {
    const compliant = sse({
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          { id: "msg_3", type: "message", status: "incomplete", content: [] },
          { id: "call_1", type: "function_call" },
        ],
      },
    });
    const sseFetch = vi.fn(async () => streamingResponse([compliant]));
    const sseResponse = await createOpenAiResponsesCompatibilityFetch(sseFetch)(
      "https://gateway.example/v1/responses"
    );
    const [event] = await readEvents(sseResponse);

    expect(event.response.output).toEqual([
      { id: "msg_3", type: "message", status: "incomplete", content: [] },
      { id: "call_1", type: "function_call" },
    ]);

    const jsonResponse = new Response('{"status":"completed"}', {
      headers: { "content-type": "application/json" },
    });
    const jsonFetch = vi.fn(async () => jsonResponse);
    const untouched = await createOpenAiResponsesCompatibilityFetch(jsonFetch)(
      "https://gateway.example/v1/responses"
    );
    expect(untouched).toBe(jsonResponse);
  });
});
