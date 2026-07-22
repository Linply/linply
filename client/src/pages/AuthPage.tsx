import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
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
    <main className="relative flex min-h-screen flex-col bg-background px-4 py-6 sm:px-6">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-2 text-sm font-semibold text-gray-950">
        <span className="relative flex size-8 items-center justify-center rounded-lg bg-gray-950 text-white">
          <Bot className="size-4" />
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
        </span>
        客服工单 Agent
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 py-10 sm:py-14 lg:grid-cols-[26rem_minmax(0,1fr)] lg:gap-16">
        <section className="w-full">
          <div className="mb-6">
            <h1 className="mt-1 text-2xl font-semibold text-gray-950">
              {isRegister ? "创建账号" : "登录账号"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              {isRegister
                ? "使用邮箱创建你的客服账号"
                : "使用注册邮箱继续访问系统"}
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="p-5 sm:p-6">
              {providersQuery.data?.google ? (
                <>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full"
                    size="default"
                  >
                    <a href={googleOAuthUrl}>
                      <LogIn className="size-4" />
                      使用 Google 登录
                    </a>
                  </Button>
                  <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
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

              <form className="space-y-4" onSubmit={handleSubmit}>
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
                        placeholder="姓名"
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
                      placeholder={isRegister ? "name@example.com" : undefined}
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
                      placeholder={isRegister ? "输入密码" : undefined}
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
                      placeholder="再次输入密码"
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
                  size="default"
                  disabled={pending}
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  {isRegister ? "注册" : "登录"}
                </Button>
              </form>
            </div>

            {!isRegister && providersQuery.data?.demoAdmin ? (
              <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-6">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full bg-white"
                  size="default"
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
          </div>

          <div className="mt-5 text-center text-sm text-gray-500">
            {isRegister ? "已有账号？" : "还没有账号？"}
            <button
              type="button"
              className="ml-1 font-medium text-gray-950 hover:underline"
              onClick={() =>
                setLocation(getAuthPageUrl(isRegister ? "/login" : "/register"))
              }
            >
              {isRegister ? "直接登录" : "立即注册"}
            </button>
          </div>
        </section>

        <aside className="border-t border-gray-200 pt-8 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
          <h2 className="mt-3 text-3xl font-semibold text-gray-950">
            客服工单Agent
          </h2>
          <p className="mt-4 text-sm leading-6 text-gray-600">
            从 AI
            问答、知识检索到工单闭环，集中体验一套可追踪、可维护的智能客服工作台。
          </p>
          <p className="mt-7 border-t border-gray-200 pt-6 text-sm font-semibold text-gray-950">
            建议体验路径
          </p>
          <div className="mt-6 space-y-6">
            <div className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                <ShieldCheck className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  先查看管理员工作台
                </h3>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  浏览知识库、工单和 RAG
                  调试入口，了解后台如何维护客服资料。
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <Bot className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  和智能客服对话
                </h3>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  输入产品或售后问题，查看知识库引用、回答依据和 Agent
                  的执行过程。
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700">
                <TicketCheck className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  回到工单完成闭环
                </h3>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  创建工单、推进处理状态、补充备注，并在 Agent Run
                  中排查每次运行结果。
                </p>
              </div>
            </div>
          </div>
          <div className="mt-8 flex items-center gap-2 text-sm text-gray-500">
            <ArrowLeft className="ml-1 size-4" />
            <span>登录后可直接使用内置示例数据体验完整流程</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
