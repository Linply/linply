import type { Express, Request, Response } from "express";
import { logWarn } from "../_core/observability";
import { createAgentChatResponse } from "../agentService";
import * as db from "../db";
import { TokenQuotaExceededError } from "../tokenQuota";
import type { ConversationScope } from "../workspace";
import { DEFAULT_GREETING } from "./inbound";

/**
 * The `web` channel: an unauthenticated page a workspace owner can hand to
 * their own customers. Visitors are anonymous — the browser keeps a random
 * visitor id and the server maps it onto a contact, so a returning visitor
 * keeps their thread without ever creating an account.
 */

const MAX_MESSAGE_LENGTH = 2_000;
const VISITOR_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/** Per-workspace burst cap; a public link is an open door and agent runs cost money. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 20;
const rateLimitBuckets = new Map<number, number[]>();

const consumeRateLimit = (workspaceId: number) => {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(workspaceId) ?? []).filter(
    timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT_MAX_MESSAGES) {
    rateLimitBuckets.set(workspaceId, recent);
    return false;
  }
  recent.push(now);
  rateLimitBuckets.set(workspaceId, recent);
  return true;
};

const loadPublicWorkspace = async (publicKey: string) => {
  if (!/^[a-f0-9]{16,32}$/.test(publicKey)) return null;
  const workspace = await db.getWorkspaceByPublicKey(publicKey);
  if (!workspace || !workspace.publicChatEnabled) return null;
  return workspace;
};

export function registerPublicChatRoutes(app: Express) {
  app.get("/api/public/agent/:publicKey", async (req, res) => {
    const workspace = await loadPublicWorkspace(req.params.publicKey);
    if (!workspace) {
      res.status(404).json({ error: "该客服链接不存在或已关闭" });
      return;
    }
    res.json({
      agentName: workspace.agentName,
      workspaceName: workspace.name,
      greeting: workspace.greeting?.trim() || DEFAULT_GREETING,
    });
  });

  app.post(
    "/api/public/agent/:publicKey/message",
    async (req: Request, res: Response) => {
      const workspace = await loadPublicWorkspace(req.params.publicKey);
      if (!workspace) {
        res.status(404).json({ error: "该客服链接不存在或已关闭" });
        return;
      }

      const visitorId =
        typeof req.body?.visitorId === "string" ? req.body.visitorId : "";
      const content =
        typeof req.body?.content === "string" ? req.body.content.trim() : "";
      const locale =
        req.body?.locale === "en" || req.body?.locale === "zh"
          ? req.body.locale
          : null;

      if (!VISITOR_ID_PATTERN.test(visitorId)) {
        res.status(400).json({ error: "访客标识无效" });
        return;
      }
      if (!content) {
        res.status(400).json({ error: "消息内容不能为空" });
        return;
      }
      if (!consumeRateLimit(workspace.id)) {
        res
          .status(429)
          .json({ error: "当前咨询人数较多，请稍后再试" });
        return;
      }

      const channel = await db.getWorkspaceChannel(workspace.id, "web");
      if (!channel) {
        res.status(503).json({ error: "客服链接尚未初始化" });
        return;
      }

      try {
        const contact = await db.upsertChannelContact({
          workspaceId: workspace.id,
          channelId: channel.id,
          provider: "web",
          externalId: visitorId,
          externalChatId: visitorId,
          displayName: "网页访客",
          locale,
        });

        const scope: ConversationScope = {
          workspaceId: workspace.id,
          ownerUserId: workspace.ownerUserId,
          contactId: contact.id,
          channelId: channel.id,
        };

        const response = await createAgentChatResponse({
          scope,
          content: content.slice(0, MAX_MESSAGE_LENGTH),
        });

        res.json({
          reply: response.assistantMessage,
          relatedKnowledge: response.relatedKnowledge,
        });
      } catch (error) {
        if (error instanceof TokenQuotaExceededError) {
          res
            .status(429)
            .json({ error: "今日对话额度已用完，请稍后再试" });
          return;
        }
        logWarn("[PublicChat] Failed to answer visitor", {
          workspaceId: workspace.id,
          error,
        });
        res.status(500).json({
          error:
            workspace.fallbackReply?.trim() ||
            "抱歉，暂时无法回答，请稍后再试。",
        });
      }
    }
  );

  app.get(
    "/api/public/agent/:publicKey/history",
    async (req: Request, res: Response) => {
      const workspace = await loadPublicWorkspace(req.params.publicKey);
      if (!workspace) {
        res.status(404).json({ error: "该客服链接不存在或已关闭" });
        return;
      }
      const visitorId =
        typeof req.query.visitorId === "string" ? req.query.visitorId : "";
      if (!VISITOR_ID_PATTERN.test(visitorId)) {
        res.json({ messages: [] });
        return;
      }

      const channel = await db.getWorkspaceChannel(workspace.id, "web");
      if (!channel) {
        res.json({ messages: [] });
        return;
      }
      const contact = await db.findChannelContact(channel.id, visitorId);
      if (!contact) {
        res.json({ messages: [] });
        return;
      }

      const messages = await db.getContactMessages(contact.id, 50);
      res.json({
        messages: messages.map(message => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })),
      });
    }
  );
}
