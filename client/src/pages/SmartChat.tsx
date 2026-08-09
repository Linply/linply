import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useT } from "@/i18n";
import type { AgentEvent } from "@/components/agentTimeline";
import InlineAgentActivity, {
  AgentWorkingLine,
  type InlineAgentActivityItem,
} from "@/components/InlineAgentActivity";
import CreditQuotaIndicator from "@/components/CreditQuotaIndicator";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { mergeChatHistory } from "@/lib/chatMessageMerge";
import { trpc } from "@/lib/trpc";
import type { TokenQuotaSnapshot, TokenUsageState } from "@shared/types";
import {
  AlertCircle,
  Bot,
  Clock3,
  ClipboardList,
  Copy,
  ExternalLink,
  MoreHorizontal,
  RefreshCcw,
  Send,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { useLocation } from "wouter";

type RelatedKnowledge = {
  id: number;
  title: string;
  category: string;
};

type StructuredOutput = {
  category: string;
  riskLevel: string;
  summary: string;
  suggestedActions: string[];
  shouldCreateTicket: boolean;
  referencedTicketIds: number[];
};

type RetrievalStatus = {
  mode: "vector" | "keyword";
  degraded: boolean;
  fallbackReason?: string | null;
};

type MessageRunStats = {
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  llmRequestCount: number;
  contextWindowTokens: number;
  usageState?: TokenUsageState;
  llmModel?: string | null;
  traceId?: string | null;
};

type ChatStartPayload =
  | { mode: "agent"; runId: string; quota: TokenQuotaSnapshot }
  | {
      error: string;
      code?: string;
      quota?: TokenQuotaSnapshot;
    };

class TokenQuotaError extends Error {
  constructor(
    message: string,
    readonly quota?: TokenQuotaSnapshot
  ) {
    super(message);
    this.name = "TokenQuotaError";
  }
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  relatedKnowledge?: RelatedKnowledge[];
  isStreaming?: boolean;
  runId?: string;
  agentEvents?: AgentEvent[];
  streamItems?: ChatStreamItem[];
  structuredOutput?: StructuredOutput;
  retrieval?: RetrievalStatus | null;
  error?: string;
  quotaExceeded?: boolean;
  sourcePrompt?: string;
  runStats?: MessageRunStats | null;
};

type ChatStreamItem =
  | { id: string; type: "text"; content: string }
  | ({ type: "activity" } & InlineAgentActivityItem);

type ChatRenderGroup =
  | { id: string; type: "text"; content: string }
  | { id: string; type: "activities"; items: InlineAgentActivityItem[] };

const appendAgentActivity = (
  items: ChatStreamItem[],
  event: AgentEvent
): ChatStreamItem[] => {
  if (event.type === "final") return items;

  if (event.type === "tool_result") {
    // `callId` pairs a result with its own call; the tool-name match is only a
    // fallback for runs recorded before call ids were emitted.
    const matchingIndex = items.findLastIndex(
      item =>
        item.type === "activity" &&
        item.event.type === "tool_call" &&
        !item.result &&
        (event.callId
          ? item.event.callId === event.callId
          : item.event.toolName === event.toolName)
    );
    if (matchingIndex >= 0) {
      return items.map((item, index) =>
        index === matchingIndex && item.type === "activity"
          ? { ...item, result: event }
          : item
      );
    }
  }

  return [
    ...items,
    {
      id: event.callId ?? `activity-${items.length}-${event.type}`,
      type: "activity",
      event,
    },
  ];
};

const appendStreamText = (
  items: ChatStreamItem[],
  content: string
): ChatStreamItem[] => {
  const lastItem = items.at(-1);
  if (lastItem?.type === "text") {
    return [
      ...items.slice(0, -1),
      { ...lastItem, content: `${lastItem.content}${content}` },
    ];
  }
  return [...items, { id: `text-${items.length}`, type: "text", content }];
};

/**
 * The server sanitizes the reply before saving it, so a stream that leaked
 * machinery ends with text the saved history will not have. Swapping the tail
 * keeps the bubble and the stored conversation identical.
 */
const replaceStreamText = (
  items: ChatStreamItem[],
  finalContent: string
): ChatStreamItem[] => {
  const textIndexes = items.flatMap((item, index) =>
    item.type === "text" ? [index] : []
  );
  const lastTextIndex = textIndexes.at(-1);
  if (lastTextIndex === undefined) {
    return [
      ...items,
      { id: `text-${items.length}`, type: "text", content: finalContent },
    ];
  }

  const precedingText = textIndexes
    .slice(0, -1)
    .map(index => {
      const item = items[index];
      return item?.type === "text" ? item.content : "";
    })
    .join("");

  if (!finalContent.startsWith(precedingText)) {
    return [
      ...items.filter(item => item.type !== "text"),
      { id: "text-final", type: "text", content: finalContent },
    ];
  }

  const tail = finalContent.slice(precedingText.length);
  return items.map((item, index) =>
    index === lastTextIndex && item.type === "text"
      ? { ...item, content: tail }
      : item
  );
};

/**
 * The `thinking` step carries no information — it is a fixed string meaning
 * "nothing to show yet", which is exactly the job the typing dots already do,
 * in the place the answer will appear. Rendering both means the bubble loses
 * two rows the moment text arrives, and a view pinned to the bottom jumps by
 * that much on every reply. The step is still persisted for the run detail.
 */
const visibleStreamItems = (items: ChatStreamItem[] = []): ChatStreamItem[] =>
  items.filter(
    item => item.type === "text" || item.event.type !== "thinking"
  );

const groupStreamItems = (items: ChatStreamItem[]): ChatRenderGroup[] =>
  items.reduce<ChatRenderGroup[]>((groups, item) => {
    if (item.type === "text") {
      groups.push(item);
      return groups;
    }

    const lastGroup = groups.at(-1);
    if (lastGroup?.type === "activities") {
      lastGroup.items.push(item);
    } else {
      groups.push({
        id: `activities-${item.id}`,
        type: "activities",
        items: [item],
      });
    }
    return groups;
  }, []);

const trimText = (value: string, maxLength: number) => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
};

