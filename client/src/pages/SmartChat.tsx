import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import type { AgentEvent } from "@/components/agentTimeline";
import { agentEventToStep } from "@/components/agentTimeline";
import ToolTimeline from "@/components/ToolTimeline";
import PageNav from "@/components/PageNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowRight,
  ClipboardList,
  Copy,
  ExternalLink,
  RefreshCcw,
  Send,
  Sparkles,
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  relatedKnowledge?: RelatedKnowledge[];
  isStreaming?: boolean;
  runId?: string;
  agentEvents?: AgentEvent[];
  structuredOutput?: StructuredOutput;
  retrieval?: RetrievalStatus | null;
  error?: string;
  sourcePrompt?: string;
};

const trimText = (value: string, maxLength: number) => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
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

const categoryLabels: Record<string, string> = {
  account: "账户",
  order: "订单",
  payment: "支付",
  refund: "退款",
  shipping: "物流",
  warranty: "保修",
  technical: "技术",
  other: "其他",
};

const riskLabels: Record<string, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  urgent: "紧急",
};

const riskClasses: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

const buildTicketDraft = (message: ChatMessage, userPrompt: string) => {
  const structured = message.structuredOutput;
  const references =
    message.relatedKnowledge && message.relatedKnowledge.length > 0
      ? message.relatedKnowledge.map(kb => `- ${kb.title}`).join("\n")
      : "无";
  const summary =
    structured?.summary || trimText(message.content, 240) || "用户需要人工跟进。";
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
  const shouldAutoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);

  const { data: chatHistory } = trpc.chat.getHistory.useQuery({});
  const createTicketMutation = trpc.tickets.create.useMutation();

  useEffect(() => {
    if (!chatHistory) return;
    setMessages(
      chatHistory.map((msg: any) => ({
        id: msg.id.toString(),
        role: msg.role,
        content: msg.content,
        relatedKnowledge: msg.relatedKnowledge ?? [],
        runId: msg.agentRunId ?? undefined,
      }))
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

    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
      scrollFrameRef.current = null;
    });

    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages]);

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

        const eventAttempt = typeof payload.attemptCount === "number"
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
            structuredOutput: payload.structuredOutput ?? message.structuredOutput,
          }));
          return;
        }

        if (payload.type === "delta") {
          receivedContent = true;
          updateAssistant(assistantId, message => ({
            ...message,
            content: `${message.content}${payload.content ?? ""}`,
            isStreaming: true,
          }));
          return;
        }

        if (payload.type === "done") {
          receivedDone = true;
          updateAssistant(assistantId, message => ({
            ...message,
            isStreaming: false,
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

      const streamUrl = () => runId
        ? `/api/chat/stream/${encodeURIComponent(runId)}?afterSeq=${lastEventId}`
        : "/api/chat/stream";
      const initialResponse = startPayload.mode === "agent" && runId
        ? await fetch(streamUrl())
        : await fetch("/api/chat/stream", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: userMessage }),
          });

      let connectionError: unknown;
      try {
        await readStream(initialResponse);
      } catch (error) {
        connectionError = error;
      }

      for (let attempt = 0; runId && !receivedDone && !terminalError && attempt < 5; attempt++) {
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
      if (terminalError && connectionError && !receivedContent) throw connectionError;
      if (!receivedContent) throw new Error("未收到 AI 回复，请稍后重试");

      updateAssistant(assistantId, message => ({
        ...message,
        isStreaming: false,
      }));
      await utils.chat.getHistory.invalidate();
    } catch (error: any) {
      updateAssistant(assistantId, message => ({
        ...message,
        isStreaming: false,
        error: error?.message || "发送消息失败，请稍后重试",
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

  const renderStructuredOutput = (message: ChatMessage) => {
    const structured = message.structuredOutput;
    if (!structured) return null;

    return (
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {categoryLabels[structured.category] ?? structured.category}
          </Badge>
          <Badge
            variant="outline"
            className={riskClasses[structured.riskLevel] ?? ""}
          >
            {riskLabels[structured.riskLevel] ?? structured.riskLevel}
          </Badge>
          {structured.shouldCreateTicket ? (
            <Badge variant="secondary">建议转工单</Badge>
          ) : null}
        </div>
        <p className="font-medium text-gray-900">{structured.summary}</p>
        {structured.suggestedActions.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {structured.suggestedActions.map((action, index) => (
              <li key={index} className="flex gap-2">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  };

  return (
    <div className="h-screen overflow-hidden bg-gray-50 pt-14">
      <PageNav />
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-5xl flex-col px-4 py-4 sm:px-6">
        <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              智能客服助手
            </h1>
            <p className="mt-1 text-gray-600">
              基于知识库回答问题，并在需要时执行工单操作
            </p>
          </div>
          {assistantIsStreaming ? (
            <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              <Spinner className="h-4 w-4" />
              AI 正在处理
            </div>
          ) : null}
        </div>

        <Card className="mb-4 flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardContent
            ref={messagesViewportRef}
            onScroll={handleMessagesScroll}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
          >
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <Sparkles className="mx-auto mb-3 h-8 w-8 text-blue-600" />
                  <p className="mb-2 text-lg text-gray-600">开始与 AI 客服对话</p>
                  <p className="text-sm text-gray-400">
                    可以询问知识库问题，也可以查询最近工单状态
                  </p>
                </div>
              </div>
            ) : (
              messages.map(message => {
                const timelineSteps = (message.agentEvents ?? []).map(
                  (event, index) => agentEventToStep(event, index, message.runId)
                );

                return (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`w-full max-w-[min(42rem,100%)] rounded-lg px-4 py-3 ${
                        message.role === "user"
                          ? "bg-blue-600 text-white sm:max-w-xl"
                          : "border border-gray-200 bg-gray-100 text-gray-900"
                      }`}
                    >
                      {message.content ? (
                        <div className="prose prose-sm max-w-none">
                          <Streamdown>{message.content}</Streamdown>
                        </div>
                      ) : message.error ? null : (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Spinner className="h-4 w-4" />
                          <span className="text-sm">正在分析...</span>
                        </div>
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

                      {message.role === "assistant"
                        ? renderStructuredOutput(message)
                        : null}

                      {message.retrieval?.degraded ? (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                          知识库检索已降级为关键词匹配，答案可能需要人工确认。
                        </div>
                      ) : null}

                      {message.relatedKnowledge &&
                      message.relatedKnowledge.length > 0 ? (
                        <div className="mt-3 border-t border-gray-300 pt-3 text-xs">
                          <p className="mb-2 font-semibold text-gray-700">
                            参考知识库
                          </p>
                          <div className="space-y-2">
                            {message.relatedKnowledge.map(kb => (
                              <div key={`${message.id}-${kb.id}`}>
                                <Badge variant="outline" className="text-xs">
                                  {kb.category}
                                </Badge>
                                <p className="mt-1 text-gray-600">{kb.title}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {message.role === "assistant" &&
                      user?.role === "admin" &&
                      message.runId ? (
                        <div className="mt-3 border-t border-gray-300 pt-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-500">
                                Agent Run ID
                              </p>
                              <code className="mt-1 block break-all font-mono text-xs text-gray-700">
                                {message.runId}
                              </code>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => copyRunId(message.runId!)}
                                aria-label="复制 Run ID"
                                title="复制 Run ID"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setLocation(`/runs/${message.runId}`)
                                }
                              >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                查看详情
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {message.role === "assistant" &&
                      !message.isStreaming &&
                      !message.error &&
                      message.content ? (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-300 pt-3">
                          {message.runId && user?.role !== "admin" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setLocation(`/runs/${message.runId}`)}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              查看 Run
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openTicketDraft(message)}
                          >
                            <ClipboardList className="mr-2 h-4 w-4" />
                            转工单
                          </Button>
                        </div>
                      ) : null}

                      {message.role === "assistant" && timelineSteps.length > 0 ? (
                        <div className="mt-4 border-t border-gray-200 pt-3">
                          <p className="mb-2 text-xs font-medium text-gray-500">
                            Agent 执行记录
                          </p>
                          <ToolTimeline steps={timelineSteps} compact />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <form onSubmit={handleSendMessage} className="flex shrink-0 gap-2 pb-2">
          <Input
            type="text"
            placeholder="输入您的问题..."
            value={inputValue}
            onChange={event => setInputValue(event.target.value)}
            disabled={isLoading}
            className="flex-1 border-gray-300 bg-white"
          />
          <Button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                发送
              </>
            )}
          </Button>
        </form>
      </div>

      <Dialog open={Boolean(ticketDraft)} onOpenChange={open => !open && setTicketDraft(null)}>
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
                    setTicketDraft({ ...ticketDraft, title: event.target.value })
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
