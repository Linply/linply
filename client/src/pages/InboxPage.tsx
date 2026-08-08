import AppShell from "@/components/AppShell";
import { Spinner } from "@/components/ui/spinner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDateLocale, useT, type Dictionary } from "@/i18n";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { formatDistanceToNow } from "date-fns";
import type { Locale } from "date-fns";
import { Bot, Globe, Inbox, Send, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

const providerLabel = (t: Dictionary, provider: string) =>
  t.channelProviders[provider as keyof Dictionary["channelProviders"]]?.name ??
  provider;

const providerIcon = (provider: string) =>
  provider === "telegram" ? Send : provider === "web" ? Globe : UserRound;

const relativeTime = (
  value: Date | string | null | undefined,
  locale: Locale
) => {
  if (!value) return "—";
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale });
};

export default function InboxPage() {
  const { workspace, loading } = useWorkspace();
  const t = useT();
  const dateLocale = useDateLocale();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const contactsQuery = trpc.inbox.listContacts.useQuery(
    { limit: 50 },
    {
      enabled: Boolean(workspace),
      // Channel traffic arrives outside this tab, so poll while it is open.
      refetchInterval: 10_000,
    }
  );

  const conversationQuery = trpc.inbox.getConversation.useQuery(
    { contactId: selectedId ?? 0, limit: 100 },
    { enabled: selectedId !== null, refetchInterval: 10_000 }
  );

  const contacts = contactsQuery.data ?? [];

  useEffect(() => {
    if (selectedId === null && contacts.length > 0) {
      setSelectedId(contacts[0].id);
    }
  }, [contacts, selectedId]);

  if (loading || !workspace) {
    return (
      <AppShell title={t.inbox.title}>
        <div className="flex justify-center py-16">
          <Spinner className="size-5" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={t.inbox.title}
      description={t.inbox.subtitle}
      maxWidth="full"
      fullBleed
    >
      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 md:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-border md:border-b-0 md:border-r">
          {contactsQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="size-4" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="size-4" />
              </span>
              <p className="mt-3 text-sm font-medium text-foreground">
                {t.inbox.emptyTitle}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t.inbox.emptyHint}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map(contact => {
                const Icon = providerIcon(contact.provider);
                const active = contact.id === selectedId;
                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(contact.id)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                        active ? "bg-primary-soft" : "hover:bg-accent/50"
                      )}
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {contact.displayName ||
                              contact.username ||
                              t.inbox.visitor(contact.id)}
                          </span>
                          <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                            {relativeTime(contact.lastMessageAt, dateLocale)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {contact.lastMessage || t.inbox.noMessages}
                        </span>
                        <span className="mt-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                          {providerLabel(t, contact.provider)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-h-0 flex-col">
          {selectedId === null ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t.inbox.selectContact}
              </p>
            </div>
          ) : conversationQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : (
            <>
              <div className="border-b border-border px-5 py-3">
                <p className="text-sm font-medium text-foreground">
                  {conversationQuery.data?.contact.displayName ||
                    conversationQuery.data?.contact.username ||
                    t.inbox.visitor(selectedId)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {providerLabel(
                    t,
                    conversationQuery.data?.contact.provider ?? ""
                  )}
                  {" · "}
                  {t.inbox.messageCount(
                    conversationQuery.data?.contact.messageCount ?? 0
                  )}
                </p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {(conversationQuery.data?.messages ?? []).map(message => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.role === "user" ? "justify-start" : "justify-end"
                    )}
                  >
                    <div className="max-w-[80%]">
                      <div
                        className={cn(
                          "whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                          message.role === "user"
                            ? "rounded-bl-sm bg-muted text-foreground"
                            : "rounded-br-sm bg-primary text-primary-foreground"
                        )}
                      >
                        {message.content}
                      </div>
                      <div
                        className={cn(
                          "mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground",
                          message.role === "user"
                            ? "justify-start"
                            : "justify-end"
                        )}
                      >
                        {message.role === "assistant" ? (
                          <Bot className="size-3" />
                        ) : null}
                        <span>{relativeTime(message.createdAt, dateLocale)}</span>
                        {message.relatedKnowledge.length > 0 ? (
                          <span>
                            ·{" "}
                            {t.inbox.citedKnowledge(
                              message.relatedKnowledge.length
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border px-5 py-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  {t.inbox.readOnlyNote}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
