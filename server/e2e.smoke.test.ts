import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  createTicket: vi.fn(),
  createWorkspaceForOwner: vi.fn(),
  getWorkspaceByOwner: vi.fn(),
  listTickets: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

const mockedDb = vi.mocked(db);

const user = {
  id: 5,
  email: "local-dev-user@example.local",
  name: "本地开发用户",
  role: "user" as const,
  avatarUrl: null,
  emailVerifiedAt: null,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const ctx: TrpcContext = {
  user,
  req: { protocol: "http", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

const workspace = {
  id: 3,
  ownerUserId: user.id,
  name: "本地开发用户 的客服",
  publicKey: "b".repeat(24),
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

describe("basic authenticated smoke flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.getWorkspaceByOwner.mockResolvedValue(workspace as never);
    mockedDb.createTicket.mockResolvedValue({ id: 77 });
    mockedDb.listTickets.mockResolvedValue([
      {
        id: 77,
        workspaceId: 3,
        userId: 5,
        contactId: null,
        channelId: null,
        title: "订单物流异常",
        description: "物流三天未更新",
        status: "pending",
        priority: "high",
        assignedTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
      },
    ]);
  });

  it("creates a ticket and lists it inside the caller's workspace", async () => {
    const caller = appRouter.createCaller(ctx);

    const created = await caller.tickets.create({
      title: "订单物流异常",
      description: "物流三天未更新",
      priority: "high",
    });
    const tickets = await caller.tickets.list({ status: "pending" });

    expect(created).toEqual({ id: 77 });
    expect(mockedDb.createTicket).toHaveBeenCalledWith({
      workspaceId: 3,
      userId: 5,
      title: "订单物流异常",
      description: "物流三天未更新",
      priority: "high",
    });
    expect(mockedDb.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        workspaceId: 3,
        limit: 20,
        offset: 0,
      })
    );
    expect(tickets[0]?.title).toBe("订单物流异常");
  });
});
