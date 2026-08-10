import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  addTicketNote: vi.fn(),
  createWorkspaceForOwner: vi.fn(),
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
  getWorkspaceByOwner: vi.fn(),
  getWorkspacePlanUsage: vi.fn(),
  listTickets: vi.fn(),
  updateTicket: vi.fn(),
}));

vi.mock("./agentService", () => ({
  createAgentChatResponse: vi.fn(),
}));

vi.mock("./ticketNotifications", () => ({
  notifyTicketResolved: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";
import { notifyTicketResolved } from "./ticketNotifications";

const mockedDb = vi.mocked(db);
const mockedNotifyTicketResolved = vi.mocked(notifyTicketResolved);

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

const WORKSPACE_A_ID = 1;
const WORKSPACE_B_ID = 2;

const workspaceA = {
  id: WORKSPACE_A_ID,
  ownerUserId: userA.id,
  name: "User A 的客服",
  publicKey: "a".repeat(24),
  agentName: "智能客服",
  agentTone: "friendly",
  greeting: null,
  fallbackReply: null,
  businessContext: null,
  publicChatEnabled: true,
  plan: "free" as const,
  planActivatedAt: null,
  onboardingStep: "done" as const,
  onboardingCompletedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Both fixtures below live in workspace B, which user A must never reach. */
const ticketB = {
  id: 9001,
  workspaceId: WORKSPACE_B_ID,
  userId: 202,
  contactId: null,
  channelId: null,
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
  workspaceId: WORKSPACE_B_ID,
  userId: 202,
  contactId: null,
  channelId: null,
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

describe("workspace resource isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.getWorkspaceByOwner.mockResolvedValue(workspaceA as never);
    mockedDb.getWorkspacePlanUsage.mockResolvedValue({
      knowledgeEntries: 0,
      connectedChannels: 0,
      monthlyContacts: 0,
    });
    mockedDb.getTicketById.mockResolvedValue(ticketB as never);
    mockedDb.getAgentRunWithSteps.mockResolvedValue({
      ...runB,
      steps: [],
    } as never);
    mockedDb.getAgentRunById.mockResolvedValue(runB as never);
    mockedDb.getAgentRunSummaries.mockResolvedValue([] as never);
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
    mockedNotifyTicketResolved.mockResolvedValue({
      status: "not_applicable",
      provider: null,
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

  it("pushes A's workspace into ticket list queries", async () => {
    mockedDb.listTickets.mockImplementation(async filters =>
      filters?.workspaceId === WORKSPACE_A_ID ? [] : [ticketB as never]
    );

    const caller = appRouter.createCaller(createContext());
    const tickets = await caller.tickets.list({});

    expect(tickets).toEqual([]);
    expect(mockedDb.listTickets).toHaveBeenCalledWith({
      status: undefined,
      priority: undefined,
      search: undefined,
      limit: 20,
      offset: 0,
      workspaceId: WORKSPACE_A_ID,
    });
  });

  it("notifies an external contact when an owned ticket becomes resolved", async () => {
    const ticketA = {
      ...ticketB,
      id: 42,
      workspaceId: WORKSPACE_A_ID,
      userId: userA.id,
      contactId: 21,
      channelId: 31,
      title: "A 的外部工单",
      status: "in_progress" as const,
    };
    mockedDb.getTicketById.mockResolvedValue(ticketA as never);
    mockedNotifyTicketResolved.mockResolvedValue({
      status: "delivered",
      provider: "telegram",
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.tickets.update({
      id: ticketA.id,
      status: "resolved",
      locale: "en",
    });

    expect(mockedDb.updateTicket).toHaveBeenCalledWith(
      ticketA.id,
      expect.objectContaining({
        status: "resolved",
        resolvedAt: expect.any(Date),
      })
    );
    expect(mockedNotifyTicketResolved).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticketA.id, status: "resolved" }),
      userA.id
    );
    expect(result.notification).toEqual({
      status: "delivered",
      provider: "telegram",
    });
    expect(mockedDb.addTicketNote).toHaveBeenCalledTimes(2);
    expect(mockedDb.addTicketNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Status changed from "In progress" to "Resolved"',
      })
    );
  });

  it("scopes unscoped chat history to A's own console thread", async () => {
    mockedDb.getChatHistory.mockResolvedValue([] as never);
    mockedDb.getKnowledgeByIds.mockResolvedValue([] as never);

    const caller = appRouter.createCaller(createContext());
    await expect(caller.chat.getHistory({})).resolves.toEqual([]);

    expect(mockedDb.getChatHistory).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_A_ID, contactId: null, ticketId: undefined },
      50
    );
    expect(mockedDb.getKnowledgeByIds).toHaveBeenCalledWith(
      WORKSPACE_A_ID,
      []
    );
    expect(mockedDb.getAgentRunSummaries).toHaveBeenCalledWith([]);
  });

  it("returns the caller's current UTC token quota snapshot", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.agentRuns.getTokenQuota()).resolves.toMatchObject({
      bucketDate: "2026-07-30",
      resetAt: "2026-07-31T00:00:00.000Z",
      enforced: false,
    });
    expect(mockedDb.getTokenQuota).toHaveBeenCalledWith(userA.id, "free");
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

  it("provisions a workspace on first access instead of failing", async () => {
    mockedDb.getWorkspaceByOwner.mockResolvedValueOnce(null);
    mockedDb.createWorkspaceForOwner.mockResolvedValue(workspaceA as never);
    mockedDb.listTickets.mockResolvedValue([] as never);

    const caller = appRouter.createCaller(createContext());
    await expect(caller.tickets.list({})).resolves.toEqual([]);

    expect(mockedDb.createWorkspaceForOwner).toHaveBeenCalledWith({
      userId: userA.id,
      name: "User A 的客服",
    });
  });
});
