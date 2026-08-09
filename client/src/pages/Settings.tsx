import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useIntlLocale, useT, type Dictionary } from "@/i18n";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const TONE_VALUES = ["friendly", "professional", "concise"] as const;
type Tone = (typeof TONE_VALUES)[number];

/** Radix needs a non-empty value, and "" is how the workspace stores "default". */
const FOLLOW_DEPLOYMENT = "__default__";

export const buildToneOptions = (t: Dictionary) => [
  {
    value: "friendly" as const,
    label: t.tone.friendly,
    hint: t.tone.friendlyHint,
  },
  {
    value: "professional" as const,
    label: t.tone.professional,
    hint: t.tone.professionalHint,
  },
  {
    value: "concise" as const,
    label: t.tone.concise,
    hint: t.tone.conciseHint,
  },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint ? (
          <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const { workspace, loading } = useWorkspace();
  const t = useT();
  const toneOptions = buildToneOptions(t);
  const intlLocale = useIntlLocale();
  const utils = trpc.useUtils();
  const update = trpc.workspace.update.useMutation();
  const { data: modelCatalog } = trpc.workspace.listModels.useQuery();

  const [form, setForm] = useState({
    name: "",
    agentName: "",
    agentTone: "friendly" as Tone,
    agentModel: "",
    greeting: "",
    fallbackReply: "",
    businessContext: "",
    publicChatEnabled: true,
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!workspace || hydrated) return;
    setForm({
      name: workspace.name,
      agentName: workspace.agentName,
      agentTone: (TONE_VALUES.find(value => value === workspace.agentTone) ??
        "friendly") as Tone,
      agentModel: workspace.agentModel ?? "",
      greeting: workspace.greeting ?? "",
      fallbackReply: workspace.fallbackReply ?? "",
      businessContext: workspace.businessContext ?? "",
      publicChatEnabled: workspace.publicChatEnabled,
    });
    setHydrated(true);
  }, [workspace, hydrated]);

  if (loading || !workspace) {
    return (
      <AppShell title={t.settings.title}>
        <div className="flex justify-center py-16">
          <Spinner className="size-5" />
        </div>
      </AppShell>
    );
  }

  const save = async () => {
    try {
      await update.mutateAsync({
        name: form.name.trim() || workspace.name,
        agentName: form.agentName.trim() || "智能客服",
        agentTone: form.agentTone,
        agentModel: form.agentModel || null,
        greeting: form.greeting.trim() || null,
        fallbackReply: form.fallbackReply.trim() || null,
        businessContext: form.businessContext.trim() || null,
        publicChatEnabled: form.publicChatEnabled,
      });
      await utils.workspace.get.invalidate();
      toast.success(t.settings.saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.saveFailed);
    }
  };

  // One save button, at the end of the form — a second one in the header just
  // asks the same question twice.
  return (
    <AppShell title={t.settings.title} description={t.settings.subtitle}>
      <div className="space-y-4">
        <Section
          title={t.settings.identityTitle}
          description={t.settings.identityDescription}
        >
          <Field label={t.onboarding.workspaceName}>
            <Input
              value={form.name}
              maxLength={80}
              onChange={event =>
                setForm(state => ({ ...state, name: event.target.value }))
              }
            />
          </Field>
          <Field
            label={t.onboarding.agentName}
            hint={t.onboarding.agentNameHint}
          >
            <Input
              value={form.agentName}
              maxLength={60}
              onChange={event =>
                setForm(state => ({ ...state, agentName: event.target.value }))
              }
            />
          </Field>
          <Field label={t.onboarding.tone}>
            <div className="grid gap-2 sm:grid-cols-3">
              {toneOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setForm(state => ({ ...state, agentTone: option.value }))
                  }
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    form.agentTone === option.value
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-background hover:border-input"
                  )}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </Section>

        <Section
          title={t.settings.modelTitle}
          description={t.settings.modelDescription}
        >
          {modelCatalog && modelCatalog.models.length === 0 ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm leading-6 text-muted-foreground">
              {t.settings.modelUnavailable}
            </p>
          ) : (
            <Field
              label={t.settings.modelLabel}
              hint={form.agentModel ? undefined : t.settings.modelDefaultHint}
            >
              <Select
                value={form.agentModel || FOLLOW_DEPLOYMENT}
                onValueChange={value =>
                  setForm(state => ({
                    ...state,
                    agentModel: value === FOLLOW_DEPLOYMENT ? "" : value,
                  }))
                }
              >
                <SelectTrigger className="w-full sm:max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FOLLOW_DEPLOYMENT}>
                    {t.settings.modelDefaultOption(
                      modelCatalog?.models.find(option => option.isDefault)
                        ?.label ?? "—"
                    )}
                  </SelectItem>
                  {(modelCatalog?.models ?? []).map(option => (
                    <SelectItem key={option.id} value={option.id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{option.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t.settings.modelTiers[option.tier]}
                          {option.contextWindowTokens
                            ? ` · ${t.settings.modelContextWindow(
                                new Intl.NumberFormat(intlLocale, {
                                  notation: "compact",
                                  maximumFractionDigits: 0,
                                }).format(option.contextWindowTokens)
                              )}`
                            : ""}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </Section>

        <Section
          title={t.settings.scriptsTitle}
          description={t.settings.scriptsDescription}
        >
          <Field label={t.settings.greeting} hint={t.settings.greetingHint}>
            <Textarea
              rows={3}
              maxLength={500}
              value={form.greeting}
              placeholder={t.settings.greetingPlaceholder}
              onChange={event =>
                setForm(state => ({ ...state, greeting: event.target.value }))
              }
            />
          </Field>
          <Field label={t.settings.fallback} hint={t.settings.fallbackHint}>
            <Textarea
              rows={3}
              maxLength={500}
              value={form.fallbackReply}
              placeholder={t.settings.fallbackPlaceholder}
              onChange={event =>
                setForm(state => ({
                  ...state,
                  fallbackReply: event.target.value,
                }))
              }
            />
          </Field>
        </Section>

        <Section
          title={t.settings.businessTitle}
          description={t.settings.businessDescription}
        >
          <Textarea
            rows={5}
            maxLength={2000}
            value={form.businessContext}
            placeholder={t.onboarding.businessContextPlaceholder}
            onChange={event =>
              setForm(state => ({
                ...state,
                businessContext: event.target.value,
              }))
            }
          />
        </Section>

        <Section
          title={t.settings.shareTitle}
          description={t.settings.shareDescription}
        >
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={form.publicChatEnabled}
              onChange={event =>
                setForm(state => ({
                  ...state,
                  publicChatEnabled: event.target.checked,
                }))
              }
            />
            <span className="text-sm text-foreground">
              {t.settings.shareToggle}
            </span>
          </label>
          <code className="block truncate rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            {`${window.location.origin}/a/${workspace.publicKey}`}
          </code>
        </Section>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => void save()}
            disabled={update.isPending}
          >
            {update.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {t.settings.saveSettings}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
