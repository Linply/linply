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

import { COOKIE_NAME, SESSION_DURATION_MS } from "../../shared/const";
import * as db from "../db";
import {
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  registerWithPassword,
  revokeRequestSession,
  verifyPassword,
} from "./auth";

const mockedDb = vi.mocked(db);

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

  it("revokes the database session represented by the request cookie", async () => {
    mockedDb.revokeSession.mockResolvedValue(undefined);
    await revokeRequestSession(createRequest(`${COOKIE_NAME}=raw-session-token`));

    expect(mockedDb.revokeSession).toHaveBeenCalledWith(
      hashSessionToken("raw-session-token")
    );
  });
});
