import ToolTimeline from "@/components/ToolTimeline";
import PageNav from "@/components/PageNav";
import type { AgentStep } from "@/components/agentTimeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

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
  queued: "bg-gray-100 text-gray-700",
  planning: "bg-blue-100 text-blue-700",
  running: "bg-blue-100 text-blue-700",
  waiting_approval: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  completed: "bg-emerald-100 text-emerald-700",
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

export default function AgentRunDetail({ params }: AgentRunDetailProps) {
  const [, setLocation] = useLocation();
  const runId = params.runId;
  const validRunId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId);
  const utils = trpc.useUtils();
  const { data: run, isLoading } = trpc.agentRuns.getById.useQuery(
    { id: runId },
    { enabled: validRunId }
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 pt-14">
        <PageNav />
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-gray-50 pt-14">
        <PageNav />
        <main className="mx-auto max-w-4xl px-6 py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-lg text-gray-500">Agent Run 不存在</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setLocation("/chat")}
              >
                返回聊天
              </Button>
            </CardContent>
          </Card>
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

  return (
    <div className="min-h-screen bg-gray-50 pt-14">
      <PageNav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Button
              variant="ghost"
              className="mb-2 px-0 text-gray-600"
              onClick={() => setLocation("/chat")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回聊天
            </Button>
            <h1 className="text-3xl font-bold text-gray-900">
              Agent Run {run.id}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              创建于{" "}
              {formatDistanceToNow(new Date(run.createdAt), {
                locale: zhCN,
                addSuffix: true,
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className={statusClasses[run.status] ?? ""}>
              {statusLabels[run.status] ?? run.status}
            </Badge>
            {run.llmProvider ? (
              <Badge variant="outline">{run.llmProvider}</Badge>
            ) : null}
            {run.llmModel ? <Badge variant="outline">{run.llmModel}</Badge> : null}
            <Button
              variant="outline"
              onClick={retryRun}
              disabled={retryMutation.isPending}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {retryMutation.isPending ? "重试中..." : "重试"}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>输入与最终回答</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-500">用户输入</p>
                  <p className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-gray-800">
                    {run.input}
                  </p>
                </div>
                {run.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <div className="flex gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{run.error}</span>
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-500">最终回答</p>
                  <p className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-gray-800">
                    {run.finalOutput || finalStep?.content || "暂无最终回答"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>执行步骤</CardTitle>
              </CardHeader>
              <CardContent>
                {steps.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">暂无步骤</p>
                ) : (
                  <ToolTimeline steps={steps} />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>结构化结果</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {structuredOutput.summary ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {structuredOutput.category ?? "other"}
                      </Badge>
                      <Badge variant="outline">
                        {riskLabels[structuredOutput.riskLevel] ??
                          structuredOutput.riskLevel}
                      </Badge>
                    </div>
                    <p className="font-medium text-gray-900">
                      {structuredOutput.summary}
                    </p>
                    {Array.isArray(structuredOutput.suggestedActions) ? (
                      <ul className="space-y-2 text-gray-700">
                        {structuredOutput.suggestedActions.map(
                          (action: string, index: number) => (
                            <li key={index} className="flex gap-2">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                              <span>{action}</span>
                            </li>
                          )
                        )}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="text-gray-500">暂无结构化结果</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>运行元数据</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <span>耗时</span>
                  <span className="font-medium">
                    {typeof metrics.latencyMs === "number"
                      ? `${metrics.latencyMs} ms`
                      : "未知"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>工具调用</span>
                  <span className="font-medium">
                    {metrics.toolCallCount ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>建议接力</span>
                  <span className="font-medium">
                    {handoffEvaluation.recommendedAgent ?? "无"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>完成时间</span>
                  <span className="font-medium">
                    {run.completedAt
                      ? formatDistanceToNow(new Date(run.completedAt), {
                          locale: zhCN,
                          addSuffix: true,
                        })
                      : "未完成"}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-md bg-gray-100 p-3 text-gray-600">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>刷新页面后仍可从该页面恢复步骤与错误信息。</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
