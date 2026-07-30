import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { parseJsonValue } from "./agentUtils";
import { createAgentChatResponse } from "./agentService";
import { enqueueAgentRun } from "./agentRunExecution";
import { ingestDocument } from "./knowledge/ingest";
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
  isDemoAdminConfigured,
  loginAsDemoAdmin,
  loginWithPassword,
  registerWithPassword,
  revokeRequestSession,
  toPublicUser,
} from "./_core/auth";
import { isGoogleOAuthConfigured } from "./_core/googleOAuth";
import {
  getAgentRunForUser,
  getAgentRunRecordForUser,
  getChatHistoryForUser,
  getTicketChatHistoryForUser,
  getTicketForUser,
  getTicketNotesForUser,
  listTicketsForUser,
} from "./accessControl";
import {
  buildKnowledgeEmbeddingInput,
  createEmbedding,
  isEmbeddingEnabled,
} from "./_core/embeddings";

const reindexKnowledgeEntry = async (id: number) => {
  const entry = await db.getKnowledgeEntryById(id);
  if (!entry) throw new Error("Knowledge entry not found");

  if (!isEmbeddingEnabled()) {
    await db.updateKnowledgeEntry(id, {
      embedding: null,
      embeddingStatus: "completed",
      conflictWith: null,
      conflictScore: null,
    });
    const conflict = await db.detectEntryConflict({
      id: entry.id,
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

export const appRouter = router({
  auth: router({
    providers: publicProcedure.query(() => ({
      google: isGoogleOAuthConfigured(),
      demoAdmin: isDemoAdminConfigured(),
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
    demoAdminLogin: publicProcedure.mutation(async ({ ctx }) => {
      try {
        return await loginAsDemoAdmin(ctx.req, ctx.res);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          error.statusCode === 403
        ) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "管理员演示入口暂不可用，请改用账号密码登录",
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

  // ============ Tickets Router ============
  tickets: router({
    // 创建工单
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().min(1),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const result = await db.createTicket({
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
        });
        return result;
      }),

    // 获取工单详情
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        return getTicketForUser(input.id, ctx.user);
      }),

    // 列表工单（支持筛选和搜索）
    list: protectedProcedure
      .input(
        z.object({
          status: z.string().optional(),
          priority: z.string().optional(),
          search: z.string().optional(),
          limit: z.number().optional().default(20),
          offset: z.number().optional().default(0),
        })
      )
      .query(async ({ input, ctx }) => {
        return listTicketsForUser(input, ctx.user);
      }),

    // 更新工单
    update: protectedProcedure
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
        const ticket = await getTicketForUser(input.id, ctx.user);

        const updateData: any = {};
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

        // 记录状态变更
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

    // 获取工单备注历史
    getNotes: protectedProcedure
      .input(z.object({ ticketId: z.number() }))
      .query(async ({ input, ctx }) => {
        return getTicketNotesForUser(input.ticketId, ctx.user);
      }),

    getChatHistory: protectedProcedure
      .input(
        z.object({
          ticketId: z.number(),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ input, ctx }) => {
        const history = await getTicketChatHistoryForUser(
          input.ticketId,
          input.limit,
          ctx.user
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

    // 添加工单备注
    addNote: protectedProcedure
      .input(
        z.object({
          ticketId: z.number(),
          content: z.string().min(1),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await getTicketForUser(input.ticketId, ctx.user);
        await db.addTicketNote({
          ticketId: input.ticketId,
          userId: ctx.user.id,
          content: input.content,
          noteType: "comment",
        });
        return { success: true };
      }),

    // 获取工单统计（仅管理员）
    getStats: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized");
      }
      return await db.getTicketStats();
    }),
  }),

  // ============ Knowledge Base Router ============
  knowledge: router({
    // 获取知识库列表（仅管理员）
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized");
      }
      return await db.listKnowledgeEntries();
    }),

    // 搜索知识库（仅管理员）
    search: protectedProcedure
      .input(
        z.object({
          query: z.string().min(1),
          limit: z.number().optional().default(5),
        })
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        return await db.searchKnowledgeByKeyword(input.query, input.limit);
      }),

    // 按分类获取知识库
    getByCategory: publicProcedure
      .input(z.object({ category: z.string() }))
      .query(async ({ input }) => {
        return await db.getKnowledgeByCategory(input.category);
      }),

    // 添加知识库条目（仅管理员）
    add: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          content: z.string().min(1),
          category: z.string().min(1),
          keywords: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        const entry = await db.addKnowledgeEntry(input);
        try {
          await reindexKnowledgeEntry(entry.id);
        } catch {
          // The mutation still succeeds so admins can fix embedding service later.
        }
        return entry;
      }),

    // 编辑知识库条目（仅管理员）
    updateEntry: protectedProcedure
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
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        await db.updateKnowledgeEntry(input.id, {
          title: input.title,
          content: input.content,
          category: input.category,
          keywords: input.keywords?.trim() ? input.keywords : null,
          embedding: null,
          embeddingStatus: "pending",
          conflictWith: null,
          conflictScore: null,
        });
        try {
          await reindexKnowledgeEntry(input.id);
        } catch {
          // Keep edited content even if embedding service is unavailable.
        }
        return { success: true };
      }),

    // 重新生成单条 embedding（仅管理员）
    reindexEntry: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        return reindexKnowledgeEntry(input.id);
      }),

    // RAG 调试：返回召回模式、分数、fallback 原因（仅管理员）
    debugSearch: protectedProcedure
      .input(
        z.object({
          query: z.string().min(1),
          limit: z.number().optional().default(5),
        })
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        return db.debugSearchKnowledge(input.query, input.limit);
      }),

    // 上传文档（Markdown/CSV），解析为知识条目并后台向量化（仅管理员）
    uploadCapabilities: protectedProcedure.query(({ ctx }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");
      const storageConfigured = isKnowledgeStorageConfigured();
      const queueConfigured = isKnowledgeQueueConfigured();
      return {
        multipartEnabled: storageConfigured && queueConfigured,
        storageConfigured,
        queueConfigured,
      };
    }),

    createUploadSession: protectedProcedure
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
        if (ctx.user.role !== "admin") throw new Error("Unauthorized");
        if (!isKnowledgeStorageConfigured() || !isKnowledgeQueueConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "对象存储或任务队列尚未配置",
          });
        }
        const uploadPartSize = calculateMultipartPartSize(input.fileSize);
        const document = await db.createKnowledgeDocument({
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

    getUploadSession: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new Error("Unauthorized");
        const document = await db.getKnowledgeDocument(input.id);
        if (!document || document.uploadedBy !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
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

    getUploadPartUrls: protectedProcedure
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
        if (ctx.user.role !== "admin") throw new Error("Unauthorized");
        const document = await db.getKnowledgeDocument(input.documentId);
        if (
          !document ||
          document.uploadedBy !== ctx.user.id ||
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

    listUploadedParts: protectedProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new Error("Unauthorized");
        const document = await db.getKnowledgeDocument(input.documentId);
        if (
          !document ||
          document.uploadedBy !== ctx.user.id ||
          !document.objectKey ||
          !document.uploadId
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return listMultipartParts({
          objectKey: document.objectKey,
          uploadId: document.uploadId,
        });
      }),

    completeUpload: protectedProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new Error("Unauthorized");
        const document = await db.getKnowledgeDocument(input.documentId);
        if (
          !document ||
          document.uploadedBy !== ctx.user.id ||
          !document.objectKey
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

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

    abortUpload: protectedProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new Error("Unauthorized");
        const document = await db.getKnowledgeDocument(input.documentId);
        if (!document || document.uploadedBy !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
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

    // 兼容未配置对象存储的本地环境；生产的大文件上传不使用此接口。
    uploadDocument: protectedProcedure
      .input(
        z.object({
          filename: z.string().min(1).max(255),
          fileType: z.enum(["markdown", "csv"]),
          content: z.string().min(1),
          category: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        return await ingestDocument({
          filename: input.filename,
          fileType: input.fileType,
          content: input.content,
          category: input.category,
          userId: ctx.user.id,
        });
      }),

    // 文档列表（含解析状态与索引进度，仅管理员）
    listDocuments: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized");
      }
      return await db.listKnowledgeDocuments();
    }),

    // 删除文档及其生成的全部知识条目（仅管理员）
    deleteDocument: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        const document = await db.getKnowledgeDocument(input.id);
        if (!document) return { success: true };
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

    // 删除单条知识条目（仅管理员）
    deleteEntry: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized");
        }
        await db.deleteKnowledgeEntry(input.id);
        return { success: true };
      }),
  }),

  // ============ Chat Router ============
  chat: router({
    // 获取聊天历史
    getHistory: protectedProcedure
      .input(
        z.object({
          ticketId: z.number().optional(),
          limit: z.number().optional().default(50),
        })
      )
      .query(async ({ input, ctx }) => {
        const history = await getChatHistoryForUser(
          input.ticketId,
          input.limit,
          ctx.user
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
          (await db.getKnowledgeByIds(ids)).map(entry => [entry.id, entry])
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
    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        return getAgentRunForUser(input.id, ctx.user);
      }),

    summarizeRecentTickets: protectedProcedure
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

        return createAgentChatResponse({
          userId: ctx.user.id,
          userRole: ctx.user.role,
          content: query,
        });
      }),

    retry: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const existingRun = await getAgentRunRecordForUser(input.id, ctx.user);

        const run = await enqueueAgentRun({
          userId: existingRun.userId,
          ticketId: existingRun.ticketId ?? undefined,
          content: existingRun.input,
          retryOfRunId: existingRun.id,
        });
        return { runId: run.id };
      }),
  }),
});

export type AppRouter = typeof appRouter;
