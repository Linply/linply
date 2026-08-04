export type MergeableChatMessage = {
  id: string;
  role: "user" | "assistant";
  runId?: string;
  isStreaming?: boolean;
  streamItems?: readonly unknown[];
  structuredOutput?: unknown;
  retrieval?: unknown;
  sourcePrompt?: string;
  runStats?: unknown;
};

export const mergeChatHistory = <T extends MergeableChatMessage>(
  historyMessages: T[],
  previousMessages: T[]
): T[] => {
  const merged = historyMessages.map(historyMessage => {
    if (historyMessage.role !== "assistant" || !historyMessage.runId) {
      return historyMessage;
    }

    const liveMessage = previousMessages.find(
      message =>
        message.role === "assistant" &&
        message.runId === historyMessage.runId &&
        message.streamItems?.length
    );
    return liveMessage
      ? ({
          ...historyMessage,
          id: liveMessage.id,
          streamItems: liveMessage.streamItems,
          structuredOutput: liveMessage.structuredOutput,
          retrieval: liveMessage.retrieval,
          sourcePrompt: liveMessage.sourcePrompt,
          runStats: historyMessage.runStats ?? liveMessage.runStats,
          isStreaming: false,
        } as T)
      : historyMessage;
  });

  // History is limited; retain local rows only for a genuinely active run so
  // messages evicted from the history window do not reappear at the bottom.
  const activeRunIds = new Set(
    previousMessages
      .filter(
        message =>
          message.role === "assistant" &&
          message.isStreaming &&
          message.runId
      )
      .map(message => message.runId as string)
  );
  const mergedRunKeys = new Set(
    merged
      .filter(message => message.runId)
      .map(message => `${message.role}:${message.runId}`)
  );
  const activeLocalTail = previousMessages.filter(
    message =>
      message.runId &&
      activeRunIds.has(message.runId) &&
      !mergedRunKeys.has(`${message.role}:${message.runId}`)
  );

  return [...merged, ...activeLocalTail];
};
