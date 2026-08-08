import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { WorkspacePlan } from "@shared/plans";
import { Check, Info, Loader2, Minus } from "lucide-react";
import { toast } from "sonner";

type LimitKey =
  | "knowledgeEntries"
  | "dailyTokens"
  | "connectedChannels"
  | "monthlyContacts";

type FeatureKey =
  | "shareLink"
  | "telegram"
  | "removeBranding"
  | "customerCards"
  | "prioritySupport";

const PLAN_ACCENT: Record<WorkspacePlan, string> = {
  free: "border-border",
  pro: "border-primary ring-1 ring-primary/25",
  business: "border-border",
  self_hosted: "border-dashed border-border",
};

export default function Plans() {
  const t = useT();
  const utils = trpc.useUtils();
  const plansQuery = trpc.plans.get.useQuery();
  const requestUpgrade = trpc.plans.requestUpgrade.useMutation();
  const cancelRequest = trpc.plans.cancelRequest.useMutation();

  if (plansQuery.isLoading || !plansQuery.data) {
    return (
      <AppShell title={t.plans.title}>
        <div className="flex justify-center py-16">
          <Spinner className="size-5" />
        </div>
      </AppShell>
    );
  }

  const { catalog, currentPlan, usage, pendingRequest } = plansQuery.data;

  const planName: Record<WorkspacePlan, string> = {
    free: t.plans.free,
    pro: t.plans.pro,
    business: t.plans.business,
    self_hosted: t.plans.selfHosted,
  };
  const planTagline: Record<WorkspacePlan, string> = {
    free: t.plans.freeTagline,
    pro: t.plans.proTagline,
    business: t.plans.businessTagline,
    self_hosted: t.plans.selfHostedTagline,
  };
  const limitLabel: Record<LimitKey, string> = {
    knowledgeEntries: t.plans.limitKnowledge,
    dailyTokens: t.plans.limitTokens,
    connectedChannels: t.plans.limitChannels,
    monthlyContacts: t.plans.limitContacts,
  };
  const featureLabel: Record<FeatureKey, string> = {
    shareLink: t.plans.featureShareLink,
    telegram: t.plans.featureTelegram,
    removeBranding: t.plans.featureRemoveBranding,
    customerCards: t.plans.featureCustomerCards,
    prioritySupport: t.plans.featurePrioritySupport,
  };

  /** `null` from the API means the plan does not meter this limit. */
  const formatLimit = (key: LimitKey, value: number | null) => {
    if (value === null) return t.plans.unlimited;
    if (key === "dailyTokens") return `${Math.round(value / 1000)}`;
    return value.toLocaleString();
  };

  const submit = async (plan: WorkspacePlan) => {
    try {
      await requestUpgrade.mutateAsync({ plan });
      await utils.plans.get.invalidate();
      toast.success(t.plans.requested(planName[plan]));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.plans.requestFailed
      );
    }
  };

  return (
    <AppShell title={t.plans.title} description={t.plans.subtitle} maxWidth="wide">
      <div className="space-y-6">
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-6 text-muted-foreground">
            {t.plans.billingNotice}
          </p>
        </div>

        {pendingRequest ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft p-4">
            <p className="text-sm text-primary-soft-foreground">
              {t.plans.requested(planName[pendingRequest.toPlan])}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await cancelRequest.mutateAsync();
                await utils.plans.get.invalidate();
              }}
            >
              {t.plans.cancelRequest}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {catalog.map(plan => {
            const isCurrent = plan.id === currentPlan;
            return (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col rounded-xl border bg-card p-5",
                  PLAN_ACCENT[plan.id]
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-foreground">
                    {planName[plan.id]}
                  </h2>
                  {isCurrent ? (
                    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[0.6875rem] font-medium text-primary-soft-foreground">
                      {t.plans.current}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {planTagline[plan.id]}
                </p>

                <p className="mt-4 flex items-baseline gap-1">
                  {plan.priceUsd === null ? (
                    <span className="text-2xl font-semibold text-foreground">
                      —
                    </span>
                  ) : (
                    <>
                      <span className="text-3xl font-semibold tabular-nums text-foreground">
                        ${plan.priceUsd}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.plans.perMonth}
                      </span>
                    </>
                  )}
                </p>

                <dl className="mt-4 space-y-1.5 border-t border-border pt-4 text-xs">
                  {(Object.keys(limitLabel) as LimitKey[]).map(key => (
                    <div key={key} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        {limitLabel[key]}
                      </dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatLimit(key, plan.limits[key])}
                      </dd>
                    </div>
                  ))}
                </dl>

                <ul className="mt-4 space-y-1.5 border-t border-border pt-4 text-xs">
                  {(Object.keys(featureLabel) as FeatureKey[]).map(key => {
                    const enabled = plan.features[key];
                    return (
                      <li key={key} className="flex items-center gap-2">
                        {enabled ? (
                          <Check className="size-3.5 shrink-0 text-success" />
                        ) : (
                          <Minus className="size-3.5 shrink-0 text-muted-foreground/50" />
                        )}
                        <span
                          className={
                            enabled
                              ? "text-foreground"
                              : "text-muted-foreground/70"
                          }
                        >
                          {featureLabel[key]}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-5 pt-1">
                  {plan.id === "self_hosted" ? (
                    <Button asChild variant="outline" className="w-full">
                      <a
                        href="https://github.com/RilliantLin/linply"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.plans.contactUs}
                      </a>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant={plan.id === "pro" ? "default" : "outline"}
                      className="w-full"
                      disabled={isCurrent || requestUpgrade.isPending}
                      onClick={() => void submit(plan.id)}
                    >
                      {requestUpgrade.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      {isCurrent ? t.plans.current : t.plans.upgrade}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            {t.plans.usageTitle}
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {(
              [
                ["knowledgeEntries", usage.knowledgeEntries],
                ["connectedChannels", usage.connectedChannels],
                ["monthlyContacts", usage.monthlyContacts],
              ] as Array<[LimitKey, number]>
            ).map(([key, used]) => {
              const limit =
                catalog.find(plan => plan.id === currentPlan)?.limits[key] ??
                null;
              const percent =
                limit === null ? 0 : Math.min(100, (used / limit) * 100);
              return (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">
                    {limitLabel[key]}
                  </dt>
                  <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">
                    {t.plans.usageOf(used, formatLimit(key, limit))}
                  </dd>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        percent >= 90 ? "bg-destructive" : "bg-primary"
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </dl>
        </section>
      </div>
    </AppShell>
  );
}
