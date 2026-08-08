import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useT, type Dictionary } from "@/i18n";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  Copy,
  ExternalLink,
  Loader2,
  Plug,
  Power,
  RadioTower,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type ChannelListOutput = inferRouterOutputs<AppRouter>["channels"]["list"];
type ProviderRow = ChannelListOutput["providers"][number];

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-success-soft text-success",
  pending: "bg-warning-soft text-warning",
  error: "bg-destructive/10 text-destructive",
  disabled: "bg-muted text-muted-foreground",
};

const statusLabel = (t: Dictionary, status: string) =>
  ({
    connected: t.channels.statusConnected,
    pending: t.channels.statusPending,
    error: t.channels.statusError,
    disabled: t.channels.statusDisabled,
  })[status] ?? status;

function StatusPill({ status }: { status: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {statusLabel(t, status)}
    </span>
  );
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const t = useT();
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`${t.common.copy} ${label}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => toast.success(t.common.copied))
              .catch(() => toast.error(t.common.copyFailed));
          }}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function TelegramCard({
  row,
  webhookReady,
}: {
  row: ProviderRow;
  webhookReady: boolean;
}) {
  const t = useT();
  const copy = t.channelProviders[row.provider];
  const utils = trpc.useUtils();
  const [botToken, setBotToken] = useState("");
  const connect = trpc.channels.connectTelegram.useMutation();
  const disconnect = trpc.channels.disconnect.useMutation();
  const setAutoReply = trpc.channels.setAutoReply.useMutation();

  const refresh = async () => {
    await Promise.all([
      utils.channels.list.invalidate(),
      utils.workspace.get.invalidate(),
    ]);
  };

  const connection = row.connection;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {copy.name}
            </h3>
            {connection ? <StatusPill status={connection.status} /> : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.tagline}
          </p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
          <RadioTower className="size-4" />
        </span>
      </div>

      {connection ? (
        <div className="mt-4 space-y-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t.channels.botAccount}</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {connection.displayName ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t.channels.deliveryMode}</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {connection.deliveryMode === "webhook"
                  ? t.channels.deliveryWebhook
                  : t.channels.deliveryPolling}
              </dd>
            </div>
          </dl>

          {connection.lastError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
              {t.channels.lastError(connection.lastError)}
            </p>
          ) : null}

          {row.inviteUrl ? (
            <a
              href={row.inviteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              {t.channels.open(connection.displayName ?? "")}
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={setAutoReply.isPending}
              onClick={async () => {
                await setAutoReply.mutateAsync({
                  provider: "telegram",
                  autoReply: !connection.autoReply,
                });
                await refresh();
              }}
            >
              <Power className="size-3.5" />
              {connection.autoReply
                ? t.channels.pauseAutoReply
                : t.channels.resumeAutoReply}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t.channels.disconnect}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.channels.disconnectTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.channels.disconnectDescription}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      await disconnect.mutateAsync({ provider: "telegram" });
                      await refresh();
                      toast.success(t.channels.disconnected);
                    }}
                  >
                    {t.channels.disconnectConfirm}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {!connection.autoReply ? (
            <p className="text-xs text-warning">
              {t.channels.autoReplyPaused}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <ol className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            <li>{t.channels.telegramStep1}</li>
            <li>{t.channels.telegramStep2}</li>
            <li>{t.channels.telegramStep3}</li>
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={botToken}
              onChange={event => setBotToken(event.target.value)}
              placeholder="123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              disabled={connect.isPending || !botToken.trim()}
              onClick={async () => {
                try {
                  const result = await connect.mutateAsync({
                    botToken: botToken.trim(),
                  });
                  setBotToken("");
                  await refresh();
                  toast.success(
                    result.deliveryMode === "webhook"
                      ? t.onboarding.connectedVia(
                          result.channel.displayName ?? ""
                        )
                      : t.onboarding.connectedViaPolling(
                          result.channel.displayName ?? ""
                        )
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t.onboarding.connectFailed
                  );
                }
              }}
            >
              {connect.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              {t.onboarding.connect}
            </Button>
          </div>
          {!webhookReady ? (
            <p className="text-xs text-muted-foreground">
              {t.channels.noPublicUrl}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function Channels() {
  const { workspace, loading } = useWorkspace();
  const t = useT();
  const channelsQuery = trpc.channels.list.useQuery(undefined, {
    enabled: Boolean(workspace),
  });

  if (loading || !workspace || channelsQuery.isLoading) {
    return (
      <AppShell title={t.channels.title}>
        <div className="flex justify-center py-16">
          <Spinner className="size-5" />
        </div>
      </AppShell>
    );
  }

  const data = channelsQuery.data;
  const providers = data?.providers ?? [];
  const webRow = providers.find(row => row.provider === "web");
  const telegramRow = providers.find(row => row.provider === "telegram");
  const plannedRows = providers.filter(row => !row.available);

  return (
    <AppShell
      title={t.channels.title}
      description={t.channels.subtitle}
      maxWidth="wide"
    >
      <div className="space-y-4">
        {webRow ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {t.channelProviders.web.name}
                  </h3>
                  <StatusPill
                    status={workspace.publicChatEnabled ? "connected" : "disabled"}
                  />
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t.channelProviders.web.tagline}
                </p>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                <ExternalLink className="size-4" />
              </span>
            </div>
            <div className="mt-4">
              <CopyRow
                label={t.channels.customerUrl}
                value={data?.publicChatUrl ?? ""}
              />
            </div>
            {!workspace.publicChatEnabled ? (
              <p className="mt-2 text-xs text-warning">
                {t.channels.shareLinkOff}
              </p>
            ) : null}
          </div>
        ) : null}

        {telegramRow ? (
          <TelegramCard
            row={telegramRow}
            webhookReady={Boolean(data?.webhookReady)}
          />
        ) : null}

        {plannedRows.length > 0 ? (
          <div className="rounded-xl border border-dashed border-border p-5">
            <h3 className="text-sm font-semibold text-foreground">
              {t.channels.planned}
            </h3>
            <ul className="mt-3 space-y-3">
              {plannedRows.map(row => (
                <li key={row.provider} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Plug className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t.channelProviders[row.provider].name}
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t.channelProviders[row.provider].tagline}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {t.channels.plannedNote}
            </p>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
