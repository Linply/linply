import type { AgentStep } from "@/components/agentTimeline";
import PageNav from "@/components/PageNav";
import ToolTimeline from "@/components/ToolTimeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Cpu,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type AgentRunDetailProps = {
  params: { runId: string };
};

const statusLabels: Record<string, string> = {
  queued: "排队中",
  planning: "规划中",
  running: "执行中",
  waiting_approval: "等待确认",
  failed: "失败",
  completed: "已完成",
};

const statusClasses: Record<string, string> = {
  queued: "border-gray-200 bg-gray-100 text-gray-700",
  planning: "border-sky-200 bg-sky-50 text-sky-700",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  waiting_approval: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const riskLabels: Record<string, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  urgent: "紧急",
};

const getMetadata = (metadata: unknown) => {
  if (metadata && typeof metadata === "object") {
    return metadata as Record<string, any>;
  }
  if (typeof metadata !== "string") return {};

  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
};

const formatDuration = (durationMs?: number | null) => {
  if (typeof durationMs !== "number") return "未记录";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))} ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

const formatTokens = (tokens?: number | null) =>
  new Intl.NumberFormat("zh-CN").format(tokens ?? 0);

const formatTimestamp = (value?: string | Date | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "未记录";

export default function AgentRunDetail({ params }: AgentRunDetailProps) {
  const [, setLocation] = useLocation();
  const runId = params.runId;
  const validRunId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId);
  const utils = trpc.useUtils();
  const { data: run, isLoading } = trpc.agentRuns.getById.useQuery(
    { id: runId },
    {
      enabled: validRunId,
      refetchInterval: query => {
        const status = (query.state.data as { status?: string } | undefined)
          ?.status;
        return status === "completed" || status === "failed" ? false : 1_500;
      },
    }
  );
  const retryMutation = trpc.agentRuns.retry.useMutation();

  const retryRun = async () => {
    if (!run) return;

    try {
      const result = await retryMutation.mutateAsync({ id: run.id });
      await utils.agentRuns.getById.invalidate({ id: run.id });
      toast.success("已重新执行");
      setLocation(`/runs/${result.runId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重试失败");
    }
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`已复制${label}`);
    } catch {
      toast.error("复制失败");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pt-[5.75rem]">
        <PageNav />
        <div className="flex h-[calc(100vh-5.75rem)] items-center justify-center">
          <Spinner className="size-5" />
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-background pt-[5.75rem]">
        <PageNav />
        <main className="mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-900">Agent Run 不存在</p>
          <p className="mt-1 text-sm text-gray-500">请检查 Run ID 是否完整或是否有查看权限</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setLocation("/chat")}
          >
            返回智能客服
          </Button>
        </main>
      </div>
    );
  }

  const metadata = getMetadata(run.metadata);
  const structuredOutput = getMetadata(metadata.structuredOutput);
  const handoffEvaluation = getMetadata(metadata.handoffEvaluation);
  const metrics = getMetadata(metadata.metrics);
  const steps = run.steps as AgentStep[];
  const finalStep = steps.find(step => step.stepType === "final");
  const visibleStepCount = steps.filter(step => step.stepType !== "final").length;
  const createdAtLabel = formatDistanceToNow(new Date(run.createdAt), {
    locale: zhCN,
    addSuffix: true,
  });
  const completedAtLabel = run.completedAt
    ? formatDistanceToNow(new Date(run.completedAt), {
        locale: zhCN,
        addSuffix: true,
      })
    : "未完成";
  const durationMs =
    typeof run.durationMs === "number"
      ? run.durationMs
      : typeof metrics.latencyMs === "number"
        ? metrics.latencyMs
        : null;
  const contextUsagePercent = run.contextWindowTokens
    ? Math.min(100, ((run.totalTokens ?? 0) / run.contextWindowTokens) * 100)
    : 0;
  const queueDurationMs = run.startedAt
    ? Math.max(
        0,
        new Date(run.startedAt).getTime() - new Date(run.createdAt).getTime()
      )
    : null;
  const executionDurationMs = run.startedAt && run.completedAt
    ? Math.max(
        0,
        new Date(run.completedAt).getTime() -
          new Date(run.startedAt).getTime()
      )
    : null;

  const metricData = [
    { label: "运行状态", value: statusLabels[run.status] ?? run.status },
    {
      label: "耗时",
      value: formatDuration(durationMs),
    },
    { label: "Token", value: formatTokens(run.totalTokens) },
    { label: "模型请求", value: `${run.llmRequestCount ?? 0} 次` },
    { label: "工具调用", value: `${metrics.toolCallCount ?? 0} 次` },
    { label: "执行模型", value: run.llmModel ?? run.llmProvider ?? "未记录" },
  ];

  return (
    <div className="min-h-screen bg-background pt-[5.75rem]">
      <PageNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-gray-500">Agent 可观测性</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-gray-950">运行详情</h1>
              <Badge
                variant="outline"
                className={statusClasses[run.status] ?? statusClasses.queued}
              >
                {statusLabels[run.status] ?? run.status}
              </Badge>
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
              <code className="break-all font-mono">{run.id}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => copyValue(runId, " Run ID")}
                aria-label="复制 Run ID"
                title="复制 Run ID"
                className="-my-2 shrink-0 text-gray-500"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-400">创建于 {createdAtLabel}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={retryRun}
            disabled={retryMutation.isPending}
          >
            <RefreshCcw className={`size-4 ${retryMutation.isPending ? "animate-spin" : ""}`} />
            {retryMutation.isPending ? "重试中" : "重新执行"}
          </Button>
        </header>

        <section className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-gray-200 bg-white md:grid-cols-3 lg:grid-cols-6">
          {metricData.map((metric, index) => (
            <div
              key={metric.label}
              className={`min-w-0 px-4 py-4 sm:px-5 ${
                index % 2 ? "border-l border-gray-100" : ""
              } ${index >= 2 ? "border-t border-gray-100 md:border-t-0" : ""} ${
                index >= 3 ? "md:border-t" : ""
              } ${
                index > 0 ? "lg:border-l lg:border-gray-100" : ""
              }`}
            >
              <p className="text-xs font-medium text-gray-500">{metric.label}</p>
              <p className="mt-1.5 truncate text-sm font-semibold text-gray-950" title={metric.value}>
                {metric.value}
              </p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-gray-900">输入与回答</h2>
              </div>
              <div className="space-y-5 p-4 sm:p-5">
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-500">用户输入</p>
                  <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm leading-6 text-gray-800">
                    {run.input}
                  </p>
                </div>
                {run.error ? (
                  <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                    <AlertCircle className="mt-1 size-4 shrink-0" />
                    <span>{run.error}</span>
                  </div>
                ) : null}
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-500">最终回答</p>
                  <p className="whitespace-pre-wrap text-sm leading-7 text-gray-800">
                    {run.finalOutput || finalStep?.content || "暂无最终回答"}
                  </p>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-gray-900">执行步骤</h2>
                <span className="text-xs tabular-nums text-gray-500">{visibleStepCount} 步</span>
              </div>
              <div className="p-4 sm:p-5">
                {visibleStepCount === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">暂无执行步骤</p>
                ) : (
                  <ToolTimeline steps={steps} />
                )}
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-6">
            <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">Token 用量</h2>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[11px] text-gray-400">输入</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">
                    {formatTokens(run.inputTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400">输出</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">
                    {formatTokens(run.outputTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400">总计</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">
                    {formatTokens(run.totalTokens)}
                  </p>
                </div>
              </div>
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-gray-500">上下文窗口参考</span>
                  <span className="font-medium tabular-nums text-gray-900">
                    {contextUsagePercent.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-gray-100">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${contextUsagePercent}%` }}
                  />
                </div>
                <p className="mt-2 text-right text-[11px] tabular-nums text-gray-400">
                  {formatTokens(run.totalTokens)} / {formatTokens(run.contextWindowTokens)}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">链路追踪</h2>
              </div>
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">OpenTelemetry Trace ID</dt>
                  <dd className="mt-1.5 flex min-w-0 items-center gap-1.5">
                    <code className="min-w-0 break-all font-mono text-[11px] text-gray-800">
                      {run.traceId ?? "未启用或未导出"}
                    </code>
                    {run.traceId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        onClick={() => copyValue(run.traceId!, " Trace ID")}
                        aria-label="复制 Trace ID"
                        title="复制 Trace ID"
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">执行 Span ID</dt>
                  <dd className="mt-1 font-mono text-[11px] text-gray-800">
                    {run.spanId ?? "未记录"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">OpenAI Agent Trace ID</dt>
                  <dd className="mt-1 break-all font-mono text-[11px] text-gray-800">
                    {metadata.tracing?.traceId ?? "未启用"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-gray-900">结构化结果</h2>
              {structuredOutput.summary ? (
                <div className="mt-4 space-y-4 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{structuredOutput.category ?? "other"}</Badge>
                    <Badge variant="outline">
                      {riskLabels[structuredOutput.riskLevel] ?? structuredOutput.riskLevel}
                    </Badge>
                  </div>
                  <p className="font-medium leading-6 text-gray-900">
                    {structuredOutput.summary}
                  </p>
                  {Array.isArray(structuredOutput.suggestedActions) ? (
                    <ul className="space-y-2.5 text-gray-600">
                      {structuredOutput.suggestedActions.map((action: string, index: number) => (
                        <li key={index} className="flex gap-2 leading-5">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-sm text-gray-500">暂无结构化结果</p>
              )}
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Clock3 className="size-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">运行信息</h2>
              </div>
              <dl className="mt-4 divide-y divide-gray-100 text-sm">
                <div className="flex items-start justify-between gap-4 py-3 first:pt-0">
                  <dt className="text-gray-500">提供方</dt>
                  <dd className="text-right font-medium text-gray-900">{run.llmProvider ?? "未记录"}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-gray-500">排队耗时</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {formatDuration(queueDurationMs)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-gray-500">执行耗时</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {formatDuration(executionDurationMs)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-gray-500">尝试次数</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {Math.max(1, run.attemptCount ?? 0)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-gray-500">开始时间</dt>
                  <dd className="text-right text-xs font-medium text-gray-900">
                    {formatTimestamp(run.startedAt)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-gray-500">建议接力</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {handoffEvaluation.recommendedAgent ?? "无"}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3 last:pb-0">
                  <dt className="text-gray-500">完成时间</dt>
                  <dd className="text-right font-medium text-gray-900">{completedAtLabel}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
