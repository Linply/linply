import { useEffect, useRef, useState } from "react";
import type { TokenQuotaSnapshot } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const TOKENS_PER_CREDIT = 1_000;

const creditsFromTokens = (tokens: number) => tokens / TOKENS_PER_CREDIT;

const formatCredits = (tokens: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(creditsFromTokens(tokens));

const getUsedPercent = (quota: TokenQuotaSnapshot) => {
  if (quota.quotaLimitTokens <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (quota.usedTokens / quota.quotaLimitTokens) * 100)
  );
};

const getRingColor = (usedPercent: number, hasError: boolean) => {
  if (hasError || usedPercent >= 90) return "#dc2626";
  if (usedPercent >= 70) return "#d97706";
  return "#30363d";
};

type CreditQuotaIndicatorProps = {
  quota: TokenQuotaSnapshot;
  error?: string | null;
};

export default function CreditQuotaIndicator({
  quota,
  error,
}: CreditQuotaIndicatorProps) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const usedPercent = getUsedPercent(quota);
  const ringColor = getRingColor(usedPercent, Boolean(error));
  const isUnlimited = quota.quotaLimitTokens === 0;
  const remainingTokens = quota.remainingTokens ?? 0;
  const balanceLabel = isUnlimited
    ? "Credit 不限额"
    : `剩余 ${formatCredits(remainingTokens)} Credit`;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideInteraction = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && !detailsRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("focusin", closeOnOutsideInteraction);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("focusin", closeOnOutsideInteraction);
    };
  }, [open]);

  return (
    <Collapsible
      ref={detailsRef}
      open={open}
      onOpenChange={setOpen}
      className="absolute bottom-3 right-14 size-10"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full p-0 hover:bg-transparent data-[state=open]:bg-transparent"
          aria-label={`${balanceLabel}，点击${open ? "收起" : "查看"}用量详情`}
          title={`${balanceLabel}，点击查看详情`}
        >
          <span className="relative h-10 w-10">
            <svg
              className="absolute bottom-0 left-1.5 size-7 -rotate-90"
              viewBox="0 0 40 40"
              aria-hidden="true"
            >
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="#cfd4da"
                strokeWidth="2.5"
              />
              {usedPercent > 0 ? (
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  pathLength="100"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="100"
                  strokeDashoffset={100 - usedPercent}
                  className="transition-[stroke-dashoffset,stroke] duration-300"
                />
              ) : null}
            </svg>
          </span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="absolute bottom-12 right-0 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-600 shadow-lg">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Credit 用量</h2>
          {!quota.enforced || isUnlimited ? (
            <Badge variant="outline">观测模式</Badge>
          ) : null}
          {quota.adminExempt ? (
            <Badge variant="outline">管理员豁免</Badge>
          ) : null}
        </div>

        <div className="mt-3 flex items-end justify-between border-b border-gray-100 pb-3">
          <div>
            <p className="text-gray-500">可用余额</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-gray-950">
              {isUnlimited ? "不限额" : formatCredits(remainingTokens)}
              {!isUnlimited ? (
                <span className="ml-1 text-xs font-medium text-gray-500">
                  Credit
                </span>
              ) : null}
            </p>
          </div>
          {!isUnlimited ? (
            <span className="pb-0.5 font-medium tabular-nums text-gray-700">
              {Math.round(usedPercent)}% 已消耗
            </span>
          ) : null}
        </div>

        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 tabular-nums">
          <dt>今日额度</dt>
          <dd className="text-right font-medium text-gray-900">
            {isUnlimited
              ? "不限额"
              : `${formatCredits(quota.quotaLimitTokens)} Credit`}
          </dd>
          <dt>已消耗</dt>
          <dd className="text-right font-medium text-gray-900">
            {formatCredits(quota.usedTokens)} Credit
          </dd>
          <dt>处理中预留</dt>
          <dd className="text-right font-medium text-gray-900">
            {formatCredits(quota.reservedTokens)} Credit
          </dd>
          <dt>重置时间</dt>
          <dd className="text-right font-medium text-gray-900">
            {new Date(quota.resetAt).toLocaleString("zh-CN", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </dl>
        {error ? <p className="mt-2 text-red-700">{error}</p> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
