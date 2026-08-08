import type { AgentEvent } from "@/components/agentTimeline";
import ToolArgsViewer from "@/components/ToolArgsViewer";
import ToolResultViewer from "@/components/ToolResultViewer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileSearch,
  Hammer,
  List,
  MessageSquarePlus,
  Search,
  Wrench,
} from "lucide-react";
import { useState } from "react";

export type InlineAgentActivityItem = {
  id: string;
  event: AgentEvent;
  result?: AgentEvent;
};

type InlineAgentActivityProps = {
  items: InlineAgentActivityItem[];
  visible: boolean;
  runCompleted?: boolean;
};

const toolLabels: Record<string, string> = {
  searchKnowledge: "检索知识库",
  createTicket: "创建工单",
  listTickets: "查询工单列表",
  getTicketById: "读取工单详情",
  addTicketNote: "添加工单备注",
};

const getActivityTitle = (item: InlineAgentActivityItem) => {
  if (item.event.type === "thinking") {
    return item.event.message || "正在分析问题";
  }
  if (item.event.toolName) {
    return toolLabels[item.event.toolName] || item.event.toolName;
  }
  return item.result ? "步骤已完成" : "正在执行";
};

const getActivityIcon = (item: InlineAgentActivityItem) => {
  if (item.event.type === "thinking") return Search;
  if (item.event.toolName === "searchKnowledge") return BookOpen;
  if (item.event.toolName === "createTicket") return ClipboardList;
  if (item.event.toolName === "listTickets") return List;
  if (item.event.toolName === "getTicketById") return FileSearch;
  if (item.event.toolName === "addTicketNote") return MessageSquarePlus;
  return Wrench;
};

function ActivityRow({
  item,
  last,
  runCompleted,
}: {
  item: InlineAgentActivityItem;
  last: boolean;
  runCompleted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = getActivityIcon(item);
  const complete =
    Boolean(item.result) ||
    (item.event.type === "thinking" && (runCompleted || !last));
  const hasDetails = Boolean(
    item.event.argsSummary ||
      item.event.resultSummary ||
      item.result?.resultSummary ||
      item.result?.content
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="relative pl-7">
        {!last ? (
          <span
            aria-hidden="true"
            className="absolute bottom-[-0.5rem] left-[0.1875rem] top-3 w-px bg-muted-foreground/60"
          />
        ) : null}
        <span
          aria-hidden="true"
          className={`absolute left-0 top-[0.5625rem] size-1.5 rounded-full ring-2 ring-background ${
            complete ? "bg-muted-foreground" : "bg-blue-500"
          }`}
        >
          {!complete ? (
            <span className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-40 motion-reduce:hidden" />
          ) : null}
        </span>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            disabled={!hasDetails}
            className="group flex min-h-6 w-full items-center gap-2 py-0.5 text-left text-[13px] leading-5 text-muted-foreground disabled:cursor-default"
            aria-label={`${getActivityTitle(item)}${hasDetails ? "，展开详情" : ""}`}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate group-hover:text-foreground">
              {getActivityTitle(item)}
            </span>
            {complete ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            {hasDetails ? (
              <ChevronDown
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              />
            ) : null}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 pb-2 pt-1 text-xs text-muted-foreground">
            {item.event.argsSummary ? (
              <ToolArgsViewer value={item.event.argsSummary} />
            ) : null}
            {item.result?.resultSummary || item.event.resultSummary ? (
              <ToolResultViewer
                value={item.result?.resultSummary || item.event.resultSummary}
              />
            ) : null}
            {item.result?.content ? (
              <p className="whitespace-pre-wrap leading-5">
                {item.result.content}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function AgentWorkingStatus({ visible }: { visible: boolean }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none ${
        visible
          ? "mt-2 grid-rows-[1fr] opacity-100"
          : "pointer-events-none mt-0 grid-rows-[0fr] opacity-0"
      }`}
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex min-h-6 items-center gap-2 py-0.5 text-[13px] leading-5 text-muted-foreground">
          <Hammer className="size-4 shrink-0 animate-bounce text-muted-foreground motion-reduce:animate-none" />
          <span>loading...</span>
        </div>
      </div>
    </div>
  );
}

export default function InlineAgentActivity({
  items,
  visible,
  runCompleted = false,
}: InlineAgentActivityProps) {
  if (items.length === 0) return null;

  return (
    <div
      className={`grid transition-[grid-template-rows,opacity,margin] duration-500 ease-out motion-reduce:transition-none ${
        visible
          ? "my-3 grid-rows-[1fr] opacity-100"
          : "pointer-events-none my-0 grid-rows-[0fr] opacity-0"
      }`}
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="py-0.5">
          {items.map((item, index) => (
            <ActivityRow
              key={item.id}
              item={item}
              last={index === items.length - 1}
              runCompleted={runCompleted}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
