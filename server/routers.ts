import {
  publicProcedure,
  router,
  protectedProcedure,
  workspaceProcedure,
} from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { parseJsonValue } from "./agentUtils";
import { createAgentChatResponse } from "./agentService";
import { enqueueAgentRun } from "./agentRunExecution";
import {
  TOKEN_QUOTA_EXCEEDED_CODE,
  TokenQuotaExceededError,
} from "./tokenQuota";
import { ingestDocument } from "./knowledge/ingest";
import {
  scanKnowledgeContent,
  toSafeKnowledgeDto,
} from "./knowledge/security";
import { KNOWLEDGE_SECURITY_STATUSES } from "../shared/knowledge";
import {
  abortMultipartUpload,
  calculateMultipartPartSize,
  completeMultipartUpload,
  createMultipartUpload,
  createUploadPartUrls,
  deleteStoredDocument,
  getStoredDocumentSize,
  isKnowledgeStorageConfigured,
  listMultipartParts,
} from "./knowledge/storage";
import {
  enqueueKnowledgeParse,
  isKnowledgeQueueConfigured,
} from "./knowledge/queue";
import { ENV } from "./_core/env";
import {
  clearSessionCookie,
  isDemoAccountConfigured,
  loginAsDemoAccount,
  loginWithPassword,
  registerWithPassword,
  revokeRequestSession,
  toPublicUser,
} from "./_core/auth";
import { isGoogleOAuthConfigured } from "./_core/googleOAuth";
import {
  getAgentRunForWorkspace,
  getAgentRunRecordForWorkspace,
  getChatHistoryForScope,
  getTicketChatHistoryForScope,
  getTicketForScope,
  getTicketNotesForScope,
  listTicketsForScope,
} from "./accessControl";
import {
  buildKnowledgeEmbeddingInput,
  createEmbedding,
  isEmbeddingEnabled,
} from "./_core/embeddings";
import { getChannelAdapter } from "./channels/inbound";
import {
  buildTelegramWebhookUrl,
  isPublicWebhookUrl,
  telegramAdapter,
  TelegramApiError,
} from "./channels/telegram";
import { CHANNEL_PROVIDERS, toChannelDto } from "./channels/types";
import {
  checkLimit,
  PLAN_ORDER,
  PLANS,
  WORKSPACE_PLANS,
  type WorkspacePlan,
} from "../shared/plans";

/**
 * Throws the standard "you hit your plan limit" error. Kept in one place so the
 * message and error code stay identical across every metered mutation.
 */
const assertWithinPlan = async (
  workspaceId: number,
  plan: WorkspacePlan,
  key: "knowledgeEntries" | "connectedChannels",
  requested = 1
) => {
  const usage = await db.getWorkspacePlanUsage(workspaceId);
  const result = checkLimit(plan, key, usage[key], requested);
  if (!result.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `PLAN_LIMIT_REACHED:${key}:${result.limit}`,
    });
  }
};

const reindexKnowledgeEntry = async (id: number, workspaceId: number) => {
  const entry = await db.getKnowledgeEntryById(id, workspaceId);
  if (!entry) throw new Error("Knowledge entry not found");
  if (entry.securityStatus !== "approved") {
    await db.updateKnowledgeEntry(id, {
      embedding: null,
      embeddingStatus: "blocked",
      conflictWith: null,
      conflictScore: null,
    });
    return { embeddingEnabled: false, status: "blocked" as const };
  }

  if (!isEmbeddingEnabled()) {
    await db.updateKnowledgeEntry(id, {
      embedding: null,
      embeddingStatus: "completed",
      conflictWith: null,
      conflictScore: null,
    });
    const conflict = await db.detectEntryConflict({
      id: entry.id,
      workspaceId: entry.workspaceId,
      title: entry.title,
      documentId: entry.documentId,
      embedding: null,
    });
    if (conflict) {
      await db.setEntryConflict(
        id,
        conflict.conflictWith,
        conflict.conflictScore
      );
    }
    return { embeddingEnabled: false, status: "completed" as const };
  }

  try {
    await db.updateKnowledgeEntry(id, {
      embeddingStatus: "pending",
      conflictWith: null,
      conflictScore: null,
    });
    const embedding = await createEmbedding(
      buildKnowledgeEmbeddingInput(entry),
      "document"
    );
    await db.setKnowledgeEntryEmbedding(id, embedding);
    const conflict = await db.detectEntryConflict({
      id: entry.id,
      workspaceId: entry.workspaceId,
      title: entry.title,
      documentId: entry.documentId,
      embedding,
    });
    if (conflict) {
      await db.setEntryConflict(
        id,
        conflict.conflictWith,
        conflict.conflictScore
      );
    }
    return { embeddingEnabled: true, status: "completed" as const };
  } catch (error) {
    await db.setKnowledgeEntryStatus(id, "failed");
    throw error;
  }
};

