import type { AgentStep } from "@/components/agentTimeline";
import ToolArgsViewer from "@/components/ToolArgsViewer";
import ToolErrorPanel from "@/components/ToolErrorPanel";
import ToolResultViewer from "@/components/ToolResultViewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Hammer,
  MessageSquareText,
  Search,
} from "lucide-react";
import { useState } from "react";

type ToolCallCardProps = {
  step: AgentStep;
  defaultOpen?: boolean;
};

const stepLabels: Record<AgentStep["stepType"], string> = {
  thinking: "分析中",
  tool_call: "工具调用",
  tool_result: "执行结果",
  final: "最终回答",
  error: "执行失败",
};

const stepIcon = (step: AgentStep) => {
  if (step.stepType === "thinking") return Search;
  if (step.stepType === "tool_result") return CheckCircle2;
  if (step.stepType === "error") return AlertCircle;
  if (step.stepType === "final") return MessageSquareText;
  return Hammer;
};

export default function ToolCallCard({
  step,
  defaultOpen = false,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = stepIcon(step);
  const hasDetails = Boolean(
    step.argsSummary || step.resultSummary || step.content || step.error
  );
  const title =
    step.toolName || step.content || step.error || stepLabels[step.stepType];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border bg-card">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-between rounded-lg px-3 py-3 text-left"
            disabled={!hasDetails}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {title}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <Badge variant="outline">{stepLabels[step.stepType]}</Badge>
                  {step.toolName ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {step.toolName}
                    </span>
                  ) : null}
                </span>
              </span>
            </span>
            {hasDetails ? (
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            ) : null}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border p-3">
            {step.argsSummary ? (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">参数摘要</p>
                <ToolArgsViewer value={step.argsSummary} />
              </div>
            ) : null}
            {step.resultSummary ? (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">结果摘要</p>
                <ToolResultViewer value={step.resultSummary} />
              </div>
            ) : null}
            {step.content && step.stepType !== "final" ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {step.content}
              </p>
            ) : null}
            <ToolErrorPanel error={step.error} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
