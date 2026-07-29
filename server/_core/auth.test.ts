import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  createPasswordUser: vi.fn(),
  createSession: vi.fn(),
  getPasswordAccountByEmail: vi.fn(),
  getActiveSessionWithUser: vi.fn(),
  revokeSession: vi.fn(),
  touchSession: vi.fn(),
  updateUserLastSignedIn: vi.fn(),
}));

vi.mock("./sessionCache", () => ({
  cacheSession: vi.fn(),
  getCachedSession: vi.fn(),
  markSessionRevoked: vi.fn(),
}));

import { COOKIE_NAME, SESSION_DURATION_MS } from "../../shared/const";
import * as db from "../db";
import {
  authenticateRequest,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  registerWithPassword,
  revokeRequestSession,
  verifyPassword,
} from "./auth";
import * as sessionCache from "./sessionCache";

const mockedDb = vi.mocked(db);
const mockedSessionCache = vi.mocked(sessionCache);

const createUser = () => ({
  id: 8,
  name: "测试用户",
  email: "user@example.com",
  role: "user" as const,
  avatarUrl: null,
  emailVerifiedAt: null,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
});

const createSessionResult = (lastSeenAt = new Date()) => ({
  session: {
    id: 12,
    userId: 8,
    tokenHash: hashSessionToken("raw-session-token"),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    lastSeenAt,
  },
  user: createUser(),
});

const createRequest = (cookie?: string) => ({
  headers: cookie ? { cookie } : {},
  ip: "127.0.0.1",
  protocol: "http",
  get: (name: string) => name === "user-agent" ? "vitest" : undefined,
}) as any;

const createResponse = () => ({
  cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  cookie(name: string, value: string, options: Record<string, unknown>) {
    this.cookies.push({ name, value, options });
  },
}) as any;

describe("password authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSessionCache.getCachedSession.mockResolvedValue({ status: "miss" });
    mockedSessionCache.cacheSession.mockResolvedValue(undefined);
    mockedSessionCache.markSessionRevoked.mockResolvedValue(undefined);
    mockedDb.touchSession.mockResolvedValue(undefined);
  });

  it("normalizes emails and verifies scrypt password hashes", async () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    const encoded = await hashPassword("correct horse battery staple");

    expect(encoded).toMatch(/^scrypt\$/);
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("creates a normalized password account and stores only the session hash", async () => {
    mockedDb.createPasswordUser.mockResolvedValue({
      id: 8,
      name: "测试用户",
      email: "user@example.com",
      role: "user",
      avatarUrl: null,
      emailVerifiedAt: null,
      disabledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });
    mockedDb.createSession.mockResolvedValue({} as never);
    const response = createResponse();

    const user = await registerWithPassword({
      name: " 测试用户 ",
      email: " User@Example.COM ",
      password: "password123",
    }, createRequest(), response);

    expect(user.email).toBe("user@example.com");
    expect(mockedDb.createPasswordUser).toHaveBeenCalledWith(expect.objectContaining({
      name: "测试用户",
      email: "user@example.com",
      passwordHash: expect.stringMatching(/^scrypt\$/),
    }));
    expect(response.cookies).toHaveLength(1);
    expect(response.cookies[0]).toMatchObject({
      name: COOKIE_NAME,
      options: { httpOnly: true, sameSite: "lax", maxAge: SESSION_DURATION_MS },
    });
    const rawToken = response.cookies[0].value;
    expect(mockedDb.createSession).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: hashSessionToken(rawToken),
      userAgent: "vitest",
    }));
    expect(mockedDb.createSession.mock.calls[0]?.[0].tokenHash).not.toBe(rawToken);
  });

  it("uses a cached session without querying PostgreSQL", async () => {
    const result = createSessionResult();
    mockedSessionCache.getCachedSession.mockResolvedValue({
      status: "hit",
      value: result,
    });

    await expect(authenticateRequest(
      createRequest(`${COOKIE_NAME}=raw-session-token`)
    )).resolves.toEqual(result.user);

    expect(mockedDb.getActiveSessionWithUser).not.toHaveBeenCalled();
    expect(mockedSessionCache.cacheSession).not.toHaveBeenCalled();
  });

  it("falls back to PostgreSQL and fills the cache on a miss", async () => {
    const result = createSessionResult(new Date(Date.now() - 16 * 60_000));
    mockedDb.getActiveSessionWithUser.mockResolvedValue(result);

    await expect(authenticateRequest(
      createRequest(`${COOKIE_NAME}=raw-session-token`)
    )).resolves.toEqual(result.user);

    const tokenHash = hashSessionToken("raw-session-token");
    expect(mockedDb.getActiveSessionWithUser).toHaveBeenCalledWith(tokenHash);
    expect(mockedSessionCache.cacheSession).toHaveBeenCalledWith(tokenHash, result);
    expect(mockedDb.touchSession).toHaveBeenCalledWith(result.session.id);
  });

  it("rejects a revoked cache tombstone without querying PostgreSQL", async () => {
    mockedSessionCache.getCachedSession.mockResolvedValue({ status: "revoked" });

    await expect(authenticateRequest(
      createRequest(`${COOKIE_NAME}=raw-session-token`)
    )).rejects.toThrow("Invalid session");
    expect(mockedDb.getActiveSessionWithUser).not.toHaveBeenCalled();
  });

  it("does not cache an invalid database session", async () => {
    mockedDb.getActiveSessionWithUser.mockResolvedValue(undefined);

    await expect(authenticateRequest(
      createRequest(`${COOKIE_NAME}=raw-session-token`)
    )).rejects.toThrow("Invalid session");
    expect(mockedSessionCache.cacheSession).not.toHaveBeenCalled();
  });

  it("revokes PostgreSQL before recording a cache tombstone", async () => {
    mockedDb.revokeSession.mockResolvedValue(undefined);
    await revokeRequestSession(createRequest(`${COOKIE_NAME}=raw-session-token`));

    const tokenHash = hashSessionToken("raw-session-token");
    expect(mockedDb.revokeSession).toHaveBeenCalledWith(tokenHash);
    expect(mockedSessionCache.markSessionRevoked).toHaveBeenCalledWith(tokenHash);
    expect(mockedDb.revokeSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSessionCache.markSessionRevoked.mock.invocationCallOrder[0]!
    );
  });
});
