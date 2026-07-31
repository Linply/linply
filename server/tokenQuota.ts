export const TOKEN_QUOTA_EXCEEDED_CODE = "TOKEN_QUOTA_EXCEEDED" as const;

export type TokenUsageState = "reserved" | "actual" | "no_model" | "unknown";

export type TokenQuotaSnapshot = {
  bucketDate: string;
  resetAt: string;
  quotaLimitTokens: number;
  reservedTokens: number;
  usedTokens: number;
  remainingTokens: number | null;
  enforced: boolean;
  adminExempt: boolean;
};

export class TokenQuotaExceededError extends Error {
  readonly code = TOKEN_QUOTA_EXCEEDED_CODE;
  readonly quota: TokenQuotaSnapshot;

  constructor(quota: TokenQuotaSnapshot) {
    super("今日 Token 额度不足，请在 UTC 自然日重置后重试");
    this.name = "TokenQuotaExceededError";
    this.quota = quota;
  }
}

export const utcDayFromDate = (date: Date) => date.toISOString().slice(0, 10);

export const utcResetAtFromDay = (bucketDate: string) => {
  const reset = new Date(`${bucketDate}T00:00:00.000Z`);
  reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.toISOString();
};

export const shouldRejectTokenReservation = (input: {
  quotaLimitTokens: number;
  usedTokens: number;
  reservedTokens: number;
  requestedTokens: number;
  enforced: boolean;
  adminExempt: boolean;
}) =>
  input.enforced &&
  !input.adminExempt &&
  input.quotaLimitTokens > 0 &&
  input.usedTokens + input.reservedTokens + input.requestedTokens >
    input.quotaLimitTokens;

export const getTokenSettlement = (input: {
  reservedTokens: number;
  modelStarted: boolean;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}): {
  usageState: Exclude<TokenUsageState, "reserved">;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  countedTokens: number;
} => {
  if (input.usage) {
    return {
      usageState: "actual",
      inputTokens: Math.max(0, Math.trunc(input.usage.inputTokens)),
      outputTokens: Math.max(0, Math.trunc(input.usage.outputTokens)),
      totalTokens: Math.max(0, Math.trunc(input.usage.totalTokens)),
      countedTokens: Math.max(0, Math.trunc(input.usage.totalTokens)),
    };
  }
  if (!input.modelStarted) {
    return {
      usageState: "no_model",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      countedTokens: 0,
    };
  }
  return {
    usageState: "unknown",
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    countedTokens: Math.max(0, Math.trunc(input.reservedTokens)),
  };
};
