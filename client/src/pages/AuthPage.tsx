import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CircleCheck,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  LogIn,
  Mail,
  ShieldCheck,
  TicketCheck,
  UserRound,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";

type AuthPageProps = {
  mode: "login" | "register";
};

const getReturnTo = () => {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value) return "/";
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
};

const getOAuthError = () => {
  const code = new URLSearchParams(window.location.search).get("oauthError");
  if (code === "oauth_denied") return "已取消 Google 登录";
  if (code === "invalid_state") return "登录请求已失效，请重新尝试";
  if (code === "account_link_required")
    return "该邮箱已注册，请先使用邮箱密码登录";
  if (code === "oauth_failed") return "Google 登录失败，请稍后重试";
  return null;
};

const getAuthPageUrl = (path: "/login" | "/register") => {
  const returnTo = getReturnTo();
  return returnTo === "/"
    ? path
    : `${path}?returnTo=${encodeURIComponent(returnTo)}`;
};

export default function AuthPage({ mode }: AuthPageProps) {
  const isRegister = mode === "register";
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const providersQuery = trpc.auth.providers.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const finishAuthentication = async (
    authenticatedUser: NonNullable<typeof user>
  ) => {
    utils.auth.me.setData(undefined, authenticatedUser);
    await utils.auth.me.invalidate();
    setLocation(getReturnTo());
  };

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: finishAuthentication,
  });
  const demoAdminLoginMutation = trpc.auth.demoAdminLogin.useMutation({
    onSuccess: finishAuthentication,
  });
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: finishAuthentication,
  });

  useEffect(() => {
    if (!loading && user) setLocation(getReturnTo());
  }, [loading, setLocation, user]);

  const pending =
    loginMutation.isPending ||
    demoAdminLoginMutation.isPending ||
    registerMutation.isPending;
  const requestError =
    loginMutation.error?.message ??
    demoAdminLoginMutation.error?.message ??
    registerMutation.error?.message;
  const oauthError = getOAuthError();
  const returnTo = getReturnTo();
  const googleOAuthUrl = `/api/auth/oauth/google/start?returnTo=${encodeURIComponent(returnTo)}`;

  const handleDemoAdminLogin = () => {
    setFormError(null);
    demoAdminLoginMutation.mutate();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (isRegister && password !== confirmPassword) {
      setFormError("两次输入的密码不一致");
      return;
    }

    if (isRegister) {
      registerMutation.mutate({ name, email, password });
    } else {
      loginMutation.mutate({ email, password });
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16">
        <section className="order-2 lg:order-1">
          <div className="mb-7 flex items-center gap-3 text-sm font-semibold text-gray-950">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gray-950 text-white shadow-sm">
              <Bot className="size-5" />
            </div>
            <span>客服工单 Agent</span>
          </div>
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-blue-700">
            Customer support workspace
          </p>
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-gray-950 sm:text-5xl">
            客服工单系统
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-gray-600 sm:text-lg">
            从 AI
            问答、知识检索到工单闭环，集中体验一套可追踪、可维护的智能客服工作台。
          </p>

          <div className="mt-9 max-w-xl border-t border-gray-200 pt-6">
            <p className="mb-5 text-sm font-semibold text-gray-950">
              建议体验路径
            </p>
            <ol className="space-y-5">
              <li className="flex gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <ShieldCheck className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">
                    先查看管理员工作台
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    浏览工单统计、知识库和 RAG
                    调试入口，了解后台如何维护客服资料。
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Bot className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">
                    和智能客服对话
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    输入产品或售后问题，查看知识库引用、回答依据和 Agent
                    的执行过程。
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <TicketCheck className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">
                    回到工单完成闭环
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    创建工单、推进处理状态、补充备注，并在 Agent Run
                    中排查每次运行结果。
                  </p>
                </div>
              </li>
            </ol>
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm text-gray-500">
            <CircleCheck className="size-4 text-emerald-600" />
            <span>登录后可直接使用内置示例数据体验完整流程</span>
            <ArrowRight className="ml-1 size-4" />
          </div>
        </section>

        <section className="order-1 lg:order-2">
          <div className="mb-5 text-center lg:hidden">
            <div className="text-xl font-semibold text-gray-950">
              客服工单系统
            </div>
          </div>

          <Card className="rounded-2xl border-gray-200/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <CardHeader>
              <CardTitle className="text-xl">
                {isRegister ? "创建账号" : "登录账号"}
              </CardTitle>
              <CardDescription>
                {isRegister
                  ? "使用邮箱创建你的客服账号"
                  : "使用注册邮箱继续访问系统"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {providersQuery.data?.google ? (
                <>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full"
                    size="lg"
                  >
                    <a href={googleOAuthUrl}>
                      <LogIn />
                      使用 Google 登录
                    </a>
                  </Button>
                  <div className="my-5 flex items-center gap-3 text-xs text-gray-500">
                    <div className="h-px flex-1 bg-gray-200" />
                    <span>或使用邮箱</span>
                    <div className="h-px flex-1 bg-gray-200" />
                  </div>
                </>
              ) : null}

              {oauthError ? (
                <Alert variant="destructive" className="mb-5">
                  <AlertCircle />
                  <AlertDescription>{oauthError}</AlertDescription>
                </Alert>
              ) : null}

              <form className="space-y-5" onSubmit={handleSubmit}>
                {isRegister ? (
                  <div className="space-y-2">
                    <Label htmlFor="name">姓名</Label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        id="name"
                        value={name}
                        onChange={event => setName(event.target.value)}
                        autoComplete="name"
                        className="pl-9"
                        maxLength={80}
                        required
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="email">邮箱</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                      autoComplete="email"
                      className="pl-9"
                      maxLength={320}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                      autoComplete={
                        isRegister ? "new-password" : "current-password"
                      }
                      className="px-9"
                      minLength={isRegister ? 8 : 1}
                      maxLength={128}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(value => !value)}
                      className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      title={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                  {isRegister ? (
                    <p className="text-xs text-gray-500">至少 8 个字符</p>
                  ) : null}
                </div>

                {isRegister ? (
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">确认密码</Label>
                    <Input
                      id="confirm-password"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={event => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                    />
                  </div>
                ) : null}

                {formError || requestError ? (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>
                      {formError ?? requestError}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={pending}
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  {isRegister ? "注册" : "登录"}
                </Button>
              </form>

              {!isRegister && providersQuery.data?.demoAdmin ? (
                <div className="mt-5 border-t border-gray-100 pt-5">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-gray-300 bg-gray-50/60"
                    size="lg"
                    onClick={handleDemoAdminLogin}
                    disabled={pending}
                  >
                    {demoAdminLoginMutation.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ShieldCheck />
                    )}
                    一键进入管理员演示
                  </Button>
                  <p className="mt-3 text-center text-xs leading-5 text-gray-500">
                    使用已配置的演示管理员账号，无需填写邮箱和密码
                  </p>
                </div>
              ) : null}

              <div className="mt-6 text-center text-sm text-gray-600">
                {isRegister ? "已有账号？" : "还没有账号？"}
                <button
                  type="button"
                  className="ml-1 font-medium text-gray-950 hover:underline"
                  onClick={() =>
                    setLocation(
                      getAuthPageUrl(isRegister ? "/login" : "/register")
                    )
                  }
                >
                  {isRegister ? "直接登录" : "立即注册"}
                </button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
