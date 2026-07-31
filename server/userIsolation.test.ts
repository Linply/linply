import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  addTicketNote: vi.fn(),
  getAgentRunById: vi.fn(),
  getAgentRunSummaries: vi.fn(),
  getAgentRunWithSteps: vi.fn(),
  getTokenQuota: vi.fn(),
  getChatHistory: vi.fn(),
  getKnowledgeByIds: vi.fn(),
  getRecentChatHistory: vi.fn(),
  getTicketById: vi.fn(),
  getTicketChatHistory: vi.fn(),
  getTicketNotes: vi.fn(),
  listTickets: vi.fn(),
  updateTicket: vi.fn(),
}));

vi.mock("./agentService", () => ({
  createAgentChatResponse: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

const mockedDb = vi.mocked(db);

const userA = {
  id: 101,
  email: "user-a@example.local",
  name: "User A",
  role: "user" as const,
  avatarUrl: null,
  emailVerifiedAt: null,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const ticketB = {
  id: 9001,
  userId: 202,
  title: "B 的工单",
  description: "仅 B 可见",
  status: "pending" as const,
  priority: "high" as const,
  assignedTo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  resolvedAt: null,
};

const runB = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: 202,
  ticketId: ticketB.id,
  status: "completed" as const,
  input: "查询 B 的工单",
  finalOutput: "B 的答案",
  error: null,
  llmProvider: "openai",
  llmModel: "test-model",
  retryOfRunId: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: new Date(),
};

const createContext = (user = userA): TrpcContext => ({
  user,
  req: { protocol: "http", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});

describe("user resource isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.getTicketById.mockResolvedValue(ticketB);
    mockedDb.getAgentRunWithSteps.mockResolvedValue({
      ...runB,
      steps: [],
    });
    mockedDb.getAgentRunById.mockResolvedValue(runB);
    mockedDb.getAgentRunSummaries.mockResolvedValue([]);
    mockedDb.getTokenQuota.mockResolvedValue({
      bucketDate: "2026-07-30",
      resetAt: "2026-07-31T00:00:00.000Z",
      quotaLimitTokens: 0,
      reservedTokens: 0,
      usedTokens: 0,
      remainingTokens: null,
      enforced: false,
      adminExempt: false,
    });
  });

  it("rejects A from every ticket and chat history endpoint for B's ticket", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.tickets.getById({ id: ticketB.id }))
      .rejects.toThrow("Unauthorized");
    await expect(caller.tickets.getNotes({ ticketId: ticketB.id }))
      .rejects.toThrow("Unauthorized");
    await expect(caller.tickets.getChatHistory({ ticketId: ticketB.id }))
      .rejects.toThrow("Unauthorized");
    await expect(caller.tickets.update({ id: ticketB.id, title: "篡改" }))
      .rejects.toThrow("Unauthorized");
    await expect(caller.tickets.addNote({
      ticketId: ticketB.id,
      content: "A 不应写入",
    })).rejects.toThrow("Unauthorized");
    await expect(caller.chat.getHistory({ ticketId: ticketB.id }))
      .rejects.toThrow("Unauthorized");
    expect(mockedDb.getTicketNotes).not.toHaveBeenCalled();
    expect(mockedDb.getTicketChatHistory).not.toHaveBeenCalled();
    expect(mockedDb.getChatHistory).not.toHaveBeenCalled();
    expect(mockedDb.updateTicket).not.toHaveBeenCalled();
    expect(mockedDb.addTicketNote).not.toHaveBeenCalled();
  });

  it("pushes A's identity into ticket list queries", async () => {
    mockedDb.listTickets.mockImplementation(async filters => {
      return filters?.userId === userA.id ? [] : [ticketB];
    });

    const caller = appRouter.createCaller(createContext());
    const tickets = await caller.tickets.list({});

    expect(tickets).toEqual([]);
    expect(mockedDb.listTickets).toHaveBeenCalledWith({
      status: undefined,
      priority: undefined,
      search: undefined,
      limit: 20,
      offset: 0,
      userId: userA.id,
    });
  });

  it("pushes A's identity into unscoped chat history queries", async () => {
    mockedDb.getChatHistory.mockResolvedValue([]);
    mockedDb.getKnowledgeByIds.mockResolvedValue([]);

    const caller = appRouter.createCaller(createContext());
    await expect(caller.chat.getHistory({})).resolves.toEqual([]);

    expect(mockedDb.getChatHistory).toHaveBeenCalledWith(userA.id, undefined, 50);
    expect(mockedDb.getAgentRunSummaries).toHaveBeenCalledWith([]);
  });

  it("returns the caller's current UTC token quota snapshot", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.agentRuns.getTokenQuota()).resolves.toMatchObject({
      bucketDate: "2026-07-30",
      resetAt: "2026-07-31T00:00:00.000Z",
      enforced: false,
    });
    expect(mockedDb.getTokenQuota).toHaveBeenCalledWith(userA.id, userA.role);
  });

  it("rejects A from B's Agent Run detail and retry endpoints", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.agentRuns.getById({ id: runB.id }))
      .rejects.toThrow("Unauthorized");
    await expect(caller.agentRuns.retry({ id: runB.id }))
      .rejects.toThrow("Unauthorized");

    expect(mockedDb.getAgentRunWithSteps).toHaveBeenCalledWith(runB.id);
    expect(mockedDb.getAgentRunById).toHaveBeenCalledWith(runB.id);
  });
});
