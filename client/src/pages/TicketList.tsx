import AppShell from "@/components/AppShell";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronRight, Plus, RotateCcw, Search, Tickets } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

const ALL_STATUSES = "all_statuses";
const ALL_PRIORITIES = "all_priorities";
const ticketStatuses = new Set(["pending", "in_progress", "resolved", "closed"]);

const getInitialStatus = () => {
  if (typeof window === "undefined") return ALL_STATUSES;
  const status = new URLSearchParams(window.location.search).get("status");
  return status && ticketStatuses.has(status) ? status : ALL_STATUSES;
};

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
  closed: "border-border bg-muted text-muted-foreground",
};

const priorityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

const priorityDots: Record<string, string> = {
  low: "bg-muted-foreground",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

export default function TicketList() {
  const t = useT();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(getInitialStatus);
  const [priorityFilter, setPriorityFilter] = useState(ALL_PRIORITIES);

  const { data: tickets, isLoading } = trpc.tickets.list.useQuery({
    search: search || undefined,
    status: statusFilter === ALL_STATUSES ? undefined : statusFilter,
    priority: priorityFilter === ALL_PRIORITIES ? undefined : priorityFilter,
    limit: 50,
  });

  const resetFilters = () => {
    setSearch("");
    setStatusFilter(ALL_STATUSES);
    setPriorityFilter(ALL_PRIORITIES);
  };

  const hasFilters =
    Boolean(search) ||
    statusFilter !== ALL_STATUSES ||
    priorityFilter !== ALL_PRIORITIES;

  return (
    <AppShell
      title={t.tickets.title}
      description={
        isLoading ? t.common.loading : t.tickets.resultCount(tickets?.length ?? 0)
      }
      maxWidth="wide"
      actions={
        <Button onClick={() => setLocation("/ticket/create")} size="sm">
          <Plus className="size-4" />
          {t.tickets.create}
        </Button>
      }
    >
      <div>

        <section className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-card p-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索工单"
              placeholder="搜索标题或描述"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="border-transparent bg-muted/60 pl-9 focus-visible:bg-card"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>全部状态</SelectItem>
              <SelectItem value="pending">待处理</SelectItem>
              <SelectItem value="in_progress">处理中</SelectItem>
              <SelectItem value="resolved">已解决</SelectItem>
              <SelectItem value="closed">已关闭</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="优先级" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PRIORITIES}>全部优先级</SelectItem>
              <SelectItem value="low">低优先级</SelectItem>
              <SelectItem value="medium">中优先级</SelectItem>
              <SelectItem value="high">高优先级</SelectItem>
              <SelectItem value="urgent">紧急</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            disabled={!hasFilters}
            className="sm:w-9 sm:px-0"
            aria-label="重置筛选"
            title="重置筛选"
          >
            <RotateCcw className="size-4" />
            <span className="sm:hidden">重置筛选</span>
          </Button>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          {isLoading ? (
            <div className="flex h-56 items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : !tickets || tickets.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center px-6 text-center">
              <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Tickets className="size-5" />
              </span>
              <p className="text-sm font-medium text-foreground">没有找到工单</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasFilters ? "尝试调整筛选条件" : "创建第一条工单后会显示在这里"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tickets.map((ticket: any) => (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => setLocation(`/ticket/${ticket.id}`)}
                  className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-accent/50 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_1rem] sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        #{ticket.id}
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">
                        {ticket.title}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                      {ticket.description}
                    </span>
                    <span className="mt-2 flex items-center gap-3 sm:hidden">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                          statusClasses[ticket.status] ?? statusClasses.closed
                        }`}
                      >
                        {statusLabels[ticket.status] ?? ticket.status}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className={`size-1.5 rounded-full ${
                            priorityDots[ticket.priority] ?? priorityDots.low
                          }`}
                        />
                        {priorityLabels[ticket.priority] ?? ticket.priority}
                      </span>
                    </span>
                  </span>

                  <span
                    className={`hidden w-fit rounded-md border px-2 py-0.5 text-xs font-medium sm:inline-flex ${
                      statusClasses[ticket.status] ?? statusClasses.closed
                    }`}
                  >
                    {statusLabels[ticket.status] ?? ticket.status}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    <span className="mb-1 flex items-center gap-1.5">
                      <span
                        className={`size-1.5 rounded-full ${
                          priorityDots[ticket.priority] ?? priorityDots.low
                        }`}
                      />
                      {priorityLabels[ticket.priority] ?? ticket.priority}优先级
                    </span>
                    {formatDistanceToNow(new Date(ticket.createdAt), {
                      locale: zhCN,
                      addSuffix: true,
                    })}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
