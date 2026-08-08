import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIntlLocale, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { TokenQuotaSnapshot } from "@shared/types";
import { Coins } from "lucide-react";

const TOKENS_PER_CREDIT = 1_000;

const creditsFromTokens = (tokens: number) => tokens / TOKENS_PER_CREDIT;

const formatCredits = (tokens: number) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: tokens < TOKENS_PER_CREDIT ? 2 : 1,
  }).format(creditsFromTokens(tokens));

const getUsedPercent = (quota: TokenQuotaSnapshot) => {
  if (quota.quotaLimitTokens <= 0) return 0;
  return Math.min(
    100,
    Math.max(
      0,
      ((quota.usedTokens + quota.reservedTokens) / quota.quotaLimitTokens) * 100
    )
  );
};

/** Green until two thirds spent, amber past that, red when nearly exhausted. */
const getToneClasses = (usedPercent: number, hasError: boolean) => {
  if (hasError || usedPercent >= 90) {
    return { stroke: "stroke-destructive", text: "text-destructive" };
  }
  if (usedPercent >= 66) {
    return { stroke: "stroke-warning", text: "text-warning" };
  }
  return { stroke: "stroke-primary", text: "text-foreground" };
};

function CreditRing({
  usedPercent,
  className,
}: {
  usedPercent: number;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 40 40" className={cn("-rotate-90", className)} aria-hidden="true">
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        className="stroke-border"
        strokeWidth="5"
      />
      {usedPercent > 0 ? (
        <circle
          cx="20"
          cy="20"
          r="16"
          pathLength="100"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="100"
          strokeDashoffset={100 - usedPercent}
          className="transition-[stroke-dashoffset] duration-500"
        />
      ) : null}
    </svg>
  );
}

export type CreditQuotaIndicatorProps = {
  /** Falls back to the shared query when the caller has no fresher snapshot. */
  quota?: TokenQuotaSnapshot | null;
  error?: string | null;
  className?: string;
};

export default function CreditQuotaIndicator({
  quota: quotaOverride,
  error,
  className,
}: CreditQuotaIndicatorProps) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const quotaQuery = trpc.agentRuns.getTokenQuota.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const quota = quotaOverride ?? quotaQuery.data ?? null;

  if (!quota) return null;

  const usedPercent = getUsedPercent(quota);
  const tone = getToneClasses(usedPercent, Boolean(error));
  const isUnlimited = quota.quotaLimitTokens === 0;
  const remainingTokens = quota.remainingTokens ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-3 text-xs transition-colors hover:bg-accent/60",
            className
          )}
          aria-label={t.credits.view}
        >
          <span className="relative flex size-5 items-center justify-center">
            <CreditRing usedPercent={usedPercent} className={cn("size-5", tone.stroke)} />
            <Coins className="absolute size-2.5 text-muted-foreground" />
          </span>
          <span className={cn("font-medium tabular-nums", tone.text)}>
            {isUnlimited ? t.credits.unlimited : formatCredits(remainingTokens)}
          </span>
          {!isUnlimited ? (
            <span className="text-muted-foreground">{t.credits.label}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[min(20rem,calc(100vw-2rem))] p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t.credits.title}</h2>
          {!quota.enforced || isUnlimited ? (
            <Badge variant="outline" className="text-[0.6875rem]">
              {t.credits.observationMode}
            </Badge>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-3 border-b border-border pb-3">
          <span className="relative flex size-11 shrink-0 items-center justify-center">
            <CreditRing
              usedPercent={usedPercent}
              className={cn("size-11", tone.stroke)}
            />
            <span className="absolute text-[0.625rem] font-medium tabular-nums text-muted-foreground">
              {isUnlimited ? "∞" : `${Math.round(usedPercent)}%`}
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t.credits.available}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums leading-tight text-foreground">
              {isUnlimited ? t.credits.unlimited : formatCredits(remainingTokens)}
              {!isUnlimited ? (
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  {t.credits.label}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs tabular-nums text-muted-foreground">
          <dt>{t.credits.dailyQuota}</dt>
          <dd className="text-right font-medium text-foreground">
            {isUnlimited
              ? t.credits.unlimited
              : `${formatCredits(quota.quotaLimitTokens)} ${t.credits.label}`}
          </dd>
          <dt>{t.credits.used}</dt>
          <dd className="text-right font-medium text-foreground">
            {formatCredits(quota.usedTokens)} {t.credits.label}
          </dd>
          <dt>{t.credits.reserved}</dt>
          <dd className="text-right font-medium text-foreground">
            {formatCredits(quota.reservedTokens)} {t.credits.label}
          </dd>
          <dt>{t.credits.resetAt}</dt>
          <dd className="text-right font-medium text-foreground">
            {new Date(quota.resetAt).toLocaleString(intlLocale, {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </dl>

        <p className="mt-3 text-[0.6875rem] leading-4 text-muted-foreground">
          {t.credits.footnote}
        </p>
        {error ? (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
