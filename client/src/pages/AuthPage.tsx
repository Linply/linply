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
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";

type AuthPageProps = {
  mode: "login" | "register";
};

const getReturnTo = () => {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
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

  const finishAuthentication = async (authenticatedUser: NonNullable<typeof user>) => {
    utils.auth.me.setData(undefined, authenticatedUser);
    await utils.auth.me.invalidate();
    setLocation(getReturnTo());
  };

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: finishAuthentication,
  });
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: finishAuthentication,
  });

  useEffect(() => {
    if (!loading && user) setLocation(getReturnTo());
  }, [loading, setLocation, user]);

  const pending = loginMutation.isPending || registerMutation.isPending;
  const requestError = loginMutation.error?.message ?? registerMutation.error?.message;

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
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-lg bg-gray-900 text-white">
            <LockKeyhole className="size-5" />
          </div>
          <div className="text-xl font-semibold text-gray-950">客服工单系统</div>
        </div>

        <Card className="rounded-lg border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">
              {isRegister ? "创建账号" : "登录账号"}
            </CardTitle>
            <CardDescription>
              {isRegister ? "使用邮箱创建你的客服账号" : "使用注册邮箱继续访问系统"}
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                    autoComplete={isRegister ? "new-password" : "current-password"}
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
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
                  <AlertDescription>{formError ?? requestError}</AlertDescription>
                </Alert>
              ) : null}

              <Button type="submit" className="w-full" size="lg" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {isRegister ? "注册" : "登录"}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-gray-600">
              {isRegister ? "已有账号？" : "还没有账号？"}
              <button
                type="button"
                className="ml-1 font-medium text-gray-950 hover:underline"
                onClick={() => setLocation(isRegister ? "/login" : "/register")}
              >
                {isRegister ? "直接登录" : "立即注册"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
