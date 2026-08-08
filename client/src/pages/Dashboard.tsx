import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Inbox,
  MessagesSquare,
  Plug,
  Settings,
  Tickets,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function StatCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-left",
        onClick && "transition-colors hover:border-input hover:bg-accent/40"
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </Wrapper>
  );
}

export default function Dashboard() {
  const { workspace, loading } = useWorkspace();
  const t = useT();
  const [, setLocation] = useLocation();

  if (loading || !workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-5" />
      </div>
    );
  }

  const { overview } = workspace;
  const publicChatUrl = `${window.location.origin}/a/${workspace.publicKey}`;

  const checklist = [
    {
      label: t.dashboard.checklistContext,
      done: Boolean(workspace.businessContext?.trim()),
      href: "/settings",
      cta: t.dashboard.goFill,
    },
    {
      label: t.dashboard.checklistKnowledge,
      done: overview.knowledgeTotal > 0,
      href: "/knowledge",
      cta: t.dashboard.goImport,
    },
    {
      label: t.dashboard.checklistPreview,
      done: overview.messagesTotal > 0,
      href: "/chat",
      cta: t.dashboard.goTest,
    },
    {
      label: t.dashboard.checklistChannel,
      done: overview.connectedChannels > 0,
      href: "/channels",
      cta: t.dashboard.goConnect,
    },
  ];
  const remaining = checklist.filter(item => !item.done);

  const shortcuts = [
    {
      title: t.dashboard.shortcutInbox,
      description: t.dashboard.shortcutInboxHint,
      href: "/inbox",
      icon: Inbox,
    },
    {
      title: t.dashboard.shortcutKnowledge,
      description: t.dashboard.shortcutKnowledgeHint,
      href: "/knowledge",
      icon: BookOpen,
    },
    {
      title: t.dashboard.shortcutChat,
      description: t.dashboard.shortcutChatHint,
      href: "/chat",
      icon: MessagesSquare,
    },
    {
      title: t.dashboard.shortcutChannels,
      description: t.dashboard.shortcutChannelsHint,
      href: "/channels",
      icon: Plug,
    },
  ];

  return (
    <AppShell
      title={t.dashboard.title}
      description={workspace.name}
      maxWidth="wide"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLocation("/settings")}
        >
          <Settings className="size-4" />
          {t.common.settings}
        </Button>
      }
    >
      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t.dashboard.workingFor(workspace.agentName)}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t.dashboard.subtitle}
          </p>
        </section>

        {remaining.length > 0 ? (
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-warning" />
              <h3 className="text-sm font-semibold text-foreground">
                {t.dashboard.remainingSteps(remaining.length)}
              </h3>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {checklist.map(item => (
                <li
                  key={item.label}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      item.done
                        ? "border-transparent bg-success text-white"
                        : "border-border bg-background"
                    )}
                  >
                    {item.done ? <Check className="size-3" /> : null}
                  </span>
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      item.done
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                  {item.done ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLocation(item.href)}
                    >
                      {item.cta}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t.dashboard.statKnowledge}
            value={overview.knowledgeTotal}
            hint={
              overview.knowledgeQuarantined > 0
                ? t.dashboard.statKnowledgeQuarantined(
                    overview.knowledgeQuarantined
                  )
                : t.dashboard.statKnowledgeSearchable(
                    overview.knowledgeSearchable
                  )
            }
            onClick={() => setLocation("/knowledge")}
          />
          <StatCard
            label={t.dashboard.statContacts}
            value={overview.contactsTotal}
            hint={t.dashboard.statContactsActive(overview.contactsActive)}
            onClick={() => setLocation("/inbox")}
          />
          <StatCard
            label={t.dashboard.statMessages}
            value={overview.messagesTotal}
            hint={t.dashboard.statMessagesRecent(overview.messagesLast7d)}
            onClick={() => setLocation("/inbox")}
          />
          <StatCard
            label={t.dashboard.statOpenTickets}
            value={overview.ticketsOpen}
            hint={t.dashboard.statTicketsTotal(overview.ticketsTotal)}
            onClick={() => setLocation("/tickets")}
          />
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {t.dashboard.shareLink}
          </h3>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              {publicChatUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(publicChatUrl)
                  .then(() => toast.success(t.common.copied))
                  .catch(() => toast.error(t.common.copyFailed));
              }}
            >
              <Copy className="size-3.5" />
              {t.common.copy}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => window.open(publicChatUrl, "_blank")}
            >
              {t.common.preview}
            </Button>
          </div>
          {!workspace.publicChatEnabled ? (
            <p className="mt-2 text-xs text-warning">
              {t.dashboard.shareLinkDisabled}
            </p>
          ) : null}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {t.dashboard.quickAccess}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {shortcuts.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => setLocation(item.href)}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-accent/40"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setLocation("/tickets")}
              className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-accent/40 sm:col-span-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                <Tickets className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {t.dashboard.shortcutTickets}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t.dashboard.shortcutTicketsHint}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
