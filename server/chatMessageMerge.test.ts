import { describe, expect, it } from "vitest";
import {
  mergeChatHistory,
  type MergeableChatMessage,
} from "../client/src/lib/chatMessageMerge";

type TestMessage = MergeableChatMessage & { content: string };

describe("mergeChatHistory", () => {
  it("does not append user messages that fell outside the history window", () => {
    const previousMessages: TestMessage[] = [
      { id: "old-user", role: "user", content: "旧问题", runId: "old-run" },
      {
        id: "old-assistant",
        role: "assistant",
        content: "旧回答",
        runId: "old-run",
      },
      { id: "new-user", role: "user", content: "新问题", runId: "new-run" },
      {
        id: "new-assistant",
        role: "assistant",
        content: "新回答",
        runId: "new-run",
      },
    ];
    const historyMessages = previousMessages.slice(2);

    expect(mergeChatHistory(historyMessages, previousMessages)).toEqual(
      historyMessages
    );
  });

  it("keeps both local messages while an active run is not in history yet", () => {
    const historyMessages: TestMessage[] = [
      { id: "saved", role: "assistant", content: "已有回答", runId: "saved-run" },
    ];
    const activeMessages: TestMessage[] = [
      ...historyMessages,
      {
        id: "local-user",
        role: "user",
        content: "进行中的问题",
        runId: "active-run",
      },
      {
        id: "local-assistant",
        role: "assistant",
        content: "",
        runId: "active-run",
        isStreaming: true,
      },
    ];

    expect(mergeChatHistory(historyMessages, activeMessages)).toEqual(
      activeMessages
    );
  });

  it("keeps only the missing assistant when the active user message is saved", () => {
    const savedUser: TestMessage = {
      id: "db-user",
      role: "user",
      content: "进行中的问题",
      runId: "active-run",
    };
    const activeAssistant: TestMessage = {
      id: "local-assistant",
      role: "assistant",
      content: "部分回答",
      runId: "active-run",
      isStreaming: true,
    };

    expect(
      mergeChatHistory(
        [savedUser],
        [{ ...savedUser, id: "local-user" }, activeAssistant]
      )
    ).toEqual([savedUser, activeAssistant]);
  });
});