/** Every document lookup goes through here so cross-workspace ids 404 early. */
const getOwnedDocument = async (documentId: number, workspaceId: number) => {
  const document = await db.getKnowledgeDocument(documentId);
  if (!document || document.workspaceId !== workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return document;
};

const ONBOARDING_STEPS = [
  "profile",
  "knowledge",
  "preview",
  "channel",
  "done",
] as const;

export const appRouter = router({
  auth: router({
    providers: publicProcedure.query(() => ({
      google: isGoogleOAuthConfigured(),
      demoAccount: isDemoAccountConfigured(),
    })),
    me: publicProcedure.query(opts =>
      opts.ctx.user ? toPublicUser(opts.ctx.user) : null
    ),
    register: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(2, "姓名至少需要 2 个字符").max(80),
          email: z.string().trim().email("请输入有效邮箱").max(320),
          password: z.string().min(8, "密码至少需要 8 个字符").max(128),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await registerWithPassword(input, ctx.req, ctx.res);
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
          ) {
            throw new TRPCError({ code: "CONFLICT", message: "该邮箱已注册" });
          }
          throw error;
        }
      }),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().email("请输入有效邮箱").max(320),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await loginWithPassword(input, ctx.req, ctx.res);
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            error.statusCode === 403
          ) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "邮箱或密码错误",
            });
          }
          throw error;
        }
      }),
    demoLogin: publicProcedure.mutation(async ({ ctx }) => {
      try {
        return await loginAsDemoAccount(ctx.req, ctx.res);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          error.statusCode === 403
        ) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "体验入口暂不可用，请改用账号密码登录",
          });
        }
        throw error;
      }
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      try {
        await revokeRequestSession(ctx.req);
      } finally {
        clearSessionCookie(ctx.req, ctx.res);
      }
      return { success: true } as const;
    }),
  }),

  // ============ Workspace Router ============
  workspace: router({
    /** The single call every authenticated page makes on load. */
    get: workspaceProcedure.query(async ({ ctx }) => {
      const [overview, channels, planUsage] = await Promise.all([
        db.getWorkspaceOverview(ctx.workspace.id),
        db.listWorkspaceChannels(ctx.workspace.id),
        db.getWorkspacePlanUsage(ctx.workspace.id),
      ]);

      return {
        id: ctx.workspace.id,
        name: ctx.workspace.name,
        agentName: ctx.workspace.agentName,
        agentTone: ctx.workspace.agentTone,
        greeting: ctx.workspace.greeting,
        fallbackReply: ctx.workspace.fallbackReply,
        businessContext: ctx.workspace.businessContext,
        publicChatEnabled: ctx.workspace.publicChatEnabled,
        publicKey: ctx.workspace.publicKey,
        plan: ctx.workspace.plan,
        planActivatedAt: ctx.workspace.planActivatedAt,
        planUsage,
        onboardingStep: ctx.workspace.onboardingStep,
        onboardingCompletedAt: ctx.workspace.onboardingCompletedAt,
        createdAt: ctx.workspace.createdAt,
        overview,
        channels: channels.map(toChannelDto),
      };
    }),

    update: workspaceProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(80).optional(),
          agentName: z.string().trim().min(1).max(60).optional(),
          agentTone: z
            .enum(["professional", "friendly", "concise"])
            .optional(),
          greeting: z.string().trim().max(500).nullable().optional(),
          fallbackReply: z.string().trim().max(500).nullable().optional(),
          businessContext: z.string().trim().max(2_000).nullable().optional(),
          publicChatEnabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const workspace = await db.updateWorkspace(ctx.workspace.id, input);
        if (!workspace) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true as const };
      }),

    setOnboardingStep: workspaceProcedure
      .input(z.object({ step: z.enum(ONBOARDING_STEPS) }))
      .mutation(async ({ input, ctx }) => {
        await db.updateWorkspace(ctx.workspace.id, {
          onboardingStep: input.step,
          onboardingCompletedAt:
            input.step === "done"
              ? (ctx.workspace.onboardingCompletedAt ?? new Date())
              : null,
        });
        return { success: true as const };
      }),
  }),

  // ============ Plans Router ============
  plans: router({
    get: workspaceProcedure.query(async ({ ctx }) => {
      const [usage, openRequest] = await Promise.all([
        db.getWorkspacePlanUsage(ctx.workspace.id),
        db.getOpenPlanRequest(ctx.workspace.id),
      ]);

      return {
        currentPlan: ctx.workspace.plan,
        planActivatedAt: ctx.workspace.planActivatedAt,
        usage,
        pendingRequest: openRequest
          ? { toPlan: openRequest.toPlan, createdAt: openRequest.createdAt }
          : null,
        /**
         * `Infinity` does not survive JSON, so unlimited limits go over the
         * wire as null and the client renders them as "Unlimited".
         */
        catalog: PLAN_ORDER.map(id => {
          const plan = PLANS[id];
          return {
            id,
            priceUsd: plan.priceUsd,
            features: plan.features,
            limits: Object.fromEntries(
              Object.entries(plan.limits).map(([key, value]) => [
                key,
                Number.isFinite(value) ? value : null,
              ])
            ) as Record<keyof typeof plan.limits, number | null>,
          };
        }),
      };
    }),

    /**
     * Payment is not wired up yet: this records the intent and leaves the
     * workspace on its current plan. Swapping in a checkout session later only
     * changes this mutation.
     */
    requestUpgrade: workspaceProcedure
      .input(
        z.object({
          plan: z.enum(WORKSPACE_PLANS),
          note: z.string().trim().max(500).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (input.plan === ctx.workspace.plan) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Already on this plan",
          });
        }
        const request = await db.createPlanRequest({
          workspaceId: ctx.workspace.id,
          requestedBy: ctx.user.id,
          fromPlan: ctx.workspace.plan,
          toPlan: input.plan,
          note: input.note,
        });
        return { status: "pending" as const, toPlan: request.toPlan };
      }),

    cancelRequest: workspaceProcedure.mutation(async ({ ctx }) => {
      await db.cancelPlanRequest(ctx.workspace.id);
      return { success: true as const };
    }),
  }),

  // ============ Channels Router ============
  channels: router({
    list: workspaceProcedure.query(async ({ ctx }) => {
      const channels = await db.listWorkspaceChannels(ctx.workspace.id);
      const byProvider = new Map(
        channels.map(channel => [channel.provider, channel])
      );

      return {
        /** Public origin the webhook would be registered on. */
        webhookReady: isPublicWebhookUrl(ENV.appBaseUrl),
        publicChatUrl: `${ENV.appBaseUrl.replace(/\/+$/, "")}/a/${ctx.workspace.publicKey}`,
        providers: CHANNEL_PROVIDERS.map(info => {
          const channel = byProvider.get(info.provider);
          return {
            ...info,
            connection: channel ? toChannelDto(channel) : null,
            inviteUrl:
              info.provider === "telegram" && channel?.displayName?.startsWith("@")
                ? `https://t.me/${channel.displayName.slice(1)}`
                : null,
          };
        }),
      };
    }),

    connectTelegram: workspaceProcedure
      .input(
        z.object({
          botToken: z
            .string()
            .trim()
            .regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, "Bot Token 格式不正确"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await db.getWorkspaceChannel(
          ctx.workspace.id,
          "telegram"
        );
        // Reconnecting an existing channel does not consume another slot.
        if (!existing) {
          await assertWithinPlan(
            ctx.workspace.id,
            ctx.workspace.plan,
            "connectedChannels"
          );
        }

        let identity: Awaited<ReturnType<typeof telegramAdapter.verify>>;
        try {
          identity = await telegramAdapter.verify({ botToken: input.botToken });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof TelegramApiError
                ? error.message
                : "无法验证 Bot Token",
          });
        }

        const channel = await db.upsertWorkspaceChannel({
          workspaceId: ctx.workspace.id,
          provider: "telegram",
          status: "pending",
          displayName: identity.displayName,
          externalId: identity.externalId,
          credentials: { botToken: input.botToken },
        });

        try {
          const { deliveryMode } = await telegramAdapter.activate(channel);
          const connected = await db.updateWorkspaceChannel(channel.id, {
            status: "connected",
            deliveryMode,
            lastError: null,
          });
          return {
            channel: toChannelDto(connected ?? channel),
            inviteUrl: identity.inviteUrl ?? null,
            deliveryMode,
            webhookUrl:
              deliveryMode === "webhook"
                ? buildTelegramWebhookUrl(channel.webhookSecret)
                : null,
          };
        } catch (error) {
          const message =
            error instanceof TelegramApiError
              ? error.message
              : "接入 Telegram 失败";
          await db.updateWorkspaceChannel(channel.id, {
            status: "error",
            lastError: message,
          });
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
      }),

    setAutoReply: workspaceProcedure
      .input(
        z.object({
          provider: z.enum(["web", "telegram", "slack", "feishu"]),
          autoReply: z.boolean(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const channel = await db.getWorkspaceChannel(
          ctx.workspace.id,
          input.provider
        );
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        await db.updateWorkspaceChannel(channel.id, {
          autoReply: input.autoReply,
        });
        return { success: true as const };
      }),

    disconnect: workspaceProcedure
      .input(
        z.object({ provider: z.enum(["telegram", "slack", "feishu"]) })
      )
      .mutation(async ({ input, ctx }) => {
        const channel = await db.getWorkspaceChannel(
          ctx.workspace.id,
          input.provider
        );
        if (!channel) return { success: true as const };

        // Best effort: the local record must go even if the provider is down.
        await getChannelAdapter(input.provider)
          ?.deactivate(channel)
          .catch(() => undefined);
        await db.deleteWorkspaceChannel(ctx.workspace.id, input.provider);
        return { success: true as const };
      }),
  }),

  // ============ Inbox Router ============
  inbox: router({
    listContacts: workspaceProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
      .query(async ({ input, ctx }) =>
        db.listWorkspaceContacts(ctx.workspace.id, input?.limit ?? 50)
      ),

    getConversation: workspaceProcedure
      .input(
        z.object({
          contactId: z.number().int().positive(),
          limit: z.number().int().min(1).max(200).default(100),
        })
      )
      .query(async ({ input, ctx }) => {
        const contact = await db.getChannelContactById(
          input.contactId,
          ctx.workspace.id
        );
        if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
        const messages = await db.getContactMessages(contact.id, input.limit);
        return {
          contact,
          messages: messages.map(message => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
            agentRunId: message.agentRunId,
            relatedKnowledge: parseJsonValue<
              Array<{ id: number; title: string; category: string }>
            >(message.relatedKnowledgeSnapshot, []),
          })),
        };
      }),
  }),

  // ============ Tickets Router ============
  tickets: router({
    create: workspaceProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().min(1),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return db.createTicket({
          workspaceId: ctx.workspace.id,
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
        });
      }),

    getById: workspaceProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => getTicketForScope(input.id, ctx.scope)),

    list: workspaceProcedure
      .input(
        z.object({
          status: z.string().optional(),
          priority: z.string().optional(),
          search: z.string().optional(),
          limit: z.number().optional().default(20),
          offset: z.number().optional().default(0),
        })
      )
      .query(async ({ input, ctx }) => listTicketsForScope(input, ctx.scope)),

    update: workspaceProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          description: z.string().optional(),
          status: z
            .enum(["pending", "in_progress", "resolved", "closed"])
            .optional(),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
          assignedTo: z.number().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const ticket = await getTicketForScope(input.id, ctx.scope);

        const updateData: Parameters<typeof db.updateTicket>[1] = {};
        if (input.title !== undefined) updateData.title = input.title;
        if (input.description !== undefined)
          updateData.description = input.description;
        if (input.status !== undefined) {
          updateData.status = input.status;
          if (input.status === "resolved") {
            updateData.resolvedAt = new Date();
          }
        }
        if (input.priority !== undefined) updateData.priority = input.priority;
        if (input.assignedTo !== undefined)
          updateData.assignedTo = input.assignedTo;

        await db.updateTicket(input.id, updateData);

        if (input.status !== undefined && input.status !== ticket.status) {
          await db.addTicketNote({
            ticketId: input.id,
            userId: ctx.user.id,
            content: `Status changed from ${ticket.status} to ${input.status}`,
            noteType: "status_change",
          });
        }

        return { success: true };
      }),

    getNotes: workspaceProcedure
      .input(z.object({ ticketId: z.number() }))
      .query(async ({ input, ctx }) =>
        getTicketNotesForScope(input.ticketId, ctx.scope)
      ),

    getChatHistory: workspaceProcedure
      .input(
        z.object({
          ticketId: z.number(),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ input, ctx }) => {
        const history = await getTicketChatHistoryForScope(
          input.ticketId,
          input.limit,
          ctx.scope
        );
        return history.map(message => ({
          ...message,
          relatedKnowledgeIds: parseJsonValue<number[]>(
            message.relatedKnowledgeIds,
            []
          ),
          relatedKnowledge: parseJsonValue<
            Array<{
              id: number;
              title: string;
              category: string;
            }>
          >(message.relatedKnowledgeSnapshot, []),
        }));
      }),

    addNote: workspaceProcedure
      .input(
        z.object({
          ticketId: z.number(),
          content: z.string().min(1),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await getTicketForScope(input.ticketId, ctx.scope);
        await db.addTicketNote({
          ticketId: input.ticketId,
          userId: ctx.user.id,
          content: input.content,
          noteType: "comment",
        });
        return { success: true };
      }),

    getStats: workspaceProcedure.query(async ({ ctx }) =>
      db.getTicketStats(ctx.workspace.id)
    ),
  }),

  // ============ Knowledge Base Router ============
  knowledge: router({
    list: workspaceProcedure
      .input(
        z
          .object({
            securityStatus: z.enum(KNOWLEDGE_SECURITY_STATUSES).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) =>
        db.listKnowledgeEntries(ctx.workspace.id, {
          securityStatus: input?.securityStatus,
        })
      ),

    search: workspaceProcedure
      .input(
        z.object({
          query: z.string().min(1),
          limit: z.number().optional().default(5),
        })
      )
      .query(async ({ ctx, input }) =>
        db.searchKnowledgeByKeyword(ctx.workspace.id, input.query, input.limit)
      ),

    getByCategory: workspaceProcedure
      .input(z.object({ category: z.string() }))
      .query(async ({ input, ctx }) => {
        const entries = await db.getKnowledgeByCategory(
          ctx.workspace.id,
          input.category
        );
        return entries.map(toSafeKnowledgeDto);
      }),

    add: workspaceProcedure
      .input(
        z.object({
          title: z.string().min(1),
          content: z.string().min(1),
          category: z.string().min(1),
          keywords: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertWithinPlan(
          ctx.workspace.id,
          ctx.workspace.plan,
          "knowledgeEntries"
        );
        const scan = scanKnowledgeContent(input);
        const entry = await db.addKnowledgeEntry({
          ...input,
          workspaceId: ctx.workspace.id,
          securityStatus: scan.status,
          securityScannerVersion: scan.scannerVersion,
          securityContentHash: scan.contentHash,
          securityFindings: scan.findings,
          securityScore: scan.securityScore,
          securityScannedAt: new Date(),
        });
        if (scan.status === "approved") {
          try {
            await reindexKnowledgeEntry(entry.id, ctx.workspace.id);
          } catch {
            // The entry is saved; embedding can be retried from the list page.
          }
        }
        return entry;
      }),

    updateEntry: workspaceProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1),
          content: z.string().min(1),
          category: z.string().min(1),
          keywords: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await db.getKnowledgeEntryById(
          input.id,
          ctx.workspace.id
        );
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        const scan = scanKnowledgeContent(input);
        await db.updateKnowledgeEntry(input.id, {
          title: input.title,
          content: input.content,
          category: input.category,
          keywords: input.keywords?.trim() ? input.keywords : null,
          embedding: null,
          embeddingStatus: scan.status === "approved" ? "pending" : "blocked",
          conflictWith: null,
          conflictScore: null,
          securityStatus: scan.status,
          securityScannerVersion: scan.scannerVersion,
          securityContentHash: scan.contentHash,
          securityFindings: scan.findings,
          securityScore: scan.securityScore,
          securityScannedAt: new Date(),
          securityReviewedAt: null,
          securityReviewedBy: null,
          securityReviewReason: null,
        });
        await db.appendKnowledgeSecurityEvent({
          knowledgeId: input.id,
          action: "scan",
          toStatus: scan.status,
          scannerVersion: scan.scannerVersion,
          contentHash: scan.contentHash,
          findings: scan.findings,
          securityScore: scan.securityScore,
          actorUserId: ctx.user.id,
        });
        if (scan.status === "approved") {
          try {
            await reindexKnowledgeEntry(input.id, ctx.workspace.id);
          } catch {
            // Keep edited content even if embedding is unavailable.
          }
        }
        return { success: true, securityStatus: scan.status };
      }),

    review: workspaceProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          decision: z.enum(["approve", "reject"]),
          reason: z.string().trim().min(3).max(2_000),
          expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const entry = await db.getKnowledgeEntryById(
          input.id,
          ctx.workspace.id
        );
        if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
        const scan = scanKnowledgeContent(entry);
        if (scan.contentHash !== input.expectedContentHash) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "知识内容已发生变化，请刷新后重新审核",
          });
        }
        const result = await db.applyKnowledgeSecurityDecision({
          knowledgeId: input.id,
          expectedContentHash: input.expectedContentHash,
          toStatus: input.decision === "approve" ? "approved" : "rejected",
          reason: input.reason,
          actorUserId: ctx.user.id,
          scannerVersion: scan.scannerVersion,
          findings: scan.findings,
          securityScore: scan.securityScore,
        });
        if (result.outcome === "not_found") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (result.outcome === "content_changed") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "知识内容已发生变化，请刷新后重新审核",
          });
        }
        if (result.entry.documentId != null) {
          await db.refreshKnowledgeDocumentSecurityCounts(
            result.entry.documentId
          );
        }
        if (result.entry.securityStatus === "approved") {
          try {
            await reindexKnowledgeEntry(result.entry.id, ctx.workspace.id);
          } catch {
            // Approval persists; embedding can be retried later.
          }
        }
        return result.entry;
      }),

    rescan: workspaceProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const entry = await db.getKnowledgeEntryById(
          input.id,
          ctx.workspace.id
        );
        if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
        const scan = scanKnowledgeContent(entry);
        await db.updateKnowledgeEntry(entry.id, {
          securityStatus: scan.status,
          securityScannerVersion: scan.scannerVersion,
          securityContentHash: scan.contentHash,
          securityFindings: scan.findings,
          securityScore: scan.securityScore,
          securityScannedAt: new Date(),
          securityReviewedAt: null,
          securityReviewedBy: null,
          securityReviewReason: null,
          embedding: null,
          embeddingStatus: scan.status === "approved" ? "pending" : "blocked",
        });
        await db.appendKnowledgeSecurityEvent({
          knowledgeId: entry.id,
          documentId: entry.documentId,
          action: "rescan",
          fromStatus: entry.securityStatus,
          toStatus: scan.status,
          scannerVersion: scan.scannerVersion,
          contentHash: scan.contentHash,
          findings: scan.findings,
          securityScore: scan.securityScore,
          actorUserId: ctx.user.id,
        });
        if (entry.documentId != null) {
          await db.refreshKnowledgeDocumentSecurityCounts(entry.documentId);
        }
        if (scan.status === "approved") {
          try {
            await reindexKnowledgeEntry(entry.id, ctx.workspace.id);
          } catch {
            // Rescan succeeds even if embedding is temporarily unavailable.
          }
        }
        return scan;
      }),

    securityHistory: workspaceProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        const entry = await db.getKnowledgeEntryById(
          input.id,
          ctx.workspace.id
        );
        if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
        return db.getKnowledgeSecurityHistory(input.id);
      }),

    reindexEntry: workspaceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) =>
        reindexKnowledgeEntry(input.id, ctx.workspace.id)
      ),

    debugSearch: workspaceProcedure
      .input(
        z.object({
          query: z.string().min(1),
          limit: z.number().optional().default(5),
        })
      )
      .query(async ({ ctx, input }) =>
        db.debugSearchKnowledge(ctx.workspace.id, input.query, input.limit)
      ),

    uploadCapabilities: workspaceProcedure.query(() => {
      const storageConfigured = isKnowledgeStorageConfigured();
      const queueConfigured = isKnowledgeQueueConfigured();
      return {
        multipartEnabled: storageConfigured && queueConfigured,
        storageConfigured,
        queueConfigured,
      };
    }),

    createUploadSession: workspaceProcedure
      .input(
        z.object({
          filename: z.string().min(1).max(255),
          fileType: z.enum(["markdown", "csv"]),
          fileSize: z.number().int().positive().safe(),
          contentType: z.string().max(128).optional(),
          category: z.string().max(128).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (!isKnowledgeStorageConfigured() || !isKnowledgeQueueConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "对象存储或任务队列尚未配置",
          });
        }
        const uploadPartSize = calculateMultipartPartSize(input.fileSize);
        const document = await db.createKnowledgeDocument({
          workspaceId: ctx.workspace.id,
          filename: input.filename,
          fileType: input.fileType,
          uploadedBy: ctx.user.id,
          status: "uploading",
          fileSize: input.fileSize,
          uploadPartSize,
          contentType: input.contentType,
          category: input.category?.trim() || undefined,
        });
        let upload: { objectKey: string; uploadId: string } | null = null;
        try {
          upload = await createMultipartUpload({
            documentId: document.id,
            filename: input.filename,
            contentType: input.contentType,
          });
          await db.updateKnowledgeDocument(document.id, {
            objectKey: upload.objectKey,
            uploadId: upload.uploadId,
          });
          return {
            documentId: document.id,
            uploadVersion: 1,
            partSize: uploadPartSize,
            partCount: Math.ceil(input.fileSize / uploadPartSize),
          };
        } catch (error) {
          if (upload) {
            await abortMultipartUpload(upload).catch(() => undefined);
          }
          await db.updateKnowledgeDocument(document.id, {
            status: "failed",
            failureStage: "upload",
            error: error instanceof Error ? error.message : "创建上传会话失败",
          });
          throw error;
        }
      }),

    getUploadSession: workspaceProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        const document = await getOwnedDocument(input.id, ctx.workspace.id);
        return {
          id: document.id,
          filename: document.filename,
          fileSize: document.fileSize,
          status: document.status,
          partSize: document.uploadPartSize,
          uploadVersion: document.uploadVersion,
          resumable: Boolean(
            document.objectKey &&
              document.uploadId &&
              document.status === "uploading"
          ),
        };
      }),

    getUploadPartUrls: workspaceProcedure
      .input(
        z.object({
          documentId: z.number().int().positive(),
          partNumbers: z
            .array(z.number().int().min(1).max(10_000))
            .min(1)
            .max(20),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const document = await getOwnedDocument(
          input.documentId,
          ctx.workspace.id
        );
        if (
          document.status !== "uploading" ||
          !document.objectKey ||
          !document.uploadId
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "上传会话不存在或已结束",
          });
        }
        const partNumbers = Array.from(new Set(input.partNumbers)).sort(
          (a, b) => a - b
        );
        const expectedCount =
          document.fileSize && document.uploadPartSize
            ? Math.ceil(document.fileSize / document.uploadPartSize)
            : 0;
        if (
          expectedCount === 0 ||
          partNumbers.some(partNumber => partNumber > expectedCount)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "文件分片编号超出上传会话范围",
          });
        }
        return createUploadPartUrls({
          objectKey: document.objectKey,
          uploadId: document.uploadId,
          partNumbers,
        });
      }),

    listUploadedParts: workspaceProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const document = await getOwnedDocument(
          input.documentId,
          ctx.workspace.id
        );
        if (!document.objectKey || !document.uploadId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return listMultipartParts({
          objectKey: document.objectKey,
          uploadId: document.uploadId,
        });
      }),

    completeUpload: workspaceProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const document = await getOwnedDocument(
          input.documentId,
          ctx.workspace.id
        );
        if (!document.objectKey) throw new TRPCError({ code: "NOT_FOUND" });

        if (document.status === "uploading") {
          if (
            !document.uploadId ||
            !document.fileSize ||
            !document.uploadPartSize
          ) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "上传会话数据不完整",
            });
          }
          const expectedCount = Math.ceil(
            document.fileSize / document.uploadPartSize
          );
          let uploadedBytes = 0;
          try {
            const parts = await listMultipartParts({
              objectKey: document.objectKey,
              uploadId: document.uploadId,
            });
            uploadedBytes = parts.reduce((sum, part) => sum + part.size, 0);
            const contiguous = parts.every(
              (part, index) => part.partNumber === index + 1
            );
            if (
              !contiguous ||
              parts.length !== expectedCount ||
              uploadedBytes !== document.fileSize
            ) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `文件分片不完整：${parts.length}/${expectedCount}，${uploadedBytes}/${document.fileSize} 字节`,
              });
            }
            await completeMultipartUpload({
              objectKey: document.objectKey,
              uploadId: document.uploadId,
              parts,
            });
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            const storedSize = await getStoredDocumentSize(
              document.objectKey
            ).catch(() => 0);
            if (storedSize !== document.fileSize) throw error;
            uploadedBytes = storedSize;
          }
          await db.updateKnowledgeDocument(document.id, {
            status: "uploaded",
            uploadId: null,
            uploadedBytes,
            failureStage: null,
            error: null,
          });
        } else if (document.status !== "uploaded") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "文档已经结束上传或进入处理队列",
          });
        }

        await enqueueKnowledgeParse({
          documentId: document.id,
          uploadVersion: document.uploadVersion,
        });
        await db.updateKnowledgeDocumentStatusIfCurrent(
          document.id,
          "uploaded",
          {
            status: "parse_queued",
            failureStage: null,
            error: null,
          }
        );
        return { documentId: document.id, status: "parse_queued" as const };
      }),

    abortUpload: workspaceProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const document = await getOwnedDocument(
          input.documentId,
          ctx.workspace.id
        );
        if (document.objectKey && document.uploadId) {
          await abortMultipartUpload({
            objectKey: document.objectKey,
            uploadId: document.uploadId,
          });
        }
        await db.updateKnowledgeDocument(document.id, {
          status: "cancelled",
          uploadId: null,
          failureStage: null,
          error: null,
        });
        return { success: true };
      }),

    /** Inline import used when object storage is not configured. */
    uploadDocument: workspaceProcedure
      .input(
        z.object({
          filename: z.string().min(1).max(255),
          fileType: z.enum(["markdown", "csv"]),
          content: z.string().min(1),
          category: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertWithinPlan(
          ctx.workspace.id,
          ctx.workspace.plan,
          "knowledgeEntries"
        );
        return ingestDocument({
          workspaceId: ctx.workspace.id,
          filename: input.filename,
          fileType: input.fileType,
          content: input.content,
          category: input.category,
          userId: ctx.user.id,
        });
      }),

    listDocuments: workspaceProcedure.query(async ({ ctx }) =>
      db.listKnowledgeDocuments(ctx.workspace.id)
    ),

    deleteDocument: workspaceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const document = await db.getKnowledgeDocument(input.id);
        if (!document || document.workspaceId !== ctx.workspace.id) {
          return { success: true };
        }
        if (document.objectKey && document.uploadId) {
          await abortMultipartUpload({
            objectKey: document.objectKey,
            uploadId: document.uploadId,
          });
        } else if (document.objectKey && isKnowledgeStorageConfigured()) {
          await deleteStoredDocument(document.objectKey);
        }
        await db.deleteKnowledgeDocument(input.id);
        return { success: true };
      }),

    deleteEntry: workspaceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const entry = await db.getKnowledgeEntryById(
          input.id,
          ctx.workspace.id
        );
        if (!entry) return { success: true };
        await db.deleteKnowledgeEntry(input.id);
        return { success: true };
      }),
  }),

  // ============ Chat Router ============
  chat: router({
    /**
     * Blocking single-turn ask used by the onboarding preview. The full console
     * chat streams over SSE; the wizard only needs one answer and skipping the
     * stream keeps that step to a few lines of state.
     */
    ask: workspaceProcedure
      .input(z.object({ content: z.string().trim().min(1).max(2_000) }))
      .mutation(async ({ input, ctx }) => {
        try {
          const response = await createAgentChatResponse({
            scope: ctx.scope,
            content: input.content,
          });
          return {
            runId: response.runId,
            reply: response.assistantMessage,
            relatedKnowledge: response.relatedKnowledge,
            retrieval: response.retrieval,
          };
        } catch (error) {
          if (error instanceof TokenQuotaExceededError) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: error.message,
              cause: { code: TOKEN_QUOTA_EXCEEDED_CODE, quota: error.quota },
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "智能客服暂时无法回答",
          });
        }
      }),

    getHistory: workspaceProcedure
      .input(
        z.object({
          ticketId: z.number().optional(),
          limit: z.number().optional().default(50),
        })
      )
      .query(async ({ input, ctx }) => {
        const history = await getChatHistoryForScope(
          input.ticketId,
          input.limit,
          ctx.scope
        );
        const runIds: string[] = Array.from(
          new Set(
            history
              .map(message => message.agentRunId)
              .filter((id): id is string => Boolean(id))
          )
        );
        const runById = new Map(
          (await db.getAgentRunSummaries(runIds)).map(run => [run.id, run])
        );
        const ids = history.flatMap(message =>
          parseJsonValue<number[]>(message.relatedKnowledgeIds, [])
        );
        const knowledgeById = new Map(
          (await db.getKnowledgeByIds(ctx.workspace.id, ids)).map(entry => [
            entry.id,
            entry,
          ])
        );

        return history.map(message => {
          const snapshot = parseJsonValue<
            Array<{
              id: number;
              title: string;
              category: string;
            }>
          >(message.relatedKnowledgeSnapshot, []);
          const relatedKnowledgeIds = parseJsonValue<number[]>(
            message.relatedKnowledgeIds,
            []
          );
          const relatedKnowledge =
            snapshot.length > 0
              ? snapshot
              : relatedKnowledgeIds
                  .map(id => knowledgeById.get(id))
                  .filter(Boolean)
                  .map(kb => ({
                    id: kb!.id,
                    title: kb!.title,
                    category: kb!.category,
                  }));

          return {
            ...message,
            relatedKnowledgeIds,
            relatedKnowledge,
            runStats: message.agentRunId
              ? (runById.get(message.agentRunId) ?? null)
              : null,
          };
        });
      }),
  }),

  // ============ Agent Runs Router ============
  agentRuns: router({
    getTokenQuota: workspaceProcedure.query(async ({ ctx }) =>
      db.getTokenQuota(ctx.user.id, ctx.workspace.plan)
    ),

    getById: workspaceProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) =>
        getAgentRunForWorkspace(input.id, ctx.workspace.id)
      ),

    listActive: workspaceProcedure.query(async ({ ctx }) => {
      const runs = await db.listActiveAgentRunsForWorkspace(ctx.workspace.id);
      return runs.map(run => ({
        runId: run.id,
        status: run.status,
        input: run.input,
        ticketId: run.ticketId,
        createdAt: run.createdAt,
      }));
    }),

    summarizeRecentTickets: workspaceProcedure
      .input(
        z
          .object({
            search: z.string().min(1).max(100).optional(),
            limit: z.number().int().min(1).max(10).default(5),
          })
          .optional()
      )
      .mutation(async ({ input, ctx }) => {
        const query = input?.search
          ? `请查询并总结最近与“${input.search}”相关的工单，给出状态、风险等级和建议下一步动作。`
          : `请查询并总结我最近 ${input?.limit ?? 5} 个工单，给出状态、风险等级和建议下一步动作。`;

        return createAgentChatResponse({ scope: ctx.scope, content: query });
      }),

    retry: workspaceProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          content: z.string().trim().min(1).max(10_000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existingRun = await getAgentRunRecordForWorkspace(
          input.id,
          ctx.workspace.id
        );

        try {
          const run = await enqueueAgentRun({
            scope: {
              workspaceId: existingRun.workspaceId,
              ownerUserId: existingRun.userId,
              contactId: existingRun.contactId,
              channelId: existingRun.channelId,
            },
            ticketId: existingRun.ticketId ?? undefined,
            content: input.content ?? existingRun.input,
            retryOfRunId: existingRun.id,
          });
          return { runId: run.id, quota: run.quota };
        } catch (error) {
          if (error instanceof TokenQuotaExceededError) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: error.message,
              cause: {
                code: TOKEN_QUOTA_EXCEEDED_CODE,
                quota: error.quota,
              },
            });
          }
          throw error;
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
