import AppShell from "@/components/AppShell";
import { useDateLocale, useIntlLocale, useLocale, useT } from "@/i18n";
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
import {
  Activity,
  Archive,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleUserRound,
  MessageSquareText,
  Play,
  RotateCcw,
  Send,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

interface TicketDetailProps {
  params: { id: string };
}

const statusClasses: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-border bg-muted text-muted-foreground",
};

const priorityDots: Record<string, string> = {
  low: "bg-muted-foreground",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

type TicketStatus = "pending" | "in_progress" | "resolved" | "closed";

export default function TicketDetail({ params }: TicketDetailProps) {
  const t = useT();
  const { locale } = useLocale();
  const dateLocale = useDateLocale();
  const intlLocale = useIntlLocale();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const ticketId = Number.parseInt(params.id, 10);
  const [newNote, setNewNote] = useState("");
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
      toast.success(t.tickets.noteAdded);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.tickets.addNoteFailed);
    }
  };

  const handleUpdateStatus = async (status: TicketStatus) => {
    try {
      const result = await updateMutation.mutateAsync({
        id: ticketId,
        status,
        locale,
      });
      await refreshTicket();
      if (result.notification.status === "failed") {
        toast.warning(t.tickets.notificationFailed);
      } else if (result.notification.status === "delivered") {
        toast.success(t.tickets.resolutionNotified);
      } else {
        toast.success(t.tickets.statusUpdated);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.tickets.updateFailed);
    }
  };

  const handleUpdatePriority = async () => {
    if (!newPriority) return;
    try {
      await updateMutation.mutateAsync({ id: ticketId, priority: newPriority as any });
      setNewPriority("");
      await refreshTicket();
      toast.success(t.tickets.priorityUpdated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.tickets.updateFailed);
    }
  };

  if (ticketLoading) {
    return (
      <AppShell title={t.tickets.title}>
        <div className="flex justify-center py-16">
          <Spinner className="size-5" />
        </div>
      </AppShell>
    );
  }

  if (!ticket) {
    return (
      <AppShell title={t.tickets.title}>
        <div className="py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {t.tickets.notFound}
          </p>
          <Button variant="outline" size="sm" onClick={() => setLocation("/tickets")} className="mt-4">
            {t.tickets.backToTickets}
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={t.tickets.detailTitle(ticketId)} maxWidth="wide">
      <div>
        <header className="mb-6 border-b border-border pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground">{t.tickets.ticketNumber(ticket.id)}</p>
              <h1 className="mt-2 break-words text-2xl font-semibold text-foreground">{ticket.title}</h1>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="size-4" />
                {new Date(ticket.createdAt).toLocaleString(intlLocale)}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Badge variant="outline" className={statusClasses[ticket.status] ?? statusClasses.closed}>
                {t.tickets.statusLabels[ticket.status] ?? ticket.status}
              </Badge>
              <Badge variant="outline" className="gap-1.5 bg-card text-muted-foreground">
                <span className={`size-1.5 rounded-full ${priorityDots[ticket.priority] ?? priorityDots.low}`} />
                {t.tickets.priorityBadge(
                  t.tickets.priorityLabels[ticket.priority] ?? ticket.priority
                )}
              </Badge>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-6">
            <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-foreground">{t.tickets.descriptionTitle}</h2>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                {ticket.description}
              </p>
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border px-5 py-4 sm:px-6">
                <h2 className="text-sm font-semibold text-foreground">{t.tickets.activityTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t.tickets.activitySubtitle}</p>
              </div>
              <div className="border-b border-border bg-muted/60 p-4 sm:px-6">
                <Textarea
                  aria-label={t.tickets.addNoteAria}
                  placeholder={t.tickets.addNotePlaceholder}
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
                    {t.tickets.addNote}
                  </Button>
                </div>
              </div>
              {notesLoading ? (
                <div className="flex h-32 items-center justify-center"><Spinner className="size-5" /></div>
              ) : notes && notes.length > 0 ? (
                <div className="divide-y divide-border">
                  {notes.map((note: any) => (
                    <div key={note.id} className="flex gap-3 px-5 py-4 sm:px-6">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Activity className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {t.tickets.noteLabels[
                              note.noteType as keyof typeof t.tickets.noteLabels
                            ] ?? t.tickets.unknownNote}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(note.createdAt), { locale: dateLocale, addSuffix: true })}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{note.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t.tickets.noActivity}</p>
              )}
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border px-5 py-4 sm:px-6">
                <h2 className="text-sm font-semibold text-foreground">{t.tickets.relatedChatTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t.tickets.relatedChatSubtitle}</p>
              </div>
              {chatLoading ? (
                <div className="flex h-32 items-center justify-center"><Spinner className="size-5" /></div>
              ) : chatHistory && chatHistory.length > 0 ? (
                <div className="divide-y divide-border">
                  {chatHistory.map((message: any) => (
                    <div key={message.id} className="flex gap-3 px-5 py-4 sm:px-6">
                      <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${message.role === "user" ? "bg-accent text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
                        {message.role === "user" ? <CircleUserRound className="size-3.5" /> : <Bot className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-muted-foreground">{message.role === "user" ? t.tickets.customer : t.tickets.agent}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(message.createdAt), { locale: dateLocale, addSuffix: true })}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{message.content}</p>
                        {message.relatedKnowledge?.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {message.relatedKnowledge.map((kb: any) => (
                              <Badge key={kb.id} variant="outline" className="bg-muted/60 text-muted-foreground">
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
                  <MessageSquareText className="mx-auto size-5 text-muted-foreground/60" />
                  <p className="mt-2 text-sm text-muted-foreground">{t.tickets.noRelatedChat}</p>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">{t.tickets.ticketInfo}</h2>
              <dl className="mt-4 space-y-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t.tickets.status}</dt>
                  <dd className="font-medium text-foreground">{t.tickets.statusLabels[ticket.status]}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t.tickets.priority}</dt>
                  <dd className="font-medium text-foreground">{t.tickets.priorityLabels[ticket.priority]}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t.tickets.number}</dt>
                  <dd className="font-mono text-xs text-muted-foreground">#{ticket.id}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">
                {t.tickets.handleTicket}
              </h2>
              <div className="mt-4 space-y-5">
                <div className="space-y-2">
                  {ticket.status === "pending" ? (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => void handleUpdateStatus("in_progress")}
                      disabled={updateMutation.isPending}
                    >
                      <Play className="size-4" />
                      {t.tickets.startProcessing}
                    </Button>
                  ) : null}
                  {ticket.status === "in_progress" ? (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => void handleUpdateStatus("resolved")}
                      disabled={updateMutation.isPending}
                    >
                      <CheckCircle2 className="size-4" />
                      {ticket.contactId
                        ? t.tickets.resolveAndNotify
                        : t.tickets.markResolved}
                    </Button>
                  ) : null}
                  {ticket.status === "resolved" ? (
                    <>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => void handleUpdateStatus("closed")}
                        disabled={updateMutation.isPending}
                      >
                        <Archive className="size-4" />
                        {t.tickets.closeTicket}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => void handleUpdateStatus("in_progress")}
                        disabled={updateMutation.isPending}
                      >
                        <RotateCcw className="size-4" />
                        {t.tickets.reprocess}
                      </Button>
                    </>
                  ) : null}
                  {ticket.status === "closed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => void handleUpdateStatus("in_progress")}
                      disabled={updateMutation.isPending}
                    >
                      <RotateCcw className="size-4" />
                      {t.tickets.reopen}
                    </Button>
                  ) : null}
                </div>
                <div className="border-t border-border pt-4">
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    {t.tickets.updatePriority}
                  </label>
                  <Select value={newPriority} onValueChange={setNewPriority}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t.tickets.selectPriority} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t.tickets.priorityLabels.low}</SelectItem>
                      <SelectItem value="medium">{t.tickets.priorityLabels.medium}</SelectItem>
                      <SelectItem value="high">{t.tickets.priorityLabels.high}</SelectItem>
                      <SelectItem value="urgent">{t.tickets.priorityLabels.urgent}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={handleUpdatePriority}
                    disabled={!newPriority || updateMutation.isPending}
                  >
                    {t.tickets.applyPriority}
                  </Button>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
