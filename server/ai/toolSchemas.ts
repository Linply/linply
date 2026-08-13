import type { TSchema } from "typebox";
import { z } from "zod";

/**
 * Every tool takes the same `reason`: one short first-person sentence, in the
 * customer's language, that is shown to them while the tool runs. It is copy,
 * not an argument — stripped before validation, hashing and persistence.
 */
const reasonField = z
  .string()
  .max(120)
  .optional()
  .describe(
    'One short first-person sentence in the customer\'s language explaining what you are doing right now, e.g. "我查一下退货时限". Shown verbatim to the customer, so never mention tool names, parameters or internal ids.'
  );

export const AgentToolInputSchemas = {
  searchKnowledge: z.object({
    query: z
      .string()
      .min(1)
      .describe("The customer question or topic to search for."),
    limit: z.number().int().min(1).max(5).default(3),
    reason: reasonField,
  }),
  createTicket: z.object({
    title: z.string().min(1).max(255),
    description: z.string().min(1),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    reason: reasonField,
  }),
  listTickets: z.object({
    status: z.enum(["pending", "in_progress", "resolved", "closed"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    search: z.string().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(10).default(5),
    offset: z.number().int().min(0).default(0),
    reason: reasonField,
  }),
  getTicketById: z.object({
    id: z.number().int().positive(),
    reason: reasonField,
  }),
  addTicketNote: z.object({
    ticketId: z.number().int().positive(),
    content: z.string().min(1).max(2_000),
    reason: reasonField,
  }),
};

/**
 * Splits presentation copy off the real arguments, so the tool's identity —
 * and therefore its idempotency key and replay hash — never depends on how the
 * model happened to phrase the status line.
 */
export const splitToolReason = <T extends Record<string, unknown>>(
  input: T
): { reason?: string; args: Omit<T, "reason"> } => {
  const { reason, ...args } = input;
  return {
    reason: typeof reason === "string" ? reason : undefined,
    args: args as Omit<T, "reason">,
  };
};

/**
 * pi types tool parameters as TypeBox, which is JSON Schema at runtime — so the
 * zod schemas above stay the single source of truth and the wire schema is
 * derived from them. `io: "input"` is what makes a field with a default show up
 * as optional to the model, which is how it reads today.
 */
export const toToolParameterSchema = (schema: z.ZodType): TSchema =>
  z.toJSONSchema(schema, { io: "input" }) as unknown as TSchema;
