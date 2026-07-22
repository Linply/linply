import { useAuth } from "@/_core/hooks/useAuth";
import PageNav from "@/components/PageNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  Activity,
  ArrowLeft,
  Bot,
  CalendarDays,
  CircleUserRound,
  MessageSquareText,
  Send,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

interface TicketDetailProps {
  params: { id: string };
}

const statusLabels: Record<string, string> = {
  pending: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  closed: "已关闭",
};

const statusClasses: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-gray-200 bg-gray-100 text-gray-600",
};

const priorityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

const priorityDots: Record<string, string> = {
  low: "bg-gray-400",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

const noteLabels: Record<string, string> = {
  status_change: "状态变更",
  comment: "处理备注",
  assignment: "工单分配",
  system: "系统记录",
};

export default function TicketDetail({ params }: TicketDetailProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const ticketId = Number.parseInt(params.id, 10);
  const [newNote, setNewNote] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newPriority, setNewPriority] = useState("");

  const { data: ticket, isLoading: ticketLoading } = trpc.tickets.getById.useQuery({ id: ticketId });
  const { data: notes, isLoading: notesLoading } = trpc.tickets.getNotes.useQuery({ ticketId });
  const { data: chatHistory, isLoading: chatLoading } = trpc.tickets.getChatHistory.useQuery({ ticketId });
  const updateMutation = trpc.tickets.update.useMutation();
  const addNoteMutation = trpc.tickets.addNote.useMutation();

  const refreshTicket = async () => {
    await Promise.all([
      utils.tickets.getById.invalidate({ id: ticketId }),
      utils.tickets.getNotes.invalidate({ ticketId }),
      utils.tickets.list.invalidate(),
    ]);
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await addNoteMutation.mutateAsync({ ticketId, content: newNote.trim() });
      setNewNote("");
      await refreshTicket();
      toast.success("备注已添加");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加备注失败");
    }
  };

  const handleUpdateStatus = async () => {
    if (!newStatus) return;
    try {
      await updateMutation.mutateAsync({ id: ticketId, status: newStatus as any });
      setNewStatus("");
      await refreshTicket();
      toast.success("工单状态已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败");
    }
  };

  const handleUpdatePriority = async () => {
    if (!newPriority) return;
    try {
      await updateMutation.mutateAsync({ id: ticketId, priority: newPriority as any });
      setNewPriority("");
      await refreshTicket();
      toast.success("优先级已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败");
    }
  };

  if (ticketLoading) {
    return (
      <div className="min-h-screen bg-background pt-[5.75rem]">
        <PageNav />
        <div className="flex h-[calc(100vh-5.75rem)] items-center justify-center">
          <Spinner className="size-5" />
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-background pt-[5.75rem]">
        <PageNav />
        <main className="mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-900">工单不存在或您无权查看</p>
          <Button variant="outline" size="sm" onClick={() => setLocation("/tickets")} className="mt-4">
            返回工单
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-[5.75rem]">
      <PageNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">

        <header className="mb-6 border-b border-gray-200 pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-xs text-gray-400">工单 #{ticket.id}</p>
              <h1 className="mt-2 break-words text-2xl font-semibold text-gray-950">{ticket.title}</h1>
              <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                <CalendarDays className="size-4" />
                {new Date(ticket.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Badge variant="outline" className={statusClasses[ticket.status] ?? statusClasses.closed}>
                {statusLabels[ticket.status] ?? ticket.status}
              </Badge>
              <Badge variant="outline" className="gap-1.5 bg-white text-gray-600">
                <span className={`size-1.5 rounded-full ${priorityDots[ticket.priority] ?? priorityDots.low}`} />
                {priorityLabels[ticket.priority] ?? ticket.priority}优先级
              </Badge>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-6">
            <section className="rounded-lg border border-gray-200 bg-white p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-gray-900">问题描述</h2>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-gray-700">
                {ticket.description}
              </p>
            </section>

            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
                <h2 className="text-sm font-semibold text-gray-900">处理记录</h2>
                <p className="mt-1 text-xs text-gray-500">备注和状态变更按时间排列</p>
              </div>
              <div className="border-b border-gray-100 bg-gray-50 p-4 sm:px-6">
                <Textarea
                  aria-label="添加工单备注"
                  placeholder="补充处理进展或用户反馈"
                  value={newNote}
                  onChange={event => setNewNote(event.target.value)}
                  rows={3}
                  className="resize-y"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || addNoteMutation.isPending}
                  >
                    <Send className="size-4" />
                    添加备注
                  </Button>
                </div>
              </div>
              {notesLoading ? (
                <div className="flex h-32 items-center justify-center"><Spinner className="size-5" /></div>
              ) : notes && notes.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {notes.map((note: any) => (
                    <div key={note.id} className="flex gap-3 px-5 py-4 sm:px-6">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                        <Activity className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900">
                            {noteLabels[note.noteType] ?? "处理记录"}
                          </p>
                          <span className="text-xs text-gray-400">
                            {formatDistanceToNow(new Date(note.createdAt), { locale: zhCN, addSuffix: true })}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-600">{note.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-6 py-10 text-center text-sm text-gray-500">暂无处理记录</p>
              )}
            </section>

            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
                <h2 className="text-sm font-semibold text-gray-900">关联聊天</h2>
                <p className="mt-1 text-xs text-gray-500">由智能客服转入该工单的对话</p>
              </div>
              {chatLoading ? (
                <div className="flex h-32 items-center justify-center"><Spinner className="size-5" /></div>
              ) : chatHistory && chatHistory.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {chatHistory.map((message: any) => (
                    <div key={message.id} className="flex gap-3 px-5 py-4 sm:px-6">
                      <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${message.role === "user" ? "bg-gray-200 text-gray-700" : "bg-gray-950 text-white"}`}>
                        {message.role === "user" ? <CircleUserRound className="size-3.5" /> : <Bot className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-gray-500">{message.role === "user" ? "用户" : "AI 客服"}</span>
                          <span className="text-xs text-gray-400">
                            {formatDistanceToNow(new Date(message.createdAt), { locale: zhCN, addSuffix: true })}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{message.content}</p>
                        {message.relatedKnowledge?.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {message.relatedKnowledge.map((kb: any) => (
                              <Badge key={kb.id} variant="outline" className="bg-gray-50 text-gray-500">
                                {kb.category} · {kb.title}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-10 text-center">
                  <MessageSquareText className="mx-auto size-5 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">暂无关联聊天</p>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">工单信息</h2>
              <dl className="mt-4 space-y-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-500">状态</dt>
                  <dd className="font-medium text-gray-900">{statusLabels[ticket.status]}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-500">优先级</dt>
                  <dd className="font-medium text-gray-900">{priorityLabels[ticket.priority]}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-500">编号</dt>
                  <dd className="font-mono text-xs text-gray-700">#{ticket.id}</dd>
                </div>
              </dl>
            </section>

            {user?.role === "admin" ? (
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-900">处理工单</h2>
                <div className="mt-4 space-y-5">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-gray-500">更新状态</label>
                    <Select value={newStatus} onValueChange={setNewStatus}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="选择状态" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">待处理</SelectItem>
                        <SelectItem value="in_progress">处理中</SelectItem>
                        <SelectItem value="resolved">已解决</SelectItem>
                        <SelectItem value="closed">已关闭</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="mt-2 w-full" onClick={handleUpdateStatus} disabled={!newStatus || updateMutation.isPending}>
                      应用状态
                    </Button>
                  </div>
                  <div className="border-t border-gray-100 pt-4">
                    <label className="mb-2 block text-xs font-medium text-gray-500">更新优先级</label>
                    <Select value={newPriority} onValueChange={setNewPriority}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="选择优先级" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">低</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="high">高</SelectItem>
                        <SelectItem value="urgent">紧急</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="mt-2 w-full" onClick={handleUpdatePriority} disabled={!newPriority || updateMutation.isPending}>
                      应用优先级
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}
