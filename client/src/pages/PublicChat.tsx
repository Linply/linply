import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import BrandMark from "@/components/BrandMark";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Bot, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";

type Message = { id: string; role: "user" | "assistant"; content: string };

const VISITOR_STORAGE_PREFIX = "linply:visitor:";

/** Stable anonymous identity so a returning visitor keeps their thread. */
const getVisitorId = (publicKey: string) => {
  const key = `${VISITOR_STORAGE_PREFIX}${publicKey}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID().replace(/-/g, "");
  window.localStorage.setItem(key, created);
  return created;
};

export default function PublicChat() {
  const t = useT();
  const [, params] = useRoute("/a/:publicKey");
  const publicKey = params?.publicKey ?? "";

  const [agent, setAgent] = useState<{
    agentName: string;
    workspaceName: string;
    greeting: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;

    const load = async () => {
      try {
        const visitorId = getVisitorId(publicKey);
        const [profileResponse, historyResponse] = await Promise.all([
          fetch(`/api/public/agent/${publicKey}`),
          fetch(
            `/api/public/agent/${publicKey}/history?visitorId=${encodeURIComponent(visitorId)}`
          ),
        ]);

        if (!profileResponse.ok) {
          const payload = await profileResponse.json().catch(() => null);
          if (!cancelled) {
            setLoadError(payload?.error ?? t.publicChat.notFound);
          }
          return;
        }

        const profile = await profileResponse.json();
        const history = historyResponse.ok
          ? await historyResponse.json()
          : { messages: [] };

        if (cancelled) return;
        setAgent(profile);
        setMessages(
          (history.messages ?? []).map(
            (message: { id: number; role: string; content: string }) => ({
              id: String(message.id),
              role: message.role === "user" ? "user" : "assistant",
              content: message.content,
            })
          )
        );
      } catch {
        if (!cancelled) setLoadError(t.publicChat.connectError);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSendError(null);
    setMessages(current => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content },
    ]);
    setSending(true);

    try {
      const response = await fetch(`/api/public/agent/${publicKey}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          visitorId: getVisitorId(publicKey),
          content,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setSendError(payload?.error ?? t.publicChat.sendFailed);
        return;
      }
      setMessages(current => [
        ...current,
        {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: payload.reply,
        },
      ]);
    } catch {
      setSendError(t.publicChat.networkError);
    } finally {
      setSending(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bot className="size-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-foreground">{loadError}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.publicChat.notFoundHint}
          </p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <BrandMark className="size-9 rounded-full" glyphClassName="size-4" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {agent.agentName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {agent.workspaceName}
            </p>
          </div>
          <LanguageToggle className="ml-auto" />
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-6">
          <div className="flex justify-start">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm leading-6 text-foreground">
              {agent.greeting}
            </div>
          </div>

          {messages.map(message => (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                  message.role === "user"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm bg-muted text-foreground"
                )}
              >
                {message.content}
              </div>
            </div>
          ))}

          {sending ? (
            <div className="flex justify-start">
              <div
                className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-3.5"
                role="status"
                aria-label={t.chat.typing(agent.agentName)}
              >
                {[0, 1, 2].map(index => (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="agent-typing-dot size-1.5 rounded-full bg-muted-foreground/70"
                    style={{ animationDelay: `${index * 160}ms` }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {sendError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
              {sendError}
            </p>
          ) : null}
        </div>
      </div>

      <footer className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <form
          className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3"
          onSubmit={event => {
            event.preventDefault();
            void send();
          }}
        >
          <Input
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder={t.publicChat.inputPlaceholder}
            disabled={sending}
            maxLength={2000}
          />
          <Button
            type="submit"
            size="icon"
            aria-label={t.chat.send}
            disabled={sending || !input.trim()}
          >
            <Send className="size-4" />
          </Button>
        </form>
        <p className="pb-3 text-center text-[0.6875rem] text-muted-foreground">
          {t.publicChat.poweredBy}
        </p>
      </footer>
    </div>
  );
}
