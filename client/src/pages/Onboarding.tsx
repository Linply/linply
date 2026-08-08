import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useT, type Dictionary } from "@/i18n";
import BrandMark from "@/components/BrandMark";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BookOpen,
  Check,
  Copy,
  FileText,
  Loader2,
  MessagesSquare,
  Plug,
  Send,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type StepId = "profile" | "knowledge" | "preview" | "channel" | "done";

type StepMeta = {
  id: StepId;
  title: string;
  summary: string;
  icon: typeof Bot;
};

const STEP_IDS: StepId[] = ["profile", "knowledge", "preview", "channel"];

const buildSteps = (t: Dictionary): StepMeta[] => [
  {
    id: "profile",
    title: t.onboarding.profileTitle,
    summary: t.onboarding.profileSummary,
    icon: UserRound,
  },
  {
    id: "knowledge",
    title: t.onboarding.knowledgeTitle,
    summary: t.onboarding.knowledgeSummary,
    icon: BookOpen,
  },
  {
    id: "preview",
    title: t.onboarding.previewTitle,
    summary: t.onboarding.previewSummary,
    icon: MessagesSquare,
  },
  {
    id: "channel",
    title: t.onboarding.channelTitle,
    summary: t.onboarding.channelSummary,
    icon: Plug,
  },
];

const TONE_VALUES = ["friendly", "professional", "concise"] as const;
type Tone = (typeof TONE_VALUES)[number];

const buildToneOptions = (t: Dictionary) => [
  { value: "friendly" as const, label: t.tone.friendly, hint: t.tone.friendlyHint },
  {
    value: "professional" as const,
    label: t.tone.professional,
    hint: t.tone.professionalHint,
  },
  { value: "concise" as const, label: t.tone.concise, hint: t.tone.conciseHint },
];

const SAMPLE_KNOWLEDGE = `## 配送时效
下单后 48 小时内发出，普通快递 3-5 天送达，偏远地区 5-7 天。可以在订单详情页查看物流单号。

## 退换货政策
签收后 7 天内支持无理由退换，商品需保持吊牌完整、未使用。质量问题由我们承担来回运费，非质量问题运费由买家承担。

## 退款到账时间
退货签收后 1-3 个工作日完成审核，审核通过后原路退回：微信/支付宝 1-2 天到账，银行卡 3-5 个工作日。

## 发票申请
下单时可在备注填写抬头与税号，也可在订单完成后 30 天内联系客服补开电子发票，开具后发送到下单邮箱。

## 修改收货地址
未发货前可以自助在订单页修改；已发货的订单需要联系快递公司改派，我们可以协助提交申请。

## 优惠券使用规则
每笔订单限用一张优惠券，不与满减活动叠加。优惠券过期后无法恢复，请在有效期内使用。
`;

