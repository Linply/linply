import type { Express, Request, Response } from "express";
import { authenticateRequest } from "./_core/auth";
import * as db from "./db";
import type { KnowledgeRetrieval } from "./db";
import { getTicketForScope } from "./accessControl";
import { consoleScope, requireWorkspaceForUser } from "./workspace";
import {
  type AgentEvent,
  type AgentRunStats,
  type StructuredAgentOutput,
} from "./agentService";
import {
  enqueueAgentRun,
  getPublicAgentErrorMessage,
} from "./agentRunExecution";
import {
  TOKEN_QUOTA_EXCEEDED_CODE,
  TokenQuotaExceededError,
} from "./tokenQuota";

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
  | {
      type: "done";
      llmProvider: string;
      llmModel?: string;
      stats?: AgentRunStats;
      attemptCount?: number;
    }
  | {
      type: "error";
      message: string;
      stats?: Partial<AgentRunStats>;
      attemptCount?: number;
    };

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

/**
 * Agent 模式聊天的 SSE 事件推送循环：把某个 Agent Run 的执行过程实时或断线补发给前端。
 */
const streamAgentRunEvents = async (
  res: Response,
  runId: string,
  afterSeq: number,
  workspaceId: number
) => {
  const run = await db.getAgentRunById(runId);
  if (!run || run.workspaceId !== workspaceId) {
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
        stats: {
          durationMs: currentRun.durationMs ?? 0,
          inputTokens: currentRun.inputTokens ?? 0,
          outputTokens: currentRun.outputTokens ?? 0,
          totalTokens: currentRun.totalTokens ?? 0,
          llmRequestCount: currentRun.llmRequestCount ?? 0,
          contextWindowTokens: currentRun.contextWindowTokens ?? 0,
          traceId: currentRun.traceId,
          spanId: currentRun.spanId,
          usageState: currentRun.usageState,
        },
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
      const workspace = await requireWorkspaceForUser(user);
      const scope = consoleScope(workspace);
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
          await getTicketForScope(ticketId, scope);
        } catch {
          res.status(403).json({ error: "无权访问该工单" });
          return;
        }
      }

      const run = await enqueueAgentRun({
        scope,
        ticketId,
        content,
      });
      res.status(202).json({
        mode: "agent",
        runId: run.id,
        quota: run.quota,
      });
    } catch (error) {
      if (error instanceof TokenQuotaExceededError) {
        res.status(429).json({
          error: error.message,
          code: TOKEN_QUOTA_EXCEEDED_CODE,
          quota: error.quota,
        });
        return;
      }
      res.status(500).json({ error: getPublicAgentErrorMessage(error) });
    }
  });

  app.get("/api/chat/stream/:runId", async (req: Request, res: Response) => {
    configureSse(res);
    try {
      const user = await authenticateRequest(req);
      const workspace = await requireWorkspaceForUser(user);
      const afterSeqValue = Number(
        req.query.afterSeq ?? req.headers["last-event-id"] ?? 0
      );
      const afterSeq = Number.isFinite(afterSeqValue) && afterSeqValue > 0
        ? Math.floor(afterSeqValue)
        : 0;
      await streamAgentRunEvents(res, req.params.runId, afterSeq, workspace.id);
    } catch (error) {
      if (!res.writableEnded) sendSseError(res, error);
    } finally {
      res.end();
    }
  });

}
