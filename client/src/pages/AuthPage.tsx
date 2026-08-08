import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandMark from "@/components/BrandMark";
import LanguageToggle from "@/components/LanguageToggle";
import { useT, type Dictionary } from "@/i18n";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { AlertCircle, Bot, Eye, EyeOff, Loader2 } from "lucide-react";
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

const getOAuthError = (t: Dictionary) => {
  const code = new URLSearchParams(window.location.search).get("oauthError");
  if (code === "oauth_denied") return t.auth.oauthDenied;
  if (code === "invalid_state") return t.auth.oauthInvalidState;
  if (code === "account_link_required") return t.auth.oauthLinkRequired;
  if (code === "oauth_failed") return t.auth.oauthFailed;
  return null;
};

const getAuthPageUrl = (path: "/login" | "/register") => {
  const returnTo = getReturnTo();
  return returnTo === "/"
    ? path
    : `${path}?returnTo=${encodeURIComponent(returnTo)}`;
};

/**
 * Backdrop motif: one source radiating outward to many endpoints — the product's
 * whole story, since a workspace's knowledge is answering across every channel
 * it is connected to. Rings carry the "reach" idea, nodes are the endpoints.
 *
 * Pure SVG at very low contrast so the headline stays dominant; no animation, so
 * it costs nothing and respects reduced-motion by construction.
 */
const RING_RADII = [78, 132, 196, 268, 348, 436, 532];

/** Endpoints sit at hand-picked angles so they read as scattered, not clock-like. */
const NODES: Array<{ angle: number; radius: number; size: number }> = [
  { angle: -62, radius: 132, size: 4 },
  { angle: 24, radius: 196, size: 5 },
  { angle: 158, radius: 196, size: 3.5 },
  { angle: -142, radius: 268, size: 4.5 },
  { angle: 74, radius: 268, size: 3 },
  { angle: -18, radius: 348, size: 5.5 },
  { angle: 196, radius: 348, size: 4 },
  { angle: 112, radius: 436, size: 4.5 },
  { angle: -105, radius: 436, size: 3.5 },
  { angle: 42, radius: 532, size: 4 },
  { angle: 214, radius: 532, size: 3 },
];

const polar = (angle: number, radius: number) => {
  const radians = (angle * Math.PI) / 180;
  return { x: 600 + Math.cos(radians) * radius, y: 600 + Math.sin(radians) * radius };
};

function SignalBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {/* Warm indigo wash so the panel is not flat white. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,var(--primary-soft),transparent_62%)] opacity-70" />

      <svg
        viewBox="0 0 1200 1200"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_50%_45%,black_38%,transparent_82%)]"
      >
        {RING_RADII.map((radius, index) => (
          <circle
            key={radius}
            cx="600"
            cy="600"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={index < 2 ? 1.4 : 1}
            // Outer rings dashed and fainter, so reach reads as diminishing.
            strokeDasharray={index > 2 ? "3 9" : undefined}
            className="text-primary"
            opacity={0.3 - index * 0.032}
          />
        ))}

        {NODES.map(node => {
          const point = polar(node.angle, node.radius);
          return (
            <g key={`${node.angle}-${node.radius}`}>
              <line
                x1="600"
                y1="600"
                x2={point.x}
                y2={point.y}
                stroke="currentColor"
                strokeWidth="1"
                className="text-primary"
                opacity="0.07"
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={node.size}
                fill="currentColor"
                className="text-primary"
                opacity="0.22"
              />
            </g>
          );
        })}

        <circle
          cx="600"
          cy="600"
          r="10"
          fill="currentColor"
          className="text-primary"
          opacity="0.4"
        />
      </svg>
    </div>
  );
}

export default function AuthPage({ mode }: AuthPageProps) {
  const isRegister = mode === "register";
  const t = useT();
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
  const demoLoginMutation = trpc.auth.demoLogin.useMutation({
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
    demoLoginMutation.isPending ||
    registerMutation.isPending;
  const requestError =
    loginMutation.error?.message ??
    demoLoginMutation.error?.message ??
    registerMutation.error?.message;
  const oauthError = getOAuthError(t);
  const returnTo = getReturnTo();
  const googleOAuthUrl = `/api/auth/oauth/google/start?returnTo=${encodeURIComponent(returnTo)}`;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (isRegister && password !== confirmPassword) {
      setFormError(t.auth.passwordMismatch);
      return;
    }

    if (isRegister) {
      registerMutation.mutate({ name, email, password });
    } else {
      loginMutation.mutate({ email, password });
    }
  };

  return (
    <main className="flex min-h-screen bg-background">
      <section className="relative hidden flex-1 items-center justify-center overflow-hidden border-r border-border lg:flex">
        <SignalBackdrop />
        <div className="absolute left-8 top-7 flex items-center gap-2">
          <BrandMark />
          <span className="text-base font-semibold text-foreground">Linply</span>
        </div>
        <div className="relative px-12 text-center">
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-foreground">
            {t.auth.heroLine1}
            <br />
            {t.auth.heroLine2}
          </h1>
          <p className="mx-auto mt-6 max-w-md text-sm leading-6 text-muted-foreground">
            {t.auth.heroSubtitle}
          </p>
        </div>
      </section>

      <section className="flex w-full flex-col lg:w-[26rem] xl:w-[30rem]">
        <div className="flex items-center justify-between gap-2 p-5">
          <div className="flex items-center gap-2 lg:invisible">
            <BrandMark />
            <span className="text-sm font-semibold text-foreground">Linply</span>
          </div>
          <div className="flex items-center gap-2">
          <div
            role="tablist"
            className="flex rounded-lg border border-border bg-muted/60 p-0.5 text-sm"
          >
            {(
              [
                {
                  label: t.auth.tabLogin,
                  path: "/login" as const,
                  active: !isRegister,
                },
                {
                  label: t.auth.tabRegister,
                  path: "/register" as const,
                  active: isRegister,
                },
              ]
            ).map(tab => (
              <button
                key={tab.path}
                type="button"
                role="tab"
                aria-selected={tab.active}
                // Distinct from the submit button, which shares the visible label.
                aria-label={t.auth.switchTo(tab.label)}
                onClick={() => setLocation(getAuthPageUrl(tab.path))}
                className={cn(
                  "rounded-md px-3.5 py-1 transition-colors",
                  tab.active
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
            </div>
            <LanguageToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-10">
          <div className="w-full max-w-[21rem]">
            <h2 className="text-center text-xl font-semibold text-foreground">
              {isRegister ? t.auth.registerTitle : t.auth.loginTitle}
            </h2>

            {oauthError ? (
              <Alert variant="destructive" className="mt-6">
                <AlertCircle />
                <AlertDescription>{oauthError}</AlertDescription>
              </Alert>
            ) : null}

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {isRegister ? (
                <div className="space-y-1.5">
                  <Label htmlFor="name">{t.auth.name}</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    placeholder={t.auth.namePlaceholder}
                    required
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="email">{t.auth.email}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={320}
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">{t.auth.password}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete={
                      isRegister ? "new-password" : "current-password"
                    }
                    className="pr-9"
                    minLength={isRegister ? 8 : 1}
                    maxLength={128}
                    placeholder={isRegister ? t.auth.passwordHint : t.auth.passwordPlaceholder}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(value => !value)}
                    className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {isRegister ? (
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">{t.auth.confirmPassword}</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    placeholder={t.auth.confirmPasswordPlaceholder}
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

              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {isRegister ? t.auth.signUp : t.auth.signIn}
              </Button>
            </form>

            <p className="mt-3 text-center text-sm text-muted-foreground">
              {isRegister ? t.auth.haveAccount : t.auth.noAccount}
              <button
                type="button"
                className="ml-1 font-medium text-foreground hover:underline"
                onClick={() =>
                  setLocation(getAuthPageUrl(isRegister ? "/login" : "/register"))
                }
              >
                {isRegister ? t.auth.signIn : t.auth.signUp}
              </button>
            </p>

            {providersQuery.data?.google ||
            (!isRegister && providersQuery.data?.demoAccount) ? (
              <>
                <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span>{t.auth.orContinueWith}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                <div className="space-y-2">
                  {providersQuery.data?.google ? (
                    <Button asChild variant="outline" className="w-full">
                      <a href={googleOAuthUrl}>
                        <svg
                          className="size-4"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            fill="#4285F4"
                            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
                          />
                        </svg>
                        Google
                      </a>
                    </Button>
                  ) : null}

                  {!isRegister && providersQuery.data?.demoAccount ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setFormError(null);
                        demoLoginMutation.mutate();
                      }}
                      disabled={pending}
                    >
                      {demoLoginMutation.isPending ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      {t.auth.demoAccount}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
