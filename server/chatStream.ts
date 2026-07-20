import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { streamLLM } from "./_core/llm";
import { authenticateRequest } from "./_core/auth";
import * as db from "./db";
import type { KnowledgeRetrieval } from "./db";
import { getTicketForUser } from "./accessControl";
import {
  type AgentEvent,
  type StructuredAgentOutput,
} from "./agentService";
import {
  enqueueAgentRun,
  getPublicAgentErrorMessage,
} from "./agentRunExecution";
import {
  LLM_TIMEOUT_MS,
  prepareChatResponse,
} from "./chatService";

type SsePayload =
  | { type: "reset"; reason: string; attemptCount: number }
  | {
      type: "meta";
      relatedKnowledge: Array<{ id: number; title: string; category: string }>;
      retrieval: KnowledgeRetrieval | null;
      llmProvider: string;
      runId?: string;
      structuredOutput?: StructuredAgentOutput;
      attemptCount?: number;
    }
  | { type: "delta"; content: string; attemptCount?: number }
  | {
      type: "agent_event";
      event: AgentEvent;
      attemptCount?: number;
    }
  | { type: "done"; llmProvider: string; llmModel?: string; attemptCount?: number }
  | { type: "error"; message: string; attemptCount?: number };

const writeSse = (res: Response, payload: SsePayload, eventId?: number) => {
  if (eventId !== undefined) res.write(`id: ${eventId}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const configureSse = (res: Response) => {
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();
};

const waitForNextEvent = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

const streamAgentRunEvents = async (
  res: Response,
  runId: string,
  afterSeq: number,
  userId: number,
  isAdmin: boolean
) => {
  const run = await db.getAgentRunById(runId);
  if (!run || (!isAdmin && run.userId !== userId)) {
    res.statusCode = 404;
    writeSse(res, { type: "error", message: "Agent Run 不存在或无权访问" });
    return;
  }

  let cursor = afterSeq;
  let clientClosed = false;
  res.on("close", () => {
    clientClosed = true;
  });

  while (!clientClosed) {
    const events = await db.getAgentRunEvents(runId, cursor);
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      writeSse(res, {
        type: event.eventType as SsePayload["type"],
        ...payload,
      } as SsePayload, event.id);
      cursor = event.id;
    }

    if (events.some(event => event.eventType === "done" || event.eventType === "error")) {
      return;
    }

    const currentRun = await db.getAgentRunById(runId);
    if (currentRun?.status === "failed" && events.length === 0) {
      writeSse(res, { type: "error", message: currentRun.error ?? "Agent Run 执行失败" });
      return;
    }
    if (currentRun?.status === "completed" && events.length === 0) {
      writeSse(res, {
        type: "done",
        llmProvider: currentRun.llmProvider ?? "openai-agents",
        llmModel: currentRun.llmModel ?? undefined,
      });
      return;
    }

    await waitForNextEvent(250);
  }
};

const sendSseError = (res: Response, error: unknown) => {
  const message = getPublicAgentErrorMessage(error);
  writeSse(res, { type: "error", message });
};

export function registerChatStreamRoutes(app: Express) {
  app.post("/api/chat/start", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      const content = typeof req.body?.content === "string"
        ? req.body.content.trim()
        : "";
      const ticketId = typeof req.body?.ticketId === "number"
        ? req.body.ticketId
        : undefined;

      if (!content) {
        res.status(400).json({ error: "消息内容不能为空" });
        return;
      }
      if (ticketId !== undefined) {
        try {
          await getTicketForUser(ticketId, user);
        } catch {
          res.status(403).json({ error: "无权访问该工单" });
          return;
        }
      }

      if (ENV.chatMode !== "agent") {
        res.json({ mode: ENV.chatMode, runId: null });
        return;
      }

      const run = await enqueueAgentRun({
        userId: user.id,
        ticketId,
        content,
      });
      res.status(202).json({ mode: "agent", runId: run.id });
    } catch (error) {
      res.status(500).json({ error: getPublicAgentErrorMessage(error) });
    }
  });

  app.get("/api/chat/stream/:runId", async (req: Request, res: Response) => {
    configureSse(res);
    try {
      const user = await authenticateRequest(req);
      const afterSeqValue = Number(
        req.query.afterSeq ?? req.headers["last-event-id"] ?? 0
      );
      const afterSeq = Number.isFinite(afterSeqValue) && afterSeqValue > 0
        ? Math.floor(afterSeqValue)
        : 0;
      await streamAgentRunEvents(
        res,
        req.params.runId,
        afterSeq,
        user.id,
        user.role === "admin"
      );
    } catch (error) {
      if (!res.writableEnded) sendSseError(res, error);
    } finally {
      res.end();
    }
  });

  app.post("/api/chat/stream", async (req: Request, res: Response) => {
    configureSse(res);

    const abortController = new AbortController();
    let clientClosed = false;
    let timedOut = false;
    const timeoutId = ENV.chatMode === "agent" ? undefined : setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, LLM_TIMEOUT_MS);
    res.on("close", () => {
      if (!res.writableEnded && ENV.chatMode !== "agent") {
        clientClosed = true;
        abortController.abort();
      }
    });

    try {
      const user = await authenticateRequest(req);
      const content = typeof req.body?.content === "string"
        ? req.body.content.trim()
        : "";
      const ticketId = typeof req.body?.ticketId === "number"
        ? req.body.ticketId
        : undefined;

      if (!content) {
        res.statusCode = 400;
        writeSse(res, { type: "error", message: "消息内容不能为空" });
        return;
      }

      if (ticketId !== undefined) {
        try {
          await getTicketForUser(ticketId, user);
        } catch {
          res.statusCode = 403;
          writeSse(res, { type: "error", message: "无权访问该工单" });
          return;
        }
      }

      if (ENV.chatMode === "agent") {
        const run = await enqueueAgentRun({
          userId: user.id,
          ticketId,
          content,
        });
        await streamAgentRunEvents(res, run.id, 0, user.id, user.role === "admin");
        return;
      }

      const { messages, relatedKnowledge, relatedKnowledgeSnapshot, retrieval } =
        await prepareChatResponse({
          userId: user.id,
          userRole: user.role,
          ticketId,
          content,
        });

      writeSse(res, {
        type: "meta",
        relatedKnowledge: relatedKnowledgeSnapshot,
        retrieval,
        llmProvider: ENV.llmProvider,
      });

      let assistantContent = "";
      let llmModel: string | undefined;

      for await (const chunk of streamLLM({ messages }, abortController.signal)) {
        if (chunk.type === "content" && chunk.content) {
          assistantContent += chunk.content;
          if (chunk.model) llmModel = chunk.model;
          writeSse(res, { type: "delta", content: chunk.content });
        }
      }

      if (!assistantContent) {
        assistantContent = "抱歉，我无法处理您的请求。";
        writeSse(res, { type: "delta", content: assistantContent });
      }

      await db.saveChatMessage({
        ticketId,
        userId: user.id,
        role: "assistant",
        content: assistantContent,
        relatedKnowledgeIds: relatedKnowledge.map(kb => kb.id),
        relatedKnowledgeSnapshot,
        llmProvider: ENV.llmProvider,
        llmModel,
      });

      writeSse(res, {
        type: "done",
        llmProvider: ENV.llmProvider,
        llmModel,
      });
    } catch (error) {
      if (!clientClosed) {
        sendSseError(
          res,
          timedOut ? new Error("LLM call timed out，请稍后重试") : error
        );
      }
    } finally {
      clearTimeout(timeoutId);
      res.end();
    }
  });
}