const formatDuration = (durationMs?: number | null) => {
  if (typeof durationMs !== "number") return "未记录";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};

const formatTokens = (tokens?: number | null) => {
  if (tokens == null) return "未知";
  return new Intl.NumberFormat("zh-CN", {
    notation: tokens >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(tokens);
};

const USAGE_STATE_LABELS: Record<TokenUsageState, string> = {
  reserved: "执行中预留",
  actual: "实际模型用量",
  no_model: "模型未启动",
  unknown: "实际用量未知（按预留计数）",
};

const getContextUsagePercent = (stats?: MessageRunStats | null) => {
  if (!stats?.contextWindowTokens || stats.totalTokens == null) return 0;
  return Math.min(100, (stats.totalTokens / stats.contextWindowTokens) * 100);
};

const getPreviousUserPrompt = (messages: ChatMessage[], messageId: string) => {
  const index = messages.findIndex(message => message.id === messageId);
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const message = messages[cursor];
    if (message?.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
};

const buildTicketDraft = (message: ChatMessage, userPrompt: string) => {
  const structured = message.structuredOutput;
  const references =
    message.relatedKnowledge && message.relatedKnowledge.length > 0
      ? message.relatedKnowledge.map(kb => `- ${kb.title}`).join("\n")
      : "无";
  const summary =
    structured?.summary ||
    trimText(message.content, 240) ||
    "用户需要人工跟进。";
  const actions = structured?.suggestedActions?.filter(Boolean) ?? [];
  const titleSource = userPrompt || summary;

  return {
    title: trimText(titleSource, 48) || "客服问题跟进",
    description: [
      "来源：智能客服对话",
      message.runId ? `Agent Run：${message.runId}` : "",
      userPrompt ? `用户问题：${userPrompt}` : "",
      "",
      "AI 摘要：",
      summary,
      "",
      "建议动作：",
      actions.length
        ? actions.map(action => `- ${action}`).join("\n")
        : "- 请客服确认用户诉求并继续处理",
      "",
      "引用知识库：",
      references,
    ]
      .filter(line => line !== "")
      .join("\n"),
    priority:
      structured?.riskLevel === "urgent"
        ? "urgent"
        : structured?.riskLevel === "high"
          ? "high"
          : "medium",
  };
};

const getReferencedTicketId = (message: ChatMessage) =>
  message.structuredOutput?.referencedTicketIds?.[0];

const shouldShowCreateTicket = (message: ChatMessage) => {
  if (getReferencedTicketId(message)) return false;

  if (message.structuredOutput?.shouldCreateTicket) return true;

  return Boolean(
    message.retrieval &&
      (message.retrieval.degraded || message.relatedKnowledge?.length === 0)
  );
};

const ACTIVE_RUN_STORAGE_KEY = "linply.activeAgentRun";

type StoredActiveRun = { runId: string; input: string };

const readStoredActiveRun = (): StoredActiveRun | null => {
  try {
    const raw = sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredActiveRun>;
    if (typeof parsed?.runId === "string" && typeof parsed?.input === "string") {
      return { runId: parsed.runId, input: parsed.input };
    }
  } catch {
    // sessionStorage 不可用或数据损坏时走 listActive 慢路径。
  }
  return null;
};

const storeActiveRun = (run: StoredActiveRun) => {
  try {
    sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(run));
  } catch {
    // 忽略写入失败，仅影响快速续接路径。
  }
};

const clearStoredActiveRun = (runId: string) => {
  try {
    if (readStoredActiveRun()?.runId === runId) {
      sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
    }
  } catch {
    // 忽略清理失败。
  }
};

type ScrollFrameRef = { current: number | null };

const cancelScheduledScroll = (frameRef: ScrollFrameRef) => {
  if (frameRef.current === null) return;

  cancelAnimationFrame(frameRef.current);
  frameRef.current = null;
};

const scheduleScrollToBottom = (
  viewport: HTMLDivElement,
  frameRef: ScrollFrameRef
) => {
  cancelScheduledScroll(frameRef);
  frameRef.current = requestAnimationFrame(() => {
    viewport.scrollTop = viewport.scrollHeight;
    frameRef.current = null;
  });
};

export default function SmartChat() {
  const { workspace } = useWorkspace();
  const t = useT();
  /** Shown on the empty conversation so the first question is one click away. */
  const starterPrompts = [
    t.chat.starter1,
    t.chat.starter2,
    t.chat.starter3,
    t.chat.starter4,
  ];
  const agentName = workspace?.agentName ?? "Agent";
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [quotaSnapshot, setQuotaSnapshot] = useState<TokenQuotaSnapshot | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [ticketDraft, setTicketDraft] = useState<{
    sourceMessageId: string;
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "urgent";
  } | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const composerScrollFrameRef = useRef<number | null>(null);

  const { data: chatHistory } = trpc.chat.getHistory.useQuery({});
  const { data: tokenQuota } = trpc.agentRuns.getTokenQuota.useQuery();
  const createTicketMutation = trpc.tickets.create.useMutation();

  useEffect(() => {
    if (tokenQuota) setQuotaSnapshot(tokenQuota);
  }, [tokenQuota]);

  useEffect(() => {
    if (!chatHistory) return;
    const historyMessages: ChatMessage[] = chatHistory.map((msg: any) => ({
      id: msg.id.toString(),
      role: msg.role,
      content: msg.content,
      relatedKnowledge: msg.relatedKnowledge ?? [],
      runId: msg.agentRunId ?? undefined,
      runStats: msg.runStats
        ? {
            durationMs: msg.runStats.durationMs ?? null,
            inputTokens: msg.runStats.inputTokens ?? null,
            outputTokens: msg.runStats.outputTokens ?? null,
            totalTokens: msg.runStats.totalTokens ?? null,
            llmRequestCount: msg.runStats.llmRequestCount ?? 0,
            contextWindowTokens: msg.runStats.contextWindowTokens ?? 0,
            usageState: msg.runStats.usageState,
            llmModel: msg.runStats.llmModel ?? msg.llmModel,
            traceId: msg.runStats.traceId,
          }
        : null,
    }));

    setMessages(previousMessages =>
      mergeChatHistory(historyMessages, previousMessages)
    );
  }, [chatHistory]);

  const handleMessagesScroll = () => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  };

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport || !shouldAutoScrollRef.current) return;

    scheduleScrollToBottom(viewport, scrollFrameRef);

    return () => {
      cancelScheduledScroll(scrollFrameRef);
    };
  }, [messages]);

  useEffect(() => {
    const composer = composerRef.current;
    const viewport = messagesViewportRef.current;
    if (!composer || !viewport || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!shouldAutoScrollRef.current) return;
      scheduleScrollToBottom(viewport, composerScrollFrameRef);
    });

    observer.observe(composer);
    return () => {
      observer.disconnect();
      cancelScheduledScroll(composerScrollFrameRef);
    };
  }, []);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport || typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(() => {
      if (!shouldAutoScrollRef.current) return;
      scheduleScrollToBottom(viewport, scrollFrameRef);
    });

    observer.observe(viewport, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      cancelScheduledScroll(scrollFrameRef);
    };
  }, []);

  const quotaEnforced = Boolean(
    quotaSnapshot?.enforced &&
      !quotaSnapshot.adminExempt &&
      quotaSnapshot.quotaLimitTokens > 0
  );
  const quotaBlocksSending =
    quotaEnforced && quotaSnapshot?.remainingTokens === 0;
  /**
   * The shell header always shows the balance; the composer only speaks up once
   * the balance is close enough to actually interrupt the next send.
   */
  const quotaWarning = quotaBlocksSending
    ? t.chat.quotaExhausted
    : quotaEnforced &&
        (quotaSnapshot?.remainingTokens ?? 0) <
          (quotaSnapshot?.quotaLimitTokens ?? 0) * 0.15
      ? t.chat.quotaLow(
          Math.round((quotaSnapshot?.remainingTokens ?? 0) / 1000)
        )
      : null;

  const updateAssistant = (
    assistantId: string,
    updater: (message: ChatMessage) => ChatMessage
  ) => {
    setMessages(prev =>
      prev.map(message =>
        message.id === assistantId ? updater(message) : message
      )
    );
  };

  const copyRunId = async (runId: string) => {
    try {
      await navigator.clipboard.writeText(runId);
      toast.success("Run ID 已复制");
    } catch {
      toast.error("复制失败，请手动选择 Run ID");
    }
  };

  const streamAgentRun = async (runId: string, assistantId: string) => {
    let lastEventId = 0;
    let receivedContent = false;
    let receivedDone = false;
    let terminalError = false;
    let currentAttempt = 0;

    const handleEvent = (event: string) => {
      const eventId = event
        .split("\n")
        .find(line => line.startsWith("id:"))
        ?.slice(3)
        .trim();
      if (eventId && /^\d+$/.test(eventId)) lastEventId = Number(eventId);

      const data = event
        .split("\n")
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart())
        .join("\n");

      if (!data) return;
      const payload = JSON.parse(data);

      const eventAttempt =
        typeof payload.attemptCount === "number"
          ? payload.attemptCount
          : currentAttempt;
      if (eventAttempt < currentAttempt) return;
      currentAttempt = Math.max(currentAttempt, eventAttempt);

      if (payload.type === "reset") {
        receivedContent = false;
        receivedDone = false;
        terminalError = false;
        updateAssistant(assistantId, message => ({
          ...message,
          content: "",
          relatedKnowledge: [],
          retrieval: null,
          agentEvents: [],
          streamItems: [],
          structuredOutput: undefined,
          error: undefined,
          isStreaming: true,
        }));
        return;
      }

      if (payload.type === "agent_event") {
        updateAssistant(assistantId, message => ({
          ...message,
          runId: payload.event?.runId ?? message.runId,
          agentEvents: [...(message.agentEvents ?? []), payload.event],
          streamItems: appendAgentActivity(
            message.streamItems ?? [],
            payload.event
          ),
        }));
        return;
      }

      if (payload.type === "meta") {
        updateAssistant(assistantId, message => ({
          ...message,
          relatedKnowledge: payload.relatedKnowledge ?? [],
          retrieval: payload.retrieval ?? message.retrieval,
          runId: payload.runId ?? message.runId,
          structuredOutput:
            payload.structuredOutput ?? message.structuredOutput,
        }));
        return;
      }

      if (payload.type === "delta") {
        receivedContent = true;
        updateAssistant(assistantId, message => ({
          ...message,
          content: `${message.content}${payload.content ?? ""}`,
          streamItems: appendStreamText(
            message.streamItems ?? [],
            payload.content ?? ""
          ),
          isStreaming: true,
        }));
        return;
      }

      if (payload.type === "done") {
        receivedDone = true;
        const finalContent =
          typeof payload.finalContent === "string"
            ? payload.finalContent
            : undefined;
        updateAssistant(assistantId, message => ({
          ...message,
          isStreaming: false,
          content: finalContent ?? message.content,
          streamItems: finalContent
            ? replaceStreamText(message.streamItems ?? [], finalContent)
            : message.streamItems,
          runStats: payload.stats
            ? {
                ...payload.stats,
                llmModel: payload.llmModel ?? message.runStats?.llmModel,
              }
            : message.runStats,
        }));
        return;
      }

      if (payload.type === "error") {
        terminalError = true;
        if (receivedContent) {
          updateAssistant(assistantId, message => ({
            ...message,
            isStreaming: false,
          }));
          toast.error(payload.message || "回复已生成，但收尾状态同步失败");
          return;
        }
        throw new Error(payload.message || "发送消息失败，请稍后重试");
      }
    };

    const readStream = async (response: Response) => {
      if (!response.ok || !response.body) {
        throw new Error("发送消息失败，请稍后重试");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        events.forEach(handleEvent);
      }
      if (buffer.trim()) handleEvent(buffer);
    };

    const streamUrl = () =>
      `/api/chat/stream/${encodeURIComponent(runId)}?afterSeq=${lastEventId}`;

    let connectionError: unknown;
    try {
      await readStream(await fetch(streamUrl()));
    } catch (error) {
      connectionError = error;
    }

    for (
      let attempt = 0;
      !receivedDone && !terminalError && attempt < 5;
      attempt++
    ) {
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      try {
        await readStream(await fetch(streamUrl()));
      } catch (error) {
        connectionError = error;
      }
    }

    if (receivedDone || terminalError) clearStoredActiveRun(runId);

    if (!receivedDone && !terminalError) {
      throw connectionError instanceof Error
        ? connectionError
        : new Error("连接中断，暂时无法续接 Agent Run，请稍后重试");
    }
    if (terminalError && connectionError && !receivedContent)
      throw connectionError;
    if (!receivedContent) throw new Error("未收到 AI 回复，请稍后重试");
  };

  const resumeAgentRun = async (run: StoredActiveRun) => {
    const assistantId = `resume-assistant-${run.runId}`;
    setIsLoading(true);
    shouldAutoScrollRef.current = true;
    setMessages(prev => {
      if (
        prev.some(
          message => message.role === "assistant" && message.runId === run.runId
        )
      ) {
        return prev;
      }
      const next = [...prev];
      if (
        !prev.some(
          message => message.role === "user" && message.runId === run.runId
        )
      ) {
        next.push({
          id: `resume-user-${run.runId}`,
          role: "user",
          content: run.input,
          runId: run.runId,
        });
      }
      next.push({
        id: assistantId,
        role: "assistant",
        content: "",
        relatedKnowledge: [],
        isStreaming: true,
        runId: run.runId,
        agentEvents: [],
        streamItems: [],
        sourcePrompt: run.input,
      });
      return next;
    });

    try {
      await streamAgentRun(run.runId, assistantId);
      updateAssistant(assistantId, message => ({
        ...message,
        isStreaming: false,
      }));
      await Promise.all([
        utils.chat.getHistory.invalidate(),
        utils.agentRuns.getTokenQuota.invalidate(),
      ]);
    } catch (error: any) {
      updateAssistant(assistantId, message => ({
        ...message,
        isStreaming: false,
        error: error?.message || "续接 Agent Run 失败，请稍后重试",
      }));
      toast.error(error?.message || "续接 Agent Run 失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;

    void (async () => {
      // 快速路径：本标签页发起的 run 记录在 sessionStorage，省一次网络往返。
      const stored = readStoredActiveRun();
      if (stored) {
        await resumeAgentRun(stored);
        return;
      }
      try {
        const activeRuns = await utils.agentRuns.listActive.fetch();
        const latest = activeRuns?.[0];
        if (latest) {
          await resumeAgentRun({ runId: latest.runId, input: latest.input });
        }
      } catch {
        // 查询失败时保持静默，不影响正常聊天。
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = async (content: string) => {
    const userMessage = content.trim();
    if (!userMessage || isLoading || quotaBlocksSending) return;

    const now = Date.now();
    const assistantId = `${now + 1}`;
    setInputValue("");
    setIsLoading(true);
    shouldAutoScrollRef.current = true;
    setMessages(prev => [
      ...prev,
      {
        id: `${now}`,
        role: "user",
        content: userMessage,
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        relatedKnowledge: [],
        isStreaming: true,
        agentEvents: [],
        streamItems: [],
        sourcePrompt: userMessage,
      },
    ]);

    try {
      const startResponse = await fetch("/api/chat/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: userMessage }),
      });
      const startPayload = (await startResponse
        .json()
        .catch(() => ({}))) as ChatStartPayload;
      if (!startResponse.ok) {
        if (
          startResponse.status === 429 &&
          "code" in startPayload &&
          startPayload.code === "TOKEN_QUOTA_EXCEEDED"
        ) {
          if (startPayload.quota) setQuotaSnapshot(startPayload.quota);
          setQuotaError(startPayload.error);
          throw new TokenQuotaError(startPayload.error, startPayload.quota);
        }
        throw new Error(
          "error" in startPayload
            ? startPayload.error
            : "发送消息失败，请稍后重试"
        );
      }

      if (!("runId" in startPayload)) {
        throw new Error("未创建 Agent Run，请稍后重试");
      }
      setQuotaSnapshot(startPayload.quota);
      setQuotaError(null);
      void utils.agentRuns.getTokenQuota.setData(undefined, startPayload.quota);
      const runId = startPayload.runId;
      storeActiveRun({ runId, input: userMessage });
      updateAssistant(assistantId, message => ({ ...message, runId }));
      setMessages(prev =>
        prev.map(message =>
          message.id === `${now}` ? { ...message, runId } : message
        )
      );

      await streamAgentRun(runId, assistantId);

      updateAssistant(assistantId, message => ({
        ...message,
        isStreaming: false,
        runStats:
          message.runStats ??
          ({
            durationMs: Date.now() - now,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            llmRequestCount: 0,
            contextWindowTokens: 0,
            usageState: "unknown",
          } satisfies MessageRunStats),
      }));
      await Promise.all([
        utils.chat.getHistory.invalidate(),
        utils.agentRuns.getTokenQuota.invalidate(),
      ]);
    } catch (error: any) {
      const isQuotaError = error instanceof TokenQuotaError;
      updateAssistant(assistantId, message => ({
        ...message,
        isStreaming: false,
        error: error?.message || "发送消息失败，请稍后重试",
        quotaExceeded: isQuotaError,
        runStats:
          message.runStats ??
          ({
            durationMs: Date.now() - now,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            llmRequestCount: 0,
            contextWindowTokens: 0,
            usageState: "unknown",
          } satisfies MessageRunStats),
      }));
      if (!isQuotaError) toast.error(error?.message || "发送消息失败，请稍后重试");
      await utils.agentRuns.getTokenQuota.invalidate();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage(inputValue);
  };

  const handleRetry = (message: ChatMessage) => {
    if (message.sourcePrompt) {
      void sendMessage(message.sourcePrompt);
    }
  };

  const openTicketDraft = (message: ChatMessage) => {
    const draft = buildTicketDraft(
      message,
      message.sourcePrompt || getPreviousUserPrompt(messages, message.id)
    );
    setTicketDraft({
      sourceMessageId: message.id,
      title: draft.title,
      description: draft.description,
      priority: draft.priority as "low" | "medium" | "high" | "urgent",
    });
  };

  const createTicketFromDraft = async () => {
    if (!ticketDraft) return;

    try {
      const result = await createTicketMutation.mutateAsync({
        title: ticketDraft.title,
        description: ticketDraft.description,
        priority: ticketDraft.priority,
      });
      await utils.tickets.list.invalidate();
      toast.success("工单已创建");
      setTicketDraft(null);
      if (result?.id) {
        setLocation(`/ticket/${result.id}`);
      } else {
        setLocation("/tickets");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建工单失败");
    }
  };

  return (
    <AppShell
      title={t.chat.title}
      description={t.chat.subtitle}
      maxWidth="full"
      fullBleed
    >
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">

        <div
          ref={messagesViewportRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ overflowAnchor: "none" }}
        >
          <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-8 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Bot className="size-6" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-foreground">
                {t.chat.emptyTitle}
              </h2>
              {/* The agent opens in its own words, exactly as a customer sees it. */}
              {workspace?.greeting?.trim() ? (
                <p className="mt-3 max-w-md text-balance text-sm leading-6 text-foreground">
                  {workspace.greeting.trim()}
                </p>
              ) : null}
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
                {t.chat.emptySubtitle}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {starterPrompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInputValue(prompt)}
                    className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(message => {
              const streamGroups = groupStreamItems(
                visibleStreamItems(message.streamItems)
              );
              const hasStreamItems = streamGroups.length > 0;
              const lastTextGroup = streamGroups.findLast(
                group => group.type === "text"
              );
              const awaitingFirstToken =
                message.role === "assistant" &&
                Boolean(message.isStreaming) &&
                !message.content;

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 text-sm leading-7 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" ? (
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Bot className="size-3.5" />
                    </span>
                  ) : null}
                  <div
                    className={`min-w-0 ${
                      message.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary-soft px-4 py-2.5 text-primary-soft-foreground sm:max-w-xl"
                        : "w-full max-w-[calc(100%_-_2.5rem)] text-foreground"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {agentName}
                      </p>
                    ) : null}
                    {message.role === "assistant" && hasStreamItems ? (
                      <div>
                        {streamGroups.map(group =>
                          group.type === "text" ? (
                            <div
                              key={group.id}
                              className="chat-stream-content prose prose-sm max-w-none"
                              data-streaming={
                                Boolean(message.isStreaming) &&
                                group.id === lastTextGroup?.id
                              }
                            >
                              <Streamdown
                                className="chat-stream-markdown"
                                isAnimating={Boolean(message.isStreaming)}
                              >
                                {group.content}
                              </Streamdown>
                            </div>
                          ) : (
                            <InlineAgentActivity
                              key={group.id}
                              items={group.items}
                              runCompleted={
                                (!message.isStreaming && !message.error) ||
                                group.id !== streamGroups.at(-1)?.id
                              }
                            />
                          )
                        )}
                      </div>
                    ) : message.content ? (
                      <div className="prose prose-sm max-w-none">
                        <Streamdown>{message.content}</Streamdown>
                      </div>
                    ) : null}

                    {/* Once a tool row is on screen it is already shimmering;
                        a second "still working" line would just repeat it. */}
                    {awaitingFirstToken && !message.error && !hasStreamItems ? (
                      <AgentWorkingLine agentName={agentName} />
                    ) : null}

                    {message.error ? (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <div className="flex gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{message.error}</span>
                        </div>
                        {message.sourcePrompt && !message.quotaExceeded ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 border-red-200 bg-card text-red-700 hover:bg-red-50"
                            onClick={() => handleRetry(message)}
                            disabled={isLoading}
                          >
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            {t.chat.retry}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}

                    {message.retrieval?.degraded ? (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        {t.chat.degraded}
                      </div>
                    ) : null}

                    {message.relatedKnowledge &&
                    message.relatedKnowledge.length > 0 ? (
                      <div className="mt-4 border-t border-border pt-3">
                        <p className="mb-2 text-xs text-muted-foreground">
                          {t.chat.citations(message.relatedKnowledge.length)}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {message.relatedKnowledge.map(kb => (
                            <button
                              key={`${message.id}-${kb.id}`}
                              type="button"
                              onClick={() =>
                                setLocation(`/knowledge?entry=${kb.id}`)
                              }
                              title={`${kb.category} · ${kb.title}`}
                              className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="truncate">{kb.title}</span>
                              <span className="shrink-0 text-[0.6875rem] text-muted-foreground/70">
                                {kb.category}
                              </span>
                              <ExternalLink className="size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {message.role === "assistant" && message.runId ? (
                      <div className="mt-2 flex h-9 items-center justify-between text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <Clock3 className="size-4" />
                          {message.isStreaming
                            ? "运行中"
                            : formatDuration(message.runStats?.durationMs)}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label="查看运行统计"
                              title="查看运行统计"
                              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <MoreHorizontal className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            sideOffset={8}
                            className="w-[min(22rem,calc(100vw-2rem))] p-0"
                          >
                            <div className="space-y-3 px-4 py-4 text-sm">
                              <div className="flex items-start justify-between gap-4">
                                <span className="text-muted-foreground">模型</span>
                                <span className="min-w-0 break-all text-right font-mono text-xs font-medium text-foreground">
                                  {message.runStats?.llmModel ?? "未记录"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">模型请求</span>
                                <span className="font-medium tabular-nums text-foreground">
                                  {message.runStats?.llmRequestCount ?? 0} 次
                                </span>
                              </div>
                              {message.runStats?.usageState ? (
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-muted-foreground">用量状态</span>
                                  <Badge
                                    variant="outline"
                                    className={
                                      message.runStats.usageState === "unknown"
                                        ? "border-amber-200 bg-amber-50 text-amber-700"
                                        : "bg-muted/60 text-muted-foreground"
                                    }
                                  >
                                    {USAGE_STATE_LABELS[message.runStats.usageState]}
                                  </Badge>
                                </div>
                              ) : null}
                              <div className="grid grid-cols-3 gap-3 border-y border-border py-3 text-center">
                                <div>
                                  <p className="text-[11px] text-muted-foreground">输入</p>
                                  <p className="mt-1 font-medium tabular-nums text-foreground">
                                    {formatTokens(message.runStats?.inputTokens)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-muted-foreground">输出</p>
                                  <p className="mt-1 font-medium tabular-nums text-foreground">
                                    {formatTokens(message.runStats?.outputTokens)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-muted-foreground">总计</p>
                                  <p className="mt-1 font-medium tabular-nums text-foreground">
                                    {formatTokens(message.runStats?.totalTokens)}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-muted-foreground">用量 / 上下文窗口</span>
                                  <span className="font-medium tabular-nums text-foreground">
                                    {getContextUsagePercent(message.runStats).toFixed(1)}%{` `}
                                    <span className="font-normal text-muted-foreground">
                                      ({formatTokens(message.runStats?.totalTokens)} /{` `}
                                      {formatTokens(message.runStats?.contextWindowTokens)})
                                    </span>
                                  </span>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-muted">
                                  <div
                                    className="h-full bg-emerald-500"
                                    style={{
                                      width: `${getContextUsagePercent(message.runStats)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                            <DropdownMenuSeparator className="m-0" />
                            <DropdownMenuItem
                              onSelect={() =>
                                setLocation(`/runs/${message.runId}`)
                              }
                              className="mx-1 my-1"
                            >
                              <ExternalLink className="size-4" />
                              查看完整 Run
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => copyRunId(message.runId!)}
                              className="mx-1 mb-1"
                            >
                              <Copy className="size-4" />
                              复制 Run ID
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : null}

                    {message.role === "assistant" &&
                    !message.isStreaming &&
                    !message.error &&
                    message.content &&
                    (getReferencedTicketId(message) ||
                      shouldShowCreateTicket(message)) ? (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                        {getReferencedTicketId(message) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setLocation(
                                `/ticket/${getReferencedTicketId(message)}`
                              )
                            }
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            {t.chat.openTicket(getReferencedTicketId(message)!)}
                          </Button>
                        ) : shouldShowCreateTicket(message) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openTicketDraft(message)}
                          >
                            <ClipboardList className="mr-2 h-4 w-4" />
                            {t.chat.convertToTicket}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background/80 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-3 sm:px-6">
          <form
            ref={composerRef}
            onSubmit={handleSendMessage}
            className="relative flex min-h-[4.75rem] shrink-0 flex-col rounded-2xl border border-input bg-card p-3 pb-11 shadow-sm transition-shadow focus-within:border-ring focus-within:shadow-md"
          >
          <Textarea
            rows={1}
            disabled={isLoading || quotaBlocksSending}
            placeholder={
              quotaBlocksSending
                ? t.chat.quotaExhaustedPlaceholder
                : t.chat.inputPlaceholder
            }
            value={inputValue}
            onChange={event => setInputValue(event.target.value)}
            className="max-h-48 min-h-9 w-full resize-none border-0 bg-transparent px-1 py-1 text-base leading-6 shadow-none focus-visible:ring-0 sm:text-sm"
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {quotaWarning ? (
            <p className="absolute bottom-3.5 left-4 text-xs text-warning">
              {quotaWarning}
            </p>
          ) : null}
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || quotaBlocksSending || !inputValue.trim()}
            className="absolute bottom-2.5 right-3 rounded-full"
            aria-label={t.chat.send}
            title={t.chat.send}
          >
            {isLoading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
          </form>
          <p className="mt-2 text-center text-[0.6875rem] text-muted-foreground">
            {t.chat.composerHint}
          </p>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(ticketDraft)}
        onOpenChange={open => !open && setTicketDraft(null)}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>转为工单</DialogTitle>
            <DialogDescription>
              已根据当前 AI 回复生成摘要，提交后会进入工单列表。
            </DialogDescription>
          </DialogHeader>
          {ticketDraft ? (
            <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  工单标题
                </label>
                <Input
                  value={ticketDraft.title}
                  onChange={event =>
                    setTicketDraft({
                      ...ticketDraft,
                      title: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  工单描述
                </label>
                <Textarea
                  value={ticketDraft.description}
                  rows={12}
                  className="max-h-[45vh] overflow-y-auto"
                  onChange={event =>
                    setTicketDraft({
                      ...ticketDraft,
                      description: event.target.value,
                    })
                  }
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTicketDraft(null)}>
              取消
            </Button>
            <Button
              onClick={createTicketFromDraft}
              disabled={
                createTicketMutation.isPending ||
                !ticketDraft?.title.trim() ||
                !ticketDraft?.description.trim()
              }
            >
              {createTicketMutation.isPending ? "创建中..." : "创建工单"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
