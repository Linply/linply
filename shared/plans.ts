/**
 * Plan catalog, shared by server enforcement and the pricing UI so limits can
 * never drift between what is advertised and what is enforced.
 *
 * Billing is deliberately not wired up: `POST plans.requestUpgrade` records the
 * intent and the workspace stays on its current plan until someone approves it.
 * When payment lands, only that mutation needs to change.
 */

export const WORKSPACE_PLANS = [
  "free",
  "pro",
  "business",
  "self_hosted",
] as const;

export type WorkspacePlan = (typeof WORKSPACE_PLANS)[number];

export type PlanLimits = {
  /** Knowledge entries retained per workspace. */
  knowledgeEntries: number;
  /** Agent tokens per UTC day. 1 Credit = 1,000 tokens. */
  dailyTokens: number;
  /** External IM channels (the built-in share link never counts). */
  connectedChannels: number;
  /** Rolling 30-day cap on distinct external contacts. */
  monthlyContacts: number;
};

export type PlanDefinition = {
  id: WorkspacePlan;
  /** Monthly price in USD. `null` means "not sold" (self-hosted). */
  priceUsd: number | null;
  limits: PlanLimits;
  /** Feature switches; the UI renders these as the comparison rows. */
  features: {
    shareLink: boolean;
    telegram: boolean;
    removeBranding: boolean;
    customerCards: boolean;
    prioritySupport: boolean;
  };
};

/** `Infinity` is intentional: self-hosted enforces nothing. */
export const PLANS: Record<WorkspacePlan, PlanDefinition> = {
  free: {
    id: "free",
    priceUsd: 0,
    limits: {
      knowledgeEntries: 100,
      dailyTokens: 100_000,
      connectedChannels: 1,
      monthlyContacts: 100,
    },
    features: {
      shareLink: true,
      telegram: true,
      removeBranding: false,
      customerCards: false,
      prioritySupport: false,
    },
  },
  pro: {
    id: "pro",
    priceUsd: 5,
    limits: {
      knowledgeEntries: 2_000,
      dailyTokens: 1_000_000,
      connectedChannels: 3,
      monthlyContacts: 2_000,
    },
    features: {
      shareLink: true,
      telegram: true,
      removeBranding: true,
      customerCards: false,
      prioritySupport: false,
    },
  },
  business: {
    id: "business",
    priceUsd: 20,
    limits: {
      knowledgeEntries: 20_000,
      dailyTokens: 5_000_000,
      connectedChannels: 10,
      monthlyContacts: 20_000,
    },
    features: {
      shareLink: true,
      telegram: true,
      removeBranding: true,
      customerCards: true,
      prioritySupport: true,
    },
  },
  self_hosted: {
    id: "self_hosted",
    priceUsd: null,
    limits: {
      knowledgeEntries: Number.POSITIVE_INFINITY,
      dailyTokens: Number.POSITIVE_INFINITY,
      connectedChannels: Number.POSITIVE_INFINITY,
      monthlyContacts: Number.POSITIVE_INFINITY,
    },
    features: {
      shareLink: true,
      telegram: true,
      removeBranding: true,
      customerCards: true,
      prioritySupport: false,
    },
  },
};

/** Display order on the pricing page. */
export const PLAN_ORDER: WorkspacePlan[] = [
  "free",
  "pro",
  "business",
  "self_hosted",
];

export const getPlan = (plan: WorkspacePlan) => PLANS[plan];

export const isPlanUpgrade = (from: WorkspacePlan, to: WorkspacePlan) =>
  PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);

export const isUnlimited = (value: number) => !Number.isFinite(value);

export type LimitKey = keyof PlanLimits;

/**
 * A limit check result. `limit` is echoed back so callers can build a message
 * without re-reading the catalog.
 */
export type LimitCheck = {
  allowed: boolean;
  limit: number;
  used: number;
};

export const checkLimit = (
  plan: WorkspacePlan,
  key: LimitKey,
  used: number,
  requested = 1
): LimitCheck => {
  const limit = PLANS[plan].limits[key];
  return {
    allowed: isUnlimited(limit) || used + requested <= limit,
    limit,
    used,
  };
};
