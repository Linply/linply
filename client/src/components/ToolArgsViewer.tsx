import { formatJsonSummary } from "@/components/agentTimeline";

type ToolArgsViewerProps = {
  value?: string | null;
};

export default function ToolArgsViewer({ value }: ToolArgsViewerProps) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md border border-border bg-card p-3 text-xs leading-5 text-muted-foreground">
      {formatJsonSummary(value) || "无参数"}
    </pre>
  );
}
