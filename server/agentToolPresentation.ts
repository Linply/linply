import type {
  AgentActivity,
  AgentActivityIcon,
  AgentActivityKey,
  AgentActivityParams,
} from "../shared/agentActivity";

/**
 * Turns a tool call into the single line the user actually sees while the agent
 * works. Everything here is presentation: no tool names, no arguments, no JSON.
 */

const TOOL_ICONS: Record<string, AgentActivityIcon> = {
  searchKnowledge: "knowledge",
  createTicket: "ticketNew",
  listTickets: "ticketList",
  getTicketById: "ticketDetail",
  addTicketNote: "ticketNote",
};

const TOOL_LABELS: Record<string, string> = {
  searchKnowledge: "查知识库",
  createTicket: "创建工单",
  listTickets: "查工单列表",
  getTicketById: "查工单详情",
  addTicketNote: "写工单备注",
};

const iconFor = (toolName: string): AgentActivityIcon =>
  TOOL_ICONS[toolName] ?? "tool";

const labelFor = (toolName: string) => TOOL_LABELS[toolName] ?? toolName;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asPositiveInt = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;

const asCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

/** Long queries make the activity line wrap; a phrase is enough to recognise it. */
const trimPhrase = (value: unknown, maxLength = 24) => {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 1)}…`
    : compact;
};

/**
 * The model writes `reason` for the user, so it is the only free-form string we
 * ever surface — trimmed, single-line, and short enough to sit on one row.
 */
export const sanitizeToolReason = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 60 ? `${compact.slice(0, 59)}…` : compact;
};

const activity = (input: {
  icon: AgentActivityIcon;
  phase: AgentActivity["phase"];
  key: AgentActivityKey;
  params?: AgentActivityParams;
  reason?: string;
  text: string;
  meta?: string;
}): AgentActivity => ({
  icon: input.icon,
  phase: input.phase,
  key: input.key,
  params: input.params ?? {},
  reason: input.reason,
  text: input.reason ?? input.text,
  meta: input.meta,
});

export const describeThinking = (): AgentActivity =>
  activity({
    icon: "thinking",
    phase: "running",
    key: "thinking",
    text: "正在理解你的问题",
  });

export const describeToolCall = (
  toolName: string,
  args: unknown,
  reason?: string
): AgentActivity => {
  const input = asRecord(args);
  const icon = iconFor(toolName);
  const cleanReason = sanitizeToolReason(reason);

  if (toolName === "searchKnowledge") {
    const query = trimPhrase(input.query);
    return activity({
      icon,
      phase: "running",
      key: "searchKnowledge.running",
      params: { query },
      reason: cleanReason,
      text: query ? `正在查「${query}」` : "正在查知识库",
    });
  }

  if (toolName === "createTicket") {
    const title = trimPhrase(input.title, 20);
    return activity({
      icon,
      phase: "running",
      key: "createTicket.running",
      params: { query: title },
      reason: cleanReason,
      text: title ? `正在创建工单：${title}` : "正在创建工单",
    });
  }

  if (toolName === "listTickets") {
    return activity({
      icon,
      phase: "running",
      key: "listTickets.running",
      reason: cleanReason,
      text: "正在查你的工单",
    });
  }

  if (toolName === "getTicketById") {
    const ticketId = asPositiveInt(input.id);
    return activity({
      icon,
      phase: "running",
      key: "getTicketById.running",
      params: { ticketId },
      reason: cleanReason,
      text: ticketId ? `正在查工单 #${ticketId}` : "正在查工单详情",
    });
  }

  if (toolName === "addTicketNote") {
    const ticketId = asPositiveInt(input.ticketId);
    return activity({
      icon,
      phase: "running",
      key: "addTicketNote.running",
      params: { ticketId },
      reason: cleanReason,
      text: ticketId ? `正在给工单 #${ticketId} 写备注` : "正在写工单备注",
    });
  }

  return activity({
    icon,
    phase: "running",
    key: "tool.running",
    params: { label: labelFor(toolName) },
    reason: cleanReason,
    text: `正在${labelFor(toolName)}`,
  });
};

/** A tool result carries `success: false` only when the server built it. */
export const isFailedToolResult = (result: unknown) =>
  asRecord(result).success === false;

/**
 * The completed line. It states the outcome rather than repeating the intent —
 * the caller keeps the model's `reason` from the call event as the row title,
 * so this reads as the trailing half: "我查一下退货时限 · 找到 3 条相关内容".
 */
export const describeToolResult = (
  toolName: string,
  args: unknown,
  result: unknown
): AgentActivity => {
  const input = asRecord(args);
  const output = asRecord(result);
  const icon = iconFor(toolName);
  const label = labelFor(toolName);

  if (isFailedToolResult(result)) {
    return activity({
      icon,
      phase: "error",
      key: "tool.error",
      params: { label },
      text: `${label}没成功`,
    });
  }

  if (toolName === "searchKnowledge") {
    const count = asCount(output.count) ?? 0;
    return count > 0
      ? activity({
          icon,
          phase: "done",
          key: "searchKnowledge.done",
          params: { count },
          text: `找到 ${count} 条相关内容`,
          meta: `${count}`,
        })
      : activity({
          icon,
          phase: "done",
          key: "searchKnowledge.empty",
          params: { query: trimPhrase(input.query) },
          text: "知识库里没有相关内容",
        });
  }

  if (toolName === "createTicket") {
    const ticketId = asPositiveInt(output.ticketId);
    const replayed = output.idempotentReplay === true;
    return activity({
      icon,
      phase: "done",
      key: replayed ? "createTicket.replayed" : "createTicket.done",
      params: { ticketId },
      text: ticketId
        ? replayed
          ? `工单 #${ticketId} 之前已经建过了`
          : `工单 #${ticketId} 已创建`
        : "工单已创建",
    });
  }

  if (toolName === "listTickets") {
    const count = asCount(output.count) ?? 0;
    return count > 0
      ? activity({
          icon,
          phase: "done",
          key: "listTickets.done",
          params: { count },
          text: `找到 ${count} 个工单`,
          meta: `${count}`,
        })
      : activity({
          icon,
          phase: "done",
          key: "listTickets.empty",
          text: "没有找到工单",
        });
  }

  if (toolName === "getTicketById") {
    const ticketId = asPositiveInt(output.id) ?? asPositiveInt(input.id);
    return activity({
      icon,
      phase: "done",
      key: "getTicketById.done",
      params: { ticketId },
      text: ticketId ? `已读取工单 #${ticketId}` : "已读取工单详情",
    });
  }

  if (toolName === "addTicketNote") {
    const ticketId =
      asPositiveInt(output.ticketId) ?? asPositiveInt(input.ticketId);
    return activity({
      icon,
      phase: "done",
      key: "addTicketNote.done",
      params: { ticketId },
      text: ticketId ? `备注已写到工单 #${ticketId}` : "备注已添加",
    });
  }

  return activity({
    icon,
    phase: "done",
    key: "tool.done",
    params: { label },
    text: `${label}完成`,
  });
};
