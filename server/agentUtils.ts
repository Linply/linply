export const CHAT_HISTORY_LIMIT = 10;
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

export function buildChatHistoryMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>
) {
  const historyCharLimit = 4_000;
  const messageCharLimit = 1_000;
  let remaining = historyCharLimit;
  const selected: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (!message?.content || remaining <= 0) continue;

    const content = message.content.slice(0, Math.min(remaining, messageCharLimit));
    if (!content) break;

    selected.unshift({ role: message.role, content });
    remaining -= content.length;
  }

  return selected;
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
