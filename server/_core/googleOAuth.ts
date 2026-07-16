import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { issueSession, normalizeEmail } from "./auth";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALLBACK_PATH = "/api/auth/oauth/google/callback";
const GOOGLE_STATE_COOKIE = "google_oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;

type GoogleTokenResponse = {
  access_token?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

const getQueryParam = (req: Request, key: string) => {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
};

export const hashOAuthState = (state: string) =>
  createHash("sha256").update(state).digest("hex");

export const sanitizeReturnTo = (value: string | undefined) => {
  if (!value) return "/";
  try {
    const base = new URL("https://app.local");
    const target = new URL(value, base);
    if (target.origin !== base.origin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
};

export const isGoogleOAuthConfigured = () => Boolean(
  ENV.appBaseUrl && ENV.googleClientId && ENV.googleClientSecret
);

export const getGoogleRedirectUri = () => {
  if (!ENV.appBaseUrl) throw new Error("APP_BASE_URL is not configured");
  return new URL(GOOGLE_CALLBACK_PATH, ENV.appBaseUrl).toString();
};

export function buildGoogleAuthorizationUrl(input: {
  state: string;
  codeChallenge: string;
}) {
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: ENV.googleClientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

const secureStringEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const clearOAuthStateCookie = (req: Request, res: Response) => {
  res.clearCookie(GOOGLE_STATE_COOKIE, {
    ...getSessionCookieOptions(req),
    path: GOOGLE_CALLBACK_PATH,
    maxAge: -1,
  });
};

const redirectToLoginError = (res: Response, code: string) => {
  res.redirect(302, `/login?oauthError=${encodeURIComponent(code)}`);
};

async function exchangeGoogleCode(code: string, codeVerifier: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ENV.googleClientId,
      client_secret: ENV.googleClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: getGoogleRedirectUri(),
    }),
    signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json() as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }
  return payload.access_token;
}

async function fetchGoogleUser(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
  });
  const profile = await response.json() as GoogleUserInfo;
  if (
    !response.ok ||
    !profile.sub ||
    !profile.email ||
    profile.email_verified !== true
  ) {
    throw new Error("Google did not return a verified user identity");
  }
  return profile as Required<Pick<GoogleUserInfo, "sub" | "email">> & GoogleUserInfo;
}

export function registerGoogleOAuthRoutes(app: Express) {
  app.get("/api/auth/oauth/google/start", async (req, res) => {
    if (!isGoogleOAuthConfigured()) {
      res.status(503).json({ error: "Google OAuth is not configured" });
      return;
    }

    try {
      const state = randomBytes(32).toString("base64url");
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      await db.createOAuthState({
        provider: "google",
        stateHash: hashOAuthState(state),
        codeVerifier,
        returnTo: sanitizeReturnTo(getQueryParam(req, "returnTo")),
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      });
      res.cookie(GOOGLE_STATE_COOKIE, state, {
        ...getSessionCookieOptions(req),
        path: GOOGLE_CALLBACK_PATH,
        maxAge: OAUTH_STATE_TTL_MS,
      });
      res.redirect(302, buildGoogleAuthorizationUrl({ state, codeChallenge }));
    } catch (error) {
      console.error("[Google OAuth] Start failed", error instanceof Error ? error.message : error);
      res.status(500).json({ error: "Unable to start Google OAuth" });
    }
  });

  app.get(GOOGLE_CALLBACK_PATH, async (req, res) => {
    const state = getQueryParam(req, "state");
    const code = getQueryParam(req, "code");
    const providerError = getQueryParam(req, "error");
    const cookieState = parseCookieHeader(req.headers.cookie ?? "")[GOOGLE_STATE_COOKIE];

    if (providerError) {
      clearOAuthStateCookie(req, res);
      redirectToLoginError(res, "oauth_denied");
      return;
    }

    if (!state || !code || !cookieState || !secureStringEqual(state, cookieState)) {
      clearOAuthStateCookie(req, res);
      redirectToLoginError(res, "invalid_state");
      return;
    }

    let oauthState;
    try {
      oauthState = await db.consumeOAuthState("google", hashOAuthState(state));
    } catch (error) {
      console.error("[Google OAuth] State lookup failed", error instanceof Error ? error.message : error);
      clearOAuthStateCookie(req, res);
      redirectToLoginError(res, "oauth_failed");
      return;
    }
    clearOAuthStateCookie(req, res);
    if (!oauthState) {
      redirectToLoginError(res, "invalid_state");
      return;
    }

    try {
      const accessToken = await exchangeGoogleCode(code, oauthState.codeVerifier);
      const profile = await fetchGoogleUser(accessToken);
      const email = normalizeEmail(profile.email);
      const user = await db.findOrCreateOAuthUser({
        provider: "google",
        providerAccountId: profile.sub,
        email,
        name: profile.name?.trim() || email.split("@")[0] || "Google User",
        avatarUrl: profile.picture ?? null,
      });
      if (user.disabledAt) throw new Error("User disabled");

      await db.updateUserLastSignedIn(user.id);
      await issueSession(user.id, req, res);
      res.redirect(302, sanitizeReturnTo(oauthState.returnTo));
    } catch (error) {
      console.error("[Google OAuth] Callback failed", error instanceof Error ? error.message : error);
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "OAUTH_ACCOUNT_LINK_REQUIRED"
          ? "account_link_required"
          : "oauth_failed";
      redirectToLoginError(res, errorCode);
    }
  });
}
