import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import type { AgentEvent } from "@/components/agentTimeline";
import InlineAgentActivity, {
  AgentWorkingStatus,
  type InlineAgentActivityItem,
} from "@/components/InlineAgentActivity";
import PageNav from "@/components/PageNav";
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
import { trpc } from "@/lib/trpc";
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
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmRequestCount: number;
  contextWindowTokens: number;
  llmModel?: string | null;
  traceId?: string | null;
};

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
    const matchingIndex = items.findLastIndex(
      item =>
        item.type === "activity" &&
        item.event.type === "tool_call" &&
        item.event.toolName === event.toolName &&
        !item.result
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
      id: `activity-${items.length}-${event.type}`,
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

const formatTokens = (tokens?: number | null) =>
  new Intl.NumberFormat("zh-CN", {
    notation: tokens && tokens >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(tokens ?? 0);

const getContextUsagePercent = (stats?: MessageRunStats | null) => {
  if (!stats?.contextWindowTokens) return 0;
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
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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
  const createTicketMutation = trpc.tickets.create.useMutation();

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
            inputTokens: msg.runStats.inputTokens ?? 0,
            outputTokens: msg.runStats.outputTokens ?? 0,
            totalTokens: msg.runStats.totalTokens ?? 0,
            llmRequestCount: msg.runStats.llmRequestCount ?? 0,
            contextWindowTokens: msg.runStats.contextWindowTokens ?? 0,
            llmModel: msg.runStats.llmModel ?? msg.llmModel,
            traceId: msg.runStats.traceId,
          }
        : null,
    }));

    setMessages(previousMessages =>
      historyMessages.map(historyMessage => {
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
          ? {
              ...historyMessage,
              id: liveMessage.id,
              streamItems: liveMessage.streamItems,
              structuredOutput: liveMessage.structuredOutput,
              retrieval: liveMessage.retrieval,
              sourcePrompt: liveMessage.sourcePrompt,
              runStats: historyMessage.runStats ?? liveMessage.runStats,
              isStreaming: false,
            }
          : historyMessage;
      })
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

  const assistantIsStreaming = useMemo(
    () => messages.some(message => message.isStreaming),
    [messages]
  );

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

  const sendMessage = async (content: string) => {
    const userMessage = content.trim();
    if (!userMessage || isLoading) return;

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
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok) {
        throw new Error(startPayload.error || "发送消息失败，请稍后重试");
      }

      let runId: string | undefined = startPayload.runId ?? undefined;
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
          runId = payload.runId ?? runId;
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
          updateAssistant(assistantId, message => ({
            ...message,
            isStreaming: false,
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

      if (!runId) {
        throw new Error("未创建 Agent Run，请稍后重试");
      }
      const streamRunId = runId;
      const streamUrl = () =>
        `/api/chat/stream/${encodeURIComponent(streamRunId)}?afterSeq=${lastEventId}`;
      const initialResponse = await fetch(streamUrl());

      let connectionError: unknown;
      try {
        await readStream(initialResponse);
      } catch (error) {
        connectionError = error;
      }

      for (
        let attempt = 0;
        runId && !receivedDone && !terminalError && attempt < 5;
        attempt++
      ) {
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
        try {
          await readStream(await fetch(streamUrl()));
        } catch (error) {
          connectionError = error;
        }
      }

      if (runId && !receivedDone && !terminalError) {
        throw connectionError instanceof Error
          ? connectionError
          : new Error("连接中断，暂时无法续接 Agent Run，请稍后重试");
      }
      if (terminalError && connectionError && !receivedContent)
        throw connectionError;
      if (!receivedContent) throw new Error("未收到 AI 回复，请稍后重试");

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
          } satisfies MessageRunStats),
      }));
      await utils.chat.getHistory.invalidate();
    } catch (error: any) {
      updateAssistant(assistantId, message => ({
        ...message,
        isStreaming: false,
        error: error?.message || "发送消息失败，请稍后重试",
        runStats:
          message.runStats ??
          ({
            durationMs: Date.now() - now,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            llmRequestCount: 0,
            contextWindowTokens: 0,
          } satisfies MessageRunStats),
      }));
      toast.error(error?.message || "发送消息失败，请稍后重试");
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
    <div className="h-screen overflow-hidden bg-background pt-[5.75rem]">
      <PageNav />
      <div className="mx-auto flex h-[calc(100vh-5.75rem)] max-w-5xl flex-col px-3 sm:px-6">
        <div className="flex h-[4.75rem] shrink-0 items-center justify-between border-b border-gray-200">
          <div>
            <h1 className="text-base font-semibold text-gray-950">智能客服</h1>
            <p className="mt-0.5 text-xs text-gray-500">知识库与工单 Agent</p>
          </div>
          <div
            className={`flex h-8 items-center gap-2 text-xs text-gray-500 transition-opacity ${
              assistantIsStreaming
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            aria-hidden={!assistantIsStreaming}
          >
            <Spinner className="size-3.5" />
            loading...
          </div>
        </div>

        <div
          ref={messagesViewportRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 py-6 sm:px-4"
        >
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600">
                  <Bot className="size-5" />
                </span>
                <p className="text-sm font-medium text-gray-700">
                  开始一段新对话
                </p>
              </div>
            </div>
          ) : (
            messages.map(message => {
              const streamGroups = groupStreamItems(message.streamItems ?? []);
              const hasStreamItems = streamGroups.length > 0;
              const lastTextGroup = streamGroups.findLast(
                group => group.type === "text"
              );

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 text-sm leading-6 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" ? (
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-gray-950 text-white">
                      <Bot className="size-3.5" />
                    </span>
                  ) : null}
                  <div
                    className={`min-w-0 max-w-[calc(100%_-_2.5rem)] sm:max-w-[42rem] ${
                      message.role === "user"
                        ? "rounded-lg bg-gray-200 px-4 py-2.5 text-gray-900 sm:max-w-xl"
                        : "w-full py-1 text-gray-900"
                    }`}
                  >
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
                              visible
                              runCompleted={!message.isStreaming && !message.error}
                            />
                          )
                        )}
                        <AgentWorkingStatus
                          visible={
                            Boolean(message.isStreaming) && !lastTextGroup
                          }
                        />
                      </div>
                    ) : message.content ? (
                      <div className="prose prose-sm max-w-none">
                        <Streamdown>{message.content}</Streamdown>
                      </div>
                    ) : message.error ? null : (
                      <AgentWorkingStatus visible />
                    )}

                    {message.error ? (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <div className="flex gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{message.error}</span>
                        </div>
                        {message.sourcePrompt ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 border-red-200 bg-white text-red-700 hover:bg-red-50"
                            onClick={() => handleRetry(message)}
                            disabled={isLoading}
                          >
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            重试
                          </Button>
                        ) : null}
                      </div>
                    ) : null}

                    {message.retrieval?.degraded ? (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        知识库检索已降级为关键词匹配，答案可能需要人工确认。
                      </div>
                    ) : null}

                    {message.relatedKnowledge &&
                    message.relatedKnowledge.length > 0 ? (
                      <div className="mt-4 border-t border-gray-200 pt-3 text-xs">
                        <p className="mb-2 font-semibold text-gray-700">
                          参考知识库
                        </p>
                        <div className="space-y-2">
                          {message.relatedKnowledge.map(kb =>
                            user?.role === "admin" ? (
                              <button
                                key={`${message.id}-${kb.id}`}
                                type="button"
                                onClick={() =>
                                  setLocation(`/admin/knowledge?entry=${kb.id}`)
                                }
                                className="group flex w-full items-start justify-between gap-3 rounded-sm py-1 text-left text-gray-600 transition-colors hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                              >
                                <span className="min-w-0">
                                  <span className="block text-[11px] text-gray-400">
                                    {kb.category}
                                  </span>
                                  <span className="block truncate">
                                    {kb.title}
                                  </span>
                                </span>
                                <ExternalLink className="mt-1 size-3 shrink-0 text-gray-300 group-hover:text-gray-500" />
                              </button>
                            ) : (
                              <div
                                key={`${message.id}-${kb.id}`}
                                className="py-1"
                              >
                                <p className="text-[11px] text-gray-400">
                                  {kb.category}
                                </p>
                                <p className="text-gray-600">{kb.title}</p>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ) : null}

                    {message.role === "assistant" && message.runId ? (
                      <div className="mt-4 flex h-9 items-center justify-between border-t border-gray-100 pt-2 text-xs text-gray-500">
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
                              className="flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
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
                                <span className="text-gray-500">模型</span>
                                <span className="min-w-0 break-all text-right font-mono text-xs font-medium text-gray-900">
                                  {message.runStats?.llmModel ?? "未记录"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-gray-500">模型请求</span>
                                <span className="font-medium tabular-nums text-gray-900">
                                  {message.runStats?.llmRequestCount ?? 0} 次
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-3 border-y border-gray-100 py-3 text-center">
                                <div>
                                  <p className="text-[11px] text-gray-400">输入</p>
                                  <p className="mt-1 font-medium tabular-nums text-gray-900">
                                    {formatTokens(message.runStats?.inputTokens)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-400">输出</p>
                                  <p className="mt-1 font-medium tabular-nums text-gray-900">
                                    {formatTokens(message.runStats?.outputTokens)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-400">总计</p>
                                  <p className="mt-1 font-medium tabular-nums text-gray-900">
                                    {formatTokens(message.runStats?.totalTokens)}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-gray-500">用量 / 上下文窗口</span>
                                  <span className="font-medium tabular-nums text-gray-900">
                                    {getContextUsagePercent(message.runStats).toFixed(1)}%{` `}
                                    <span className="font-normal text-gray-400">
                                      ({formatTokens(message.runStats?.totalTokens)} /{` `}
                                      {formatTokens(message.runStats?.contextWindowTokens)})
                                    </span>
                                  </span>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-gray-100">
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
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-200 pt-3">
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
                            查看 {getReferencedTicketId(message)} 工单详情
                          </Button>
                        ) : shouldShowCreateTicket(message) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openTicketDraft(message)}
                          >
                            <ClipboardList className="mr-2 h-4 w-4" />
                            转工单
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

        <form
          ref={composerRef}
          onSubmit={handleSendMessage}
          className="relative mb-3 flex min-h-[6.5rem] shrink-0 flex-col rounded-lg border border-gray-300 bg-white p-3 pb-14 focus-within:border-gray-500 focus-within:ring-2 focus-within:ring-gray-200"
        >
          <Textarea
            rows={1}
            placeholder="输入消息"
            value={inputValue}
            onChange={event => setInputValue(event.target.value)}
            disabled={isLoading}
            className="max-h-48 min-h-12 w-full resize-none border-0 bg-transparent px-1 py-1 text-base leading-6 shadow-none focus-visible:ring-0 sm:text-sm"
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            size="icon-lg"
            disabled={isLoading || !inputValue.trim()}
            className="absolute bottom-3 right-3"
            aria-label="发送消息"
            title="发送消息"
          >
            {isLoading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
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
                <label className="mb-2 block text-sm font-medium text-gray-700">
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
                <label className="mb-2 block text-sm font-medium text-gray-700">
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
    </div>
  );
}
