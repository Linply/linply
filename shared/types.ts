/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";
export * from "./knowledge";

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
