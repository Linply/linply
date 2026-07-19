import * as db from "./db";
import { ENV } from "./_core/env";
import { invokeLLM, Message } from "./_core/llm";

export const CHAT_HISTORY_LIMIT = 10;
const CHAT_HISTORY_CHAR_LIMIT = 4_000;
export const KNOWLEDGE_CONTEXT_CHAR_LIMIT = 6_000;
export const KNOWLEDGE_ENTRY_CHAR_LIMIT = 1_800;
export const LLM_TIMEOUT_MS = 45_000;

export const parseJsonValue = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const truncateText = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;

const KNOWLEDGE_TRUNCATION_SUFFIX = "...";

/** Keep each knowledge block within its budget without cutting through a sentence when possible. */
export function truncateAtSemanticBoundary(text: string, maxLength: number) {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= KNOWLEDGE_TRUNCATION_SUFFIX.length) {
    return text.slice(0, maxLength);
  }

  const contentLength = maxLength - KNOWLEDGE_TRUNCATION_SUFFIX.length;
  const candidate = text.slice(0, contentLength);
  const minimumBoundary = Math.floor(contentLength * 0.5);
  let boundary = -1;
  const boundaryPattern = /\n\s*\n|\n|[。！？!?；;]/g;
  let match: RegExpExecArray | null;

  while ((match = boundaryPattern.exec(candidate)) !== null) {
    const end = match.index + match[0].length;
    if (end >= minimumBoundary) boundary = end;
  }

  const cutAt = boundary >= 0 ? boundary : contentLength;
  return `${text.slice(0, cutAt).trimEnd()}${KNOWLEDGE_TRUNCATION_SUFFIX}`;
}

export function buildKnowledgeContext(
  relatedKnowledge: Array<{
    title: string;
    content: string;
    category: string;
  }>
) {
  const blocks: string[] = [];
  let remaining = KNOWLEDGE_CONTEXT_CHAR_LIMIT;

  for (const kb of relatedKnowledge) {
    const separator = blocks.length > 0 ? "\n\n" : "";
    const available = remaining - separator.length;
    if (available <= 0) break;

    const block = truncateAtSemanticBoundary(
      `[${kb.category}] ${kb.title}: ${kb.content}`,
      Math.min(KNOWLEDGE_ENTRY_CHAR_LIMIT, available)
    );
    if (!block) break;

    blocks.push(block);
    remaining -= separator.length + block.length;
  }

  return blocks.join("\n\n");
}

export function buildChatHistoryMessages(
  history: Array<{
    role: "user" | "assistant";
    content: string;
  }>
): Message[] {
  let remaining = CHAT_HISTORY_CHAR_LIMIT;
  const selected: Message[] = [];

  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (!message?.content) continue;

    const content = truncateText(message.content, Math.min(remaining, 1_000));
    if (content.length === 0 || remaining <= 0) break;

    selected.unshift({
      role: message.role,
      content,
    });
    remaining -= content.length;
  }

  return selected;
}

export function buildCustomerServiceSystemPrompt(
  knowledgeContext: string,
  retrieval?: db.KnowledgeRetrieval
) {
  const retrievalNotice = retrieval?.degraded
    ? `

检索状态：本次知识库检索已降级为关键词匹配（${retrieval.fallbackReason ?? "unknown"}）。请降低回答确定性；如果知识依据不足，明确说明暂时无法确认，并建议创建工单。`
    : "";

  return `你是一个专业的客服助手。请严格根据提供的知识库信息回答用户问题。

知识库信息：
${knowledgeContext || "暂无相关知识库信息"}${retrievalNotice}

规则：
1. 只使用知识库中明确提供的信息，不要编造政策、承诺、联系方式或时间。
2. 如果知识库没有相关信息，或历史上下文仍不足以确认，请礼貌说明暂时无法确认，并建议用户创建工单由人工客服处理。
3. 回答应简洁、专业，优先给出可执行步骤。
4. 如果用到了知识库内容，在回答末尾用“参考：知识库标题”列出来源标题。`;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function prepareChatResponse({
  userId,
  ticketId,
  content,
}: {
  userId: number;
  ticketId?: number;
  content: string;
}) {
  const history = await db.getRecentChatHistory(
    userId,
    ticketId,
    CHAT_HISTORY_LIMIT
  );

  await db.saveChatMessage({
    ticketId,
    userId,
    role: "user",
    content,
  });

  const knowledgeSearch = await db.searchKnowledgeWithMeta(content, 3);
  const relatedKnowledge = knowledgeSearch.entries;
  const retrieval = knowledgeSearch.retrieval;
  const knowledgeContext = buildKnowledgeContext(relatedKnowledge);
  const systemPrompt = buildCustomerServiceSystemPrompt(knowledgeContext, retrieval);
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...buildChatHistoryMessages(history),
    { role: "user", content },
  ];
  const relatedKnowledgeSnapshot = relatedKnowledge.map(kb => ({
    id: kb.id,
    title: kb.title,
    category: kb.category,
  }));

  return {
    messages,
    relatedKnowledge,
    relatedKnowledgeSnapshot,
    retrieval,
  };
}

export async function createChatResponse(input: {
  userId: number;
  ticketId?: number;
  content: string;
}) {
  const { messages, relatedKnowledge, relatedKnowledgeSnapshot, retrieval } =
    await prepareChatResponse(input);

  const response = await withTimeout(
    invokeLLM({ messages }),
    LLM_TIMEOUT_MS,
    "LLM call"
  );

  const assistantContent =
    typeof response.choices[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : "抱歉，我无法处理您的请求。";

  await db.saveChatMessage({
    ticketId: input.ticketId,
    userId: input.userId,
    role: "assistant",
    content: assistantContent,
    relatedKnowledgeIds: relatedKnowledge.map(kb => kb.id),
    relatedKnowledgeSnapshot,
    llmProvider: ENV.llmProvider,
    llmModel: response.model,
  });

  return {
    userMessage: input.content,
    assistantMessage: assistantContent,
    relatedKnowledge: relatedKnowledgeSnapshot,
    retrieval,
    llmProvider: ENV.llmProvider,
    llmModel: response.model,
  };
}
