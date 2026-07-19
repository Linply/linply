import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getTicketById: vi.fn(),
  getRecentChatHistory: vi.fn(),
  saveChatMessage: vi.fn(),
  searchKnowledgeWithMeta: vi.fn(),
}));

vi.mock("./_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/llm")>();
  return {
    ...actual,
    invokeLLM: vi.fn(),
  };
});

import * as db from "./db";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { appRouter } from "./routers";

const mockedDb = vi.mocked(db);
const mockedInvokeLLM = vi.mocked(invokeLLM);

const user = {
  id: 11,
  email: "user11@example.local",
  name: "User 11",
  role: "user" as const,
  avatarUrl: null,
  emailVerifiedAt: null,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const createContext = (): TrpcContext => ({
  user,
  req: { protocol: "http", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});

describe("chat.sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.chatMode = "rag";
    ENV.llmProvider = "openai";

    mockedDb.getTicketById.mockResolvedValue({
      id: 99,
      userId: 11,
      title: "订单物流异常",
      description: "物流未更新",
      status: "pending",
      priority: "high",
      assignedTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    });

    mockedDb.getRecentChatHistory.mockResolvedValue([
      { role: "user", content: "之前问过物流" },
      { role: "assistant", content: "可以查询发货时间" },
    ]);
    mockedDb.searchKnowledgeWithMeta.mockResolvedValue({
      entries: [
        {
          id: 3,
          title: "订单发货时间",
          content: "订单确认后通常在1-2个工作日内发货。",
          category: "物流",
          keywords: "发货,快递",
          embedding: null,
          embeddingStatus: "completed",
          documentId: null,
          conflictWith: null,
          conflictScore: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      retrieval: {
        mode: "vector",
        degraded: false,
        fallbackReason: null,
      },
    });
    mockedDb.saveChatMessage.mockResolvedValue({} as never);
    mockedInvokeLLM.mockResolvedValue({
      id: "resp_test",
      created: 1,
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "订单通常在 1-2 个工作日内发货。\n参考：订单发货时间",
          },
          finish_reason: "stop",
        },
      ],
    });
  });

  it("retrieves knowledge, invokes the model, and persists user and assistant messages", async () => {
    const caller = appRouter.createCaller(createContext());

    const result = await caller.chat.sendMessage({
      content: "我的订单多久发货？",
      ticketId: 99,
    });

    expect(mockedDb.searchKnowledgeWithMeta).toHaveBeenCalledWith(
      "我的订单多久发货？",
      3
    );
    expect(mockedInvokeLLM).toHaveBeenCalledWith({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("订单发货时间"),
        }),
        expect.objectContaining({ role: "user", content: "我的订单多久发货？" }),
      ]),
    });
    expect(mockedDb.saveChatMessage).toHaveBeenNthCalledWith(1, {
      ticketId: 99,
      userId: 11,
      role: "user",
      content: "我的订单多久发货？",
    });
    expect(mockedDb.saveChatMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ticketId: 99,
        userId: 11,
        role: "assistant",
        relatedKnowledgeIds: [3],
        relatedKnowledgeSnapshot: [
          { id: 3, title: "订单发货时间", category: "物流" },
        ],
        llmProvider: "openai",
        llmModel: "gpt-test",
      })
    );
    expect(result).toMatchObject({
      assistantMessage: expect.stringContaining("1-2 个工作日"),
      relatedKnowledge: [{ id: 3, title: "订单发货时间", category: "物流" }],
      retrieval: {
        mode: "vector",
        degraded: false,
        fallbackReason: null,
      },
      llmProvider: "openai",
      llmModel: "gpt-test",
    });
  });

  it("rejects a ticket owned by another user before reading chat data", async () => {
    mockedDb.getTicketById.mockResolvedValueOnce({
      id: 99,
      userId: 12,
      title: "其他用户工单",
      description: "不可访问",
      status: "pending",
      priority: "medium",
      assignedTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    });

    const caller = appRouter.createCaller(createContext());
    await expect(caller.chat.sendMessage({
      content: "查看工单",
      ticketId: 99,
    })).rejects.toThrow("Unauthorized");

    expect(mockedDb.getRecentChatHistory).not.toHaveBeenCalled();
    expect(mockedDb.saveChatMessage).not.toHaveBeenCalled();
  });
});
