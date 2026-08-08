import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Loads the signed-in owner's workspace. Every authenticated page needs it, so
 * the query is shared through React Query's cache rather than prop-drilled.
 *
 * Pass `requireOnboarded` on pages that assume a configured agent — they push
 * brand-new accounts into the wizard instead of showing empty screens.
 */
export function useWorkspace(options?: { requireOnboarded?: boolean }) {
  const { requireOnboarded = true } = options ?? {};
  const { user, loading: authLoading } = useAuth({
    redirectOnUnauthenticated: true,
  });
  const [, setLocation] = useLocation();

  const workspaceQuery = trpc.workspace.get.useQuery(undefined, {
    enabled: Boolean(user),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const workspace = workspaceQuery.data ?? null;
  const needsOnboarding = Boolean(workspace && !workspace.onboardingCompletedAt);

  useEffect(() => {
    if (!requireOnboarded || !needsOnboarding) return;
    setLocation("/onboarding");
  }, [needsOnboarding, requireOnboarded, setLocation]);

  return {
    user,
    workspace,
    needsOnboarding,
    loading: authLoading || workspaceQuery.isLoading,
    error: workspaceQuery.error,
    refetch: workspaceQuery.refetch,
  };
}

export type WorkspaceSummary = NonNullable<
  ReturnType<typeof useWorkspace>["workspace"]
>;
