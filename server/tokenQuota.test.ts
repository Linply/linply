import { describe, expect, it } from "vitest";
import {
  getTokenSettlement,
  shouldRejectTokenReservation,
  TokenQuotaExceededError,
  utcDayFromDate,
  utcResetAtFromDay,
} from "./tokenQuota";

const base = {
  quotaLimitTokens: 10_000,
  usedTokens: 4_000,
  reservedTokens: 2_000,
  requestedTokens: 4_001,
  adminExempt: false,
};

describe("token quota policy", () => {
  it("keeps observation mode accounting without rejecting", () => {
    expect(shouldRejectTokenReservation({ ...base, enforced: false })).toBe(false);
    expect(
      shouldRejectTokenReservation({
        ...base,
        enforced: true,
        quotaLimitTokens: 0,
      })
    ).toBe(false);
  });

  it("rejects hard-limit reservations and honors admin exemption", () => {
    expect(shouldRejectTokenReservation({ ...base, enforced: true })).toBe(true);
    expect(
      shouldRejectTokenReservation({
        ...base,
        enforced: true,
        adminExempt: true,
      })
    ).toBe(false);
  });

  it("settles successful actual usage even above the reservation", () => {
    expect(
      getTokenSettlement({
        reservedTokens: 1_000,
        modelStarted: true,
        usage: { inputTokens: 900, outputTokens: 600, totalTokens: 1_500 },
      })
    ).toEqual({
      usageState: "actual",
      inputTokens: 900,
      outputTokens: 600,
      totalTokens: 1_500,
      countedTokens: 1_500,
    });
  });

  it("distinguishes explicit no-model from started unknown usage", () => {
    expect(
      getTokenSettlement({ reservedTokens: 2_000, modelStarted: false })
    ).toEqual({
      usageState: "no_model",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      countedTokens: 0,
    });
    expect(
      getTokenSettlement({ reservedTokens: 2_000, modelStarted: true })
    ).toEqual({
      usageState: "unknown",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      countedTokens: 2_000,
    });
  });

  it("uses UTC natural-day boundaries", () => {
    expect(utcDayFromDate(new Date("2026-07-30T23:59:59.999Z"))).toBe(
      "2026-07-30"
    );
    expect(utcResetAtFromDay("2026-07-31")).toBe(
      "2026-08-01T00:00:00.000Z"
    );
    expect(utcResetAtFromDay("2026-12-31")).toBe(
      "2027-01-01T00:00:00.000Z"
    );
  });

  it("provides a structured quota exceeded error", () => {
    const quota = {
      bucketDate: "2026-07-30",
      resetAt: "2026-07-31T00:00:00.000Z",
      quotaLimitTokens: 10_000,
      reservedTokens: 2_000,
      usedTokens: 8_000,
      remainingTokens: 0,
      enforced: true,
      adminExempt: false,
    };
    const error = new TokenQuotaExceededError(quota);
    expect(error.code).toBe("TOKEN_QUOTA_EXCEEDED");
    expect(error.quota).toEqual(quota);
  });
});
