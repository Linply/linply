import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import { COOKIE_NAME, SESSION_DURATION_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

const runScrypt = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = await runScrypt(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, n, r, p, saltValue, hashValue] = encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await runScrypt(password, Buffer.from(saltValue, "base64url"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const hashSessionToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const getSessionToken = (req: Request) => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  return parseCookieHeader(cookieHeader)[COOKIE_NAME];
};

const getRequestIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return value?.trim() || req.ip || null;
};

export function toPublicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    lastSignedIn: user.lastSignedIn,
  };
}

export async function issueSession(userId: number, req: Request, res: Response) {
  const token = randomBytes(32).toString("base64url");
  await db.createSession({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    ipAddress: getRequestIp(req),
    userAgent: req.get("user-agent") ?? null,
  });
  res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: SESSION_DURATION_MS,
  });
}

export async function registerWithPassword(input: {
  name: string;
  email: string;
  password: string;
}, req: Request, res: Response) {
  const email = normalizeEmail(input.email);
  const user = await db.createPasswordUser({
    name: input.name.trim(),
    email,
    passwordHash: await hashPassword(input.password),
  });
  await issueSession(user.id, req, res);
  return toPublicUser(user);
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
}, req: Request, res: Response) {
  const account = await db.getPasswordAccountByEmail(normalizeEmail(input.email));
  if (!account?.passwordHash) {
    await hashPassword(input.password);
    throw ForbiddenError("邮箱或密码错误");
  }

  const passwordValid = await verifyPassword(input.password, account.passwordHash);
  if (!passwordValid || account.user.disabledAt) {
    throw ForbiddenError("邮箱或密码错误");
  }

  await db.updateUserLastSignedIn(account.user.id);
  await issueSession(account.user.id, req, res);
  return toPublicUser({ ...account.user, lastSignedIn: new Date() });
}

export async function authenticateRequest(req: Request) {
  const token = getSessionToken(req);
  if (!token) throw ForbiddenError("Invalid session");

  const result = await db.getActiveSessionWithUser(hashSessionToken(token));
  if (!result) throw ForbiddenError("Invalid session");

  if (Date.now() - result.session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    void db.touchSession(result.session.id).catch(() => undefined);
  }

  return result.user;
}

export async function revokeRequestSession(req: Request) {
  const token = getSessionToken(req);
  if (token) await db.revokeSession(hashSessionToken(token));
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}
