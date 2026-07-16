import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  createOAuthState: vi.fn(),
  consumeOAuthState: vi.fn(),
  findOrCreateOAuthUser: vi.fn(),
  updateUserLastSignedIn: vi.fn(),
}));

vi.mock("./auth", () => ({
  issueSession: vi.fn(),
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

import * as db from "../db";
import { issueSession } from "./auth";
import { ENV } from "./env";
import {
  hashOAuthState,
  isGoogleOAuthConfigured,
  registerGoogleOAuthRoutes,
  sanitizeReturnTo,
} from "./googleOAuth";

type Route = {
  path: string;
  handler: (req: any, res: any) => Promise<void> | void;
};

const mockedDb = vi.mocked(db);
const mockedIssueSession = vi.mocked(issueSession);
const originalEnv = { ...ENV };

function createFakeApp() {
  const routes: Route[] = [];
  return {
    routes,
    app: {
      get: (path: string, handler: Route["handler"]) => routes.push({ path, handler }),
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    jsonBody: undefined as unknown,
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    clearedCookies: [] as Array<{ name: string; options: Record<string, unknown> }>,
    redirectTo: undefined as string | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      this.clearedCookies.push({ name, options });
      return this;
    },
    redirect(_status: number, location: string) {
      this.redirectTo = location;
      return this;
    },
  };
}

const getRoute = (routes: Route[], path: string) => {
  const route = routes.find(candidate => candidate.path === path);
  if (!route) throw new Error(`Missing route ${path}`);
  return route;
};

describe("Google OAuth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.assign(ENV, {
      appBaseUrl: "http://localhost:3000",
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    });
  });

  afterEach(() => {
    Object.assign(ENV, originalEnv);
    vi.restoreAllMocks();
  });

  it("stores a hashed state and redirects with PKCE parameters", async () => {
    mockedDb.createOAuthState.mockResolvedValue({} as never);
    const { app, routes } = createFakeApp();
    registerGoogleOAuthRoutes(app as any);
    const response = createResponse();

    await getRoute(routes, "/api/auth/oauth/google/start").handler({
      query: { returnTo: "/tickets?status=pending" },
      headers: {},
      protocol: "http",
    }, response);

    expect(response.cookies).toHaveLength(1);
    const state = response.cookies[0]!.value;
    expect(response.cookies[0]).toMatchObject({
      name: "google_oauth_state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/api/auth/oauth/google/callback",
      },
    });
    expect(mockedDb.createOAuthState).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google",
      stateHash: hashOAuthState(state),
      codeVerifier: expect.any(String),
      returnTo: "/tickets?status=pending",
      expiresAt: expect.any(Date),
    }));
    expect(mockedDb.createOAuthState.mock.calls[0]![0].stateHash).not.toBe(state);

    const redirect = new URL(response.redirectTo!);
    expect(redirect.origin).toBe("https://accounts.google.com");
    expect(redirect.searchParams.get("state")).toBe(state);
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirect.searchParams.get("code_challenge")).toBeTruthy();
    expect(redirect.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/oauth/google/callback"
    );
  });

  it("consumes a matching state, links the verified identity, and issues a session", async () => {
    const state = "matching-state";
    mockedDb.consumeOAuthState.mockResolvedValue({
      id: 1,
      provider: "google",
      stateHash: hashOAuthState(state),
      codeVerifier: "pkce-verifier",
      returnTo: "/tickets",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    mockedDb.findOrCreateOAuthUser.mockResolvedValue({
      id: 9,
      name: "Google User",
      email: "user@example.com",
      role: "user",
      avatarUrl: "https://example.com/avatar.png",
      emailVerifiedAt: new Date(),
      disabledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });
    mockedDb.updateUserLastSignedIn.mockResolvedValue(undefined);
    mockedIssueSession.mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: "google-user-id",
        email: "User@Example.COM",
        email_verified: true,
        name: "Google User",
        picture: "https://example.com/avatar.png",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    const { app, routes } = createFakeApp();
    registerGoogleOAuthRoutes(app as any);
    const request = {
      query: { state, code: "authorization-code" },
      headers: { cookie: `google_oauth_state=${state}` },
      protocol: "http",
      get: () => "vitest",
      ip: "127.0.0.1",
    };
    const response = createResponse();

    await getRoute(routes, "/api/auth/oauth/google/callback").handler(request, response);

    expect(mockedDb.consumeOAuthState).toHaveBeenCalledWith("google", hashOAuthState(state));
    expect(mockedDb.findOrCreateOAuthUser).toHaveBeenCalledWith({
      provider: "google",
      providerAccountId: "google-user-id",
      email: "user@example.com",
      name: "Google User",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(mockedIssueSession).toHaveBeenCalledWith(9, request, response);
    expect(response.redirectTo).toBe("/tickets");
  });

  it("rejects a callback whose state is not bound to the browser cookie", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { app, routes } = createFakeApp();
    registerGoogleOAuthRoutes(app as any);
    const response = createResponse();

    await getRoute(routes, "/api/auth/oauth/google/callback").handler({
      query: { state: "query-state", code: "authorization-code" },
      headers: { cookie: "google_oauth_state=different-state" },
      protocol: "http",
    }, response);

    expect(response.redirectTo).toBe("/login?oauthError=invalid_state");
    expect(mockedDb.consumeOAuthState).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a Google identity whose email is not verified", async () => {
    const state = "unverified-email-state";
    mockedDb.consumeOAuthState.mockResolvedValue({
      id: 2,
      provider: "google",
      stateHash: hashOAuthState(state),
      codeVerifier: "pkce-verifier",
      returnTo: "/",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: "google-user-id",
        email: "user@example.com",
        email_verified: false,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    const { app, routes } = createFakeApp();
    registerGoogleOAuthRoutes(app as any);
    const response = createResponse();
    await getRoute(routes, "/api/auth/oauth/google/callback").handler({
      query: { state, code: "authorization-code" },
      headers: { cookie: `google_oauth_state=${state}` },
      protocol: "http",
    }, response);

    expect(response.redirectTo).toBe("/login?oauthError=oauth_failed");
    expect(mockedDb.findOrCreateOAuthUser).not.toHaveBeenCalled();
    expect(mockedIssueSession).not.toHaveBeenCalled();
  });

  it("requires explicit linking for an existing unverified password account", async () => {
    const state = "link-required-state";
    mockedDb.consumeOAuthState.mockResolvedValue({
      id: 3,
      provider: "google",
      stateHash: hashOAuthState(state),
      codeVerifier: "pkce-verifier",
      returnTo: "/",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    mockedDb.findOrCreateOAuthUser.mockRejectedValue(Object.assign(
      new Error("OAuth account linking requires a verified email"),
      { code: "OAUTH_ACCOUNT_LINK_REQUIRED" }
    ));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: "google-user-id",
        email: "user@example.com",
        email_verified: true,
        name: "Google User",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    const { app, routes } = createFakeApp();
    registerGoogleOAuthRoutes(app as any);
    const response = createResponse();
    await getRoute(routes, "/api/auth/oauth/google/callback").handler({
      query: { state, code: "authorization-code" },
      headers: { cookie: `google_oauth_state=${state}` },
      protocol: "http",
    }, response);

    expect(response.redirectTo).toBe("/login?oauthError=account_link_required");
    expect(mockedIssueSession).not.toHaveBeenCalled();
  });
});

describe("OAuth redirect validation", () => {
  it("allows local paths and rejects absolute or protocol-relative targets", () => {
    expect(sanitizeReturnTo("/tickets?status=pending")).toBe("/tickets?status=pending");
    expect(sanitizeReturnTo("//evil.example/path")).toBe("/");
    expect(sanitizeReturnTo("/\\evil.example/path")).toBe("/");
    expect(sanitizeReturnTo("https://evil.example/path")).toBe("/");
  });

  it("disables Google OAuth when any required setting is missing", () => {
    const configured = {
      appBaseUrl: ENV.appBaseUrl,
      googleClientId: ENV.googleClientId,
      googleClientSecret: ENV.googleClientSecret,
    };
    Object.assign(ENV, {
      appBaseUrl: "http://localhost:3000",
      googleClientId: "client-id",
      googleClientSecret: "",
    });
    expect(isGoogleOAuthConfigured()).toBe(false);
    Object.assign(ENV, configured);
  });
});