function StepRail({
  steps,
  currentIndex,
  onSelect,
}: {
  steps: StepMeta[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="space-y-1">
      {steps.map((step, index) => {
        const Icon = step.icon;
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={index > currentIndex}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                active
                  ? "bg-primary-soft"
                  : index > currentIndex
                    ? "opacity-55"
                    : "hover:bg-accent"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  done
                    ? "border-transparent bg-success text-white"
                    : active
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground"
                )}
              >
                {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm leading-tight",
                    active
                      ? "font-semibold text-primary-soft-foreground"
                      : "font-medium text-foreground"
                  )}
                >
                  {step.title}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {step.summary}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-1.5">
      <span className="text-sm font-medium text-foreground">{children}</span>
      {hint ? (
        <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export default function Onboarding() {
  const { workspace, loading } = useWorkspace({ requireOnboarded: false });
  const t = useT();
  const steps = buildSteps(t);
  const toneOptions = buildToneOptions(t);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [stepIndex, setStepIndex] = useState(0);
  const [initialized, setInitialized] = useState(false);

  const [name, setName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentTone, setAgentTone] = useState<Tone>("friendly");
  const [businessContext, setBusinessContext] = useState("");

  const [pastedKnowledge, setPastedKnowledge] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewInput, setPreviewInput] = useState("");
  const [previewThread, setPreviewThread] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [botToken, setBotToken] = useState("");

  const updateWorkspace = trpc.workspace.update.useMutation();
  const setStepMutation = trpc.workspace.setOnboardingStep.useMutation();
  const uploadDocument = trpc.knowledge.uploadDocument.useMutation();
  const askAgent = trpc.chat.ask.useMutation();
  const connectTelegram = trpc.channels.connectTelegram.useMutation();

  const knowledgeCount = workspace?.overview.knowledgeTotal ?? 0;
  const telegramConnected = workspace?.channels.some(
    channel => channel.provider === "telegram" && channel.status === "connected"
  );

  const publicChatUrl = useMemo(() => {
    if (!workspace) return "";
    return `${window.location.origin}/a/${workspace.publicKey}`;
  }, [workspace]);

  // Seed the form from the saved workspace once, then let the user own it.
  useEffect(() => {
    if (!workspace || initialized) return;
    setName(workspace.name);
    setAgentName(workspace.agentName);
    setAgentTone(
      (TONE_VALUES.find(value => value === workspace.agentTone) ??
        "friendly") as Tone
    );
    setBusinessContext(workspace.businessContext ?? "");
    const savedIndex = STEP_IDS.indexOf(workspace.onboardingStep as StepId);
    setStepIndex(savedIndex >= 0 ? savedIndex : 0);
    setInitialized(true);
  }, [workspace, initialized]);

  useEffect(() => {
    if (workspace?.onboardingCompletedAt) setLocation("/");
  }, [workspace?.onboardingCompletedAt, setLocation]);

  if (loading || !workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-5" />
      </div>
    );
  }

  const goToStep = async (index: number) => {
    const clamped = Math.max(0, Math.min(index, steps.length - 1));
    setStepIndex(clamped);
    await setStepMutation
      .mutateAsync({ step: steps[clamped].id })
      .catch(() => undefined);
  };

  const saveProfileAndContinue = async () => {
    try {
      await updateWorkspace.mutateAsync({
        name: name.trim() || workspace.name,
        agentName: agentName.trim() || "智能客服",
        agentTone,
        businessContext: businessContext.trim() || null,
      });
      await utils.workspace.get.invalidate();
      await goToStep(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.saveFailed);
    }
  };

  const importKnowledge = async (
    content: string,
    filename: string,
    fileType: "markdown" | "csv"
  ) => {
    if (!content.trim()) {
      toast.error(t.onboarding.emptyContent);
      return;
    }
    try {
      const result = await uploadDocument.mutateAsync({
        filename,
        fileType,
        content,
      });
      await utils.workspace.get.invalidate();
      if (result.totalChunks === 0) {
        toast.error(t.onboarding.noEntriesParsed);
        return;
      }
      toast.success(t.onboarding.imported(result.totalChunks));
      setPastedKnowledge("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.onboarding.importFailed
      );
    }
  };

  const handleFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t.onboarding.fileTooLarge);
      return;
    }
    const fileType = file.name.toLowerCase().endsWith(".csv")
      ? ("csv" as const)
      : ("markdown" as const);
    const content = await file.text();
    await importKnowledge(content, file.name, fileType);
  };

  const runPreview = async () => {
    const question = previewInput.trim();
    if (!question) return;
    setPreviewInput("");
    setPreviewError(null);
    setPreviewThread(thread => [...thread, { role: "user", content: question }]);
    try {
      const response = await askAgent.mutateAsync({ content: question });
      setPreviewThread(thread => [
        ...thread,
        { role: "assistant", content: response.reply },
      ]);
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : t.onboarding.connectFailed
      );
    }
  };

  const handleConnectTelegram = async () => {
    try {
      const result = await connectTelegram.mutateAsync({
        botToken: botToken.trim(),
      });
      await utils.workspace.get.invalidate();
      setBotToken("");
      toast.success(
        result.deliveryMode === "webhook"
          ? t.onboarding.connectedVia(result.channel.displayName ?? "")
          : t.onboarding.connectedViaPolling(result.channel.displayName ?? "")
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.onboarding.connectFailed
      );
    }
  };

  const finish = async () => {
    await setStepMutation.mutateAsync({ step: "done" });
    await utils.workspace.get.invalidate();
    setLocation("/");
  };

  const currentStep = steps[stepIndex];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-12 lg:self-start">
          <div className="mb-6 flex items-center gap-2.5">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold leading-tight">Linply</p>
              <p className="text-xs leading-tight text-muted-foreground">
                {t.onboarding.brandTagline}
              </p>
            </div>
          </div>
          <StepRail
            steps={steps}
            currentIndex={stepIndex}
            onSelect={index => void goToStep(index)}
          />
          <button
            type="button"
            onClick={() => void finish()}
            className="mt-6 px-3 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {t.onboarding.skip}
          </button>
        </aside>

        <main className="min-w-0">
          <div className="mb-6">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t.onboarding.stepOf(stepIndex + 1, steps.length)}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {currentStep.title}
            </h1>
          </div>

          {currentStep.id === "profile" ? (
            <section className="space-y-5 rounded-xl border border-border bg-card p-5 sm:p-6">
              <p className="text-sm leading-6 text-muted-foreground">
                {t.onboarding.profileIntro}
              </p>

              <div>
                <FieldLabel hint={t.onboarding.workspaceNameHint}>
                  {t.onboarding.workspaceName}
                </FieldLabel>
                <Input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder={t.onboarding.workspaceNamePlaceholder}
                  maxLength={80}
                />
              </div>

              <div>
                <FieldLabel hint={t.onboarding.agentNameHint}>
                  {t.onboarding.agentName}
                </FieldLabel>
                <Input
                  value={agentName}
                  onChange={event => setAgentName(event.target.value)}
                  placeholder={t.onboarding.agentNamePlaceholder}
                  maxLength={60}
                />
              </div>

              <div>
                <FieldLabel>{t.onboarding.tone}</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  {toneOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAgentTone(option.value)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        agentTone === option.value
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
              </div>

              <div>
                <FieldLabel hint={t.onboarding.businessContextHint}>
                  {t.onboarding.businessContext}
                </FieldLabel>
                <Textarea
                  value={businessContext}
                  onChange={event => setBusinessContext(event.target.value)}
                  placeholder={t.onboarding.businessContextPlaceholder}
                  rows={4}
                  maxLength={2000}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => void saveProfileAndContinue()}
                  disabled={updateWorkspace.isPending}
                >
                  {updateWorkspace.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t.onboarding.saveAndContinue}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </section>
          ) : null}

          {currentStep.id === "knowledge" ? (
            <section className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {t.onboarding.pasteTitle}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t.onboarding.pasteHint}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {t.onboarding.entryCount(knowledgeCount)}
                  </span>
                </div>

                <Textarea
                  value={pastedKnowledge}
                  onChange={event => setPastedKnowledge(event.target.value)}
                  placeholder={"## 退换货政策\n签收后 7 天内支持无理由退换……\n\n## 配送时效\n下单后 48 小时内发出……"}
                  rows={9}
                  className="font-mono text-[0.8125rem]"
                />

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() =>
                      void importKnowledge(
                        pastedKnowledge,
                        "onboarding-粘贴内容.md",
                        "markdown"
                      )
                    }
                    disabled={uploadDocument.isPending || !pastedKnowledge.trim()}
                  >
                    {uploadDocument.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {t.onboarding.importPasted}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPastedKnowledge(SAMPLE_KNOWLEDGE)}
                  >
                    <FileText className="size-4" />
                    {t.onboarding.fillSample}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                <h2 className="text-sm font-semibold text-foreground">
                  {t.onboarding.uploadTitle}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t.onboarding.uploadHint}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.csv,text/markdown,text/csv"
                  className="hidden"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void handleFile(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadDocument.isPending}
                >
                  <Upload className="size-4" />
                  {t.onboarding.chooseFile}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={() => void goToStep(0)}>
                  <ArrowLeft className="size-4" />
                  {t.common.previous}
                </Button>
                <div className="flex items-center gap-2">
                  {knowledgeCount === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {t.onboarding.noKnowledgeWarning}
                    </span>
                  ) : null}
                  <Button type="button" onClick={() => void goToStep(2)}>
                    {t.common.next}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {currentStep.id === "preview" ? (
            <section className="space-y-4">
              <div className="flex min-h-[22rem] flex-col rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Bot className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {workspace.agentName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.onboarding.previewSubtitle}
                    </p>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {previewThread.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        {t.onboarding.previewEmpty}
                      </p>
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {[t.chat.starter1, t.chat.starter2, t.chat.starter3].map(
                          sample => (
                            <button
                              key={sample}
                              type="button"
                              onClick={() => setPreviewInput(sample)}
                              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                            >
                              {sample}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  ) : null}

                  {previewThread.map((message, index) => (
                    <div
                      key={index}
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

                  {askAgent.isPending ? (
                    <div className="flex justify-start">
                      <div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5">
                        <Spinner className="size-4" />
                      </div>
                    </div>
                  ) : null}

                  {previewError ? (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                      {previewError}
                      <br />
                      {t.onboarding.previewNoModel}
                    </p>
                  ) : null}
                </div>

                <form
                  className="flex items-center gap-2 border-t border-border p-3"
                  onSubmit={event => {
                    event.preventDefault();
                    void runPreview();
                  }}
                >
                  <Input
                    value={previewInput}
                    onChange={event => setPreviewInput(event.target.value)}
                    placeholder={t.onboarding.previewPlaceholder}
                    disabled={askAgent.isPending}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={askAgent.isPending || !previewInput.trim()}
                    aria-label={t.chat.send}
                  >
                    <Send className="size-4" />
                  </Button>
                </form>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={() => void goToStep(1)}>
                  <ArrowLeft className="size-4" />
                  {t.common.previous}
                </Button>
                <Button type="button" onClick={() => void goToStep(3)}>
                  {t.common.next}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </section>
          ) : null}

          {currentStep.id === "channel" ? (
            <section className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {t.onboarding.shareLinkTitle}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t.onboarding.shareLinkHint}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                    {t.onboarding.ready}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Input readOnly value={publicChatUrl} className="font-mono text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t.common.copy}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(publicChatUrl)
                        .then(() => toast.success(t.common.copied))
                        .catch(() => toast.error(t.common.copyFailed));
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {t.onboarding.telegramTitle}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t.onboarding.telegramHint}
                    </p>
                  </div>
                  {telegramConnected ? (
                    <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                      {t.onboarding.connected}
                    </span>
                  ) : null}
                </div>

                {telegramConnected ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t.onboarding.telegramConnectedHint}
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={botToken}
                      onChange={event => setBotToken(event.target.value)}
                      placeholder="123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleConnectTelegram()}
                      disabled={connectTelegram.isPending || !botToken.trim()}
                    >
                      {connectTelegram.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plug className="size-4" />
                      )}
                      {t.onboarding.connect}
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={() => void goToStep(2)}>
                  <ArrowLeft className="size-4" />
                  {t.common.previous}
                </Button>
                <Button type="button" onClick={() => void finish()}>
                  {t.onboarding.finish}
                  <Check className="size-4" />
                </Button>
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
