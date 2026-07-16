import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as db from "../db";
import type { McpUserContext } from "./auth";
import {
  asTextContent,
  serializeAgentRun,
  serializeKnowledgeEntry,
  serializeTicketDetail,
  serializeTicketSummary,
} from "./serializers";

const limitSchema = z.number().int().min(1).max(50).default(10);

const ensureTicketAccess = async (ticketId: number, user: McpUserContext) => {
  const ticket = await db.getTicketById(ticketId);
  if (!ticket) throw new Error("Ticket not found");
  if (user.role !== "admin" && ticket.userId !== user.id) {
    throw new Error("Unauthorized");
  }
  return ticket;
};

const ensureAgentRunAccess = async (runId: string, user: McpUserContext) => {
  const run = await db.getAgentRunWithSteps(runId);
  if (!run) throw new Error("Agent run not found");
  if (user.role !== "admin" && run.userId !== user.id) {
    throw new Error("Unauthorized");
  }
  return run;
};

export function registerMcpTools(server: McpServer, user: McpUserContext) {
  server.registerTool(
    "search_knowledge",
    {
      title: "Search Knowledge",
      description:
        "Search customer service knowledge base entries. Returns summarized previews, categories, and ids.",
      inputSchema: {
        query: z.string().min(1).max(1_000),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async input => {
      const entries = await db.searchKnowledge(input.query, input.limit);
      return asTextContent({
        count: entries.length,
        entries: entries.map(serializeKnowledgeEntry),
      });
    }
  );

  server.registerTool(
    "list_tickets",
    {
      title: "List Tickets",
      description:
        "List support tickets visible to the configured MCP user. Non-admin users only see their own tickets.",
      inputSchema: {
        status: z.enum(["pending", "in_progress", "resolved", "closed"]).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        search: z.string().min(1).max(100).optional(),
        limit: limitSchema,
        offset: z.number().int().min(0).default(0),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async input => {
      const tickets = await db.listTickets({
        status: input.status,
        priority: input.priority,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
        userId: user.role === "admin" ? undefined : user.id,
      });

      return asTextContent({
        count: tickets.length,
        tickets: tickets.map(serializeTicketSummary),
      });
    }
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get Ticket",
      description:
        "Get details and recent notes for a support ticket visible to the configured MCP user.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async input => {
      const ticket = await ensureTicketAccess(input.id, user);
      const notes = await db.getTicketNotes(input.id);
      return asTextContent(serializeTicketDetail(ticket, notes));
    }
  );

  server.registerTool(
    "create_ticket",
    {
      title: "Create Ticket",
      description: "Create a support ticket for the configured MCP user.",
      inputSchema: {
        title: z.string().min(1).max(255),
        description: z.string().min(1).max(5_000),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async input => {
      const ticket = await db.createTicket({
        userId: user.id,
        title: input.title,
        description: input.description,
        priority: input.priority,
      });

      return asTextContent({
        success: true,
        ticketId: ticket.id,
      });
    }
  );

  server.registerTool(
    "add_ticket_note",
    {
      title: "Add Ticket Note",
      description:
        "Add a comment note to a support ticket visible to the configured MCP user.",
      inputSchema: {
        ticketId: z.number().int().positive(),
        content: z.string().min(1).max(2_000),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async input => {
      await ensureTicketAccess(input.ticketId, user);
      await db.addTicketNote({
        ticketId: input.ticketId,
        userId: user.id,
        content: input.content,
        noteType: "comment",
      });

      return asTextContent({
        success: true,
        ticketId: input.ticketId,
      });
    }
  );

  server.registerTool(
    "get_agent_run",
    {
      title: "Get Agent Run",
      description:
        "Get an Agent Run with summarized steps, tool calls, final output, and errors. Non-admin users only see their own runs.",
      inputSchema: {
        id: z.string().uuid(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async input => {
      const run = await ensureAgentRunAccess(input.id, user);
      return asTextContent(serializeAgentRun(run));
    }
  );
}
