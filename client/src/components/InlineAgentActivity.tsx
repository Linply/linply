import {
  formatAgentActivity,
  type AgentEvent,
} from "@/components/agentTimeline";
import ToolArgsViewer from "@/components/ToolArgsViewer";
import ToolResultViewer from "@/components/ToolResultViewer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useT } from "@/i18n";
import type { AgentActivityIcon } from "@shared/agentActivity";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ClipboardList,
  FileSearch,
  List,
  MessageSquarePlus,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

export type InlineAgentActivityItem = {
  id: string;
  /** The `thinking` or `tool_call` event that opened this step. */
  event: AgentEvent;
  /** The matching `tool_result`, once it arrives. */
  result?: AgentEvent;
};

type InlineAgentActivityProps = {
  items: InlineAgentActivityItem[];
  runCompleted?: boolean;
};

const ACTIVITY_ICONS: Record<AgentActivityIcon, LucideIcon> = {
  thinking: Search,
  knowledge: BookOpen,
  ticketNew: ClipboardList,
  ticketList: List,
  ticketDetail: FileSearch,
  ticketNote: MessageSquarePlus,
  tool: Wrench,
};

/** Runs recorded before the activity payload existed still need an icon. */
const LEGACY_TOOL_ICONS: Record<string, AgentActivityIcon> = {
  searchKnowledge: "knowledge",
  createTicket: "ticketNew",
  listTickets: "ticketList",
  getTicketById: "ticketDetail",
  addTicketNote: "ticketNote",
};

const iconFor = (item: InlineAgentActivityItem) => {
  const name =
    item.event.activity?.icon ??
    (item.event.type === "thinking"
      ? "thinking"
      : (LEGACY_TOOL_ICONS[item.event.toolName ?? ""] ?? "tool"));
  return ACTIVITY_ICONS[name] ?? Wrench;
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = iconFor(item);

  const toolLabel = item.event.toolName
    ? (t.agentToolLabels[item.event.toolName] ?? item.event.toolName)
    : undefined;
  const callTitle =
    formatAgentActivity(item.event.activity, t.agentActivity, {
      label: toolLabel,
    }) ||
    item.event.message ||
    toolLabel ||
    "";
  const resultTitle = item.result
    ? formatAgentActivity(item.result.activity, t.agentActivity, {
        label: toolLabel,
      })
    : "";

  const failed = item.result?.activity?.phase === "error";
  const done =
    Boolean(item.result) ||
    (item.event.type === "thinking" && (runCompleted || !last));
  /**
   * When the model wrote its own line, that line stays put and the outcome
   * trails it — the row reads as one sentence instead of being replaced
   * mid-flight.
   */
  const keepsIntent = Boolean(item.event.activity?.reason);
  const title = done && !keepsIntent && resultTitle ? resultTitle : callTitle;
  const meta = done && keepsIntent ? resultTitle : "";

  const hasDetails = Boolean(
    item.event.argsSummary ||
      item.event.resultSummary ||
      item.result?.resultSummary ||
      item.result?.content
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="relative pl-6">
        {!last ? (
          <span
            aria-hidden="true"
            className="absolute bottom-[-0.375rem] left-[0.4375rem] top-6 w-px bg-border"
          />
        ) : null}
        <span
          aria-hidden="true"
          className={`absolute left-0 top-1.5 flex size-3.5 items-center justify-center ${
            failed ? "text-destructive" : "text-muted-foreground/70"
          }`}
        >
          <Icon className="size-3.5" />
        </span>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            disabled={!hasDetails}
            className="group flex min-h-6 w-full items-center gap-1.5 py-0.5 text-left text-[13px] leading-5 disabled:cursor-default"
            aria-label={
              hasDetails ? `${title} — ${t.chat.showActivityDetails}` : title
            }
          >
            <span
              className={`min-w-0 truncate transition-colors ${
                failed ? "text-destructive" : "text-muted-foreground"
              } ${!done && !failed ? "agent-activity-pending" : ""} ${
                hasDetails ? "group-hover:text-foreground" : ""
              }`}
            >
              {title}
            </span>
            {meta ? (
              <span className="shrink-0 truncate text-muted-foreground/70">
                · {meta}
              </span>
            ) : null}
            {failed ? (
              <AlertCircle className="size-3.5 shrink-0 text-destructive" />
            ) : null}
            {hasDetails ? (
              <ChevronDown
                className={`size-3.5 shrink-0 text-muted-foreground/0 transition-all duration-200 group-hover:text-muted-foreground/70 ${
                  open ? "rotate-180 text-muted-foreground/70" : ""
                }`}
              />
            ) : null}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
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

/**
 * The whole of the "nothing to show yet" state: one line, in the place the
 * answer will appear, the same height as a line of reply text. The answer
 * replaces it in situ — nothing is added or removed around it, so a view
 * pinned to the bottom does not jump when the first token lands.
 */
export function AgentWorkingLine({ agentName }: { agentName: string }) {
  const t = useT();

  return (
    <div
      className="flex h-7 items-center gap-1.5 text-[13px] leading-5 text-muted-foreground"
      role="status"
      aria-label={t.chat.typing(agentName)}
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="agent-activity-pending">
        {t.agentActivity.thinking({})}
      </span>
    </div>
  );
}

export default function InlineAgentActivity({
  items,
  runCompleted = false,
}: InlineAgentActivityProps) {
  if (items.length === 0) return null;

  return (
    /**
     * No height transition here: rows arrive one at a time while the view is
     * pinned to the bottom, and animating the container's height re-flows the
     * whole thread after each one — which reads as the page bouncing.
     *
     * The small top margin keeps the first row roughly where the working line
     * sat, so swapping one for the other barely moves anything.
     */
    <div className="mb-3 mt-1">
      <div>
        <div className="space-y-0.5">
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
