import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Check,
  ChevronRight,
  MessageSquareText,
  Tickets,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type AdminOnboardingGuideProps = {
  location: string;
  navigate: (path: string) => void;
};

const GUIDE_VERSION = "v1";
const STEPS = [
  {
    title: "查看知识库",
    description: "先了解客服回答所依据的政策和服务规则。",
    path: "/admin/knowledge",
    icon: BookOpen,
  },
  {
    title: "向智能客服提问",
    description: "输入一个售后或订单问题，查看 AI 的回答和引用。",
    path: "/chat",
    icon: MessageSquareText,
  },
  {
    title: "查看工单",
    description: "最后查看工单列表，了解问题如何进入人工处理。",
    path: "/tickets",
    icon: Tickets,
  },
] as const;

function getStorageKey(userId: number) {
  return `customer-service-agent:admin-onboarding:${GUIDE_VERSION}:${userId}`;
}

function getRouteStep(location: string) {
  if (location === "/admin/knowledge") return 0;
  if (location === "/chat") return 1;
  if (location === "/tickets" || location === "/ticket/create") return 2;
  return null;
}

export default function AdminOnboardingGuide({
  location,
  navigate,
}: AdminOnboardingGuideProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  const storageKey = useMemo(
    () => (user?.role === "admin" ? getStorageKey(user.id) : null),
    [user]
  );

  useEffect(() => {
    if (!storageKey) {
      setVisible(false);
      return;
    }

    const saved = window.localStorage.getItem(storageKey);
    if (saved === "completed") {
      setVisible(false);
      return;
    }

    const savedStep = Number.parseInt(saved ?? "0", 10);
    setStep(Number.isInteger(savedStep) ? Math.min(Math.max(savedStep, 0), STEPS.length - 1) : 0);
    setVisible(true);
  }, [storageKey]);

  useEffect(() => {
    if (!visible || !storageKey) return;
    const routeStep = getRouteStep(location);
    if (routeStep === null || routeStep < step) return;

    setStep(routeStep);
    window.localStorage.setItem(storageKey, String(routeStep));
  }, [location, step, storageKey, visible]);

  if (!visible || !storageKey || user?.role !== "admin") return null;

  const currentStep = STEPS[step];
  const Icon = currentStep.icon;
  const isLastStep = step === STEPS.length - 1;

  const dismiss = () => {
    window.localStorage.setItem(storageKey, "completed");
    setVisible(false);
  };

  const continueGuide = () => {
    if (isLastStep) {
      dismiss();
      navigate(currentStep.path);
      return;
    }

    const nextStep = step + 1;
    setStep(nextStep);
    window.localStorage.setItem(storageKey, String(nextStep));
    navigate(currentStep.path);
  };

  return (
    <aside
      aria-label="管理员演示引导"
      className="fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-xl shadow-gray-950/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-gray-950 text-white">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">管理员演示引导</p>
            <h2 className="mt-0.5 text-sm font-semibold text-gray-950">
              {currentStep.title}
            </h2>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="关闭引导"
          onClick={dismiss}
        >
          <X className="size-4" />
        </Button>
      </div>

      <p className="mt-3 text-sm leading-5 text-gray-600">{currentStep.description}</p>

      <div className="mt-4 space-y-2">
        {STEPS.map((item, index) => {
          const StepIcon = item.icon;
          const completed = index < step;
          const active = index === step;
          return (
            <div
              key={item.path}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                active ? "bg-gray-100 text-gray-950" : "text-gray-400"
              }`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  completed
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : active
                      ? "border-gray-300 bg-white text-gray-700"
                      : "border-gray-200 bg-white text-gray-300"
                }`}
              >
                {completed ? <Check className="size-3" /> : <StepIcon className="size-3" />}
              </span>
              <span className={active ? "font-medium" : ""}>{item.title}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-gray-400">
          步骤 {step + 1} / {STEPS.length}
        </span>
        <Button type="button" size="sm" onClick={continueGuide}>
          {isLastStep ? "完成引导" : `前往${currentStep.title}`}
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
