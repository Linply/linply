import "dotenv/config";
import { createPasswordUser, getUserByEmail } from "../server/db";
import { hashPassword, normalizeEmail } from "../server/_core/auth";
import { requireWorkspaceForUser } from "../server/workspace";

/**
 * Creates an account and provisions its workspace up front. There is no
 * administrator role: this is the same kind of account sign-up produces, it
 * just skips the web form (useful for seeding a demo login).
 */
const email = normalizeEmail(process.env.SEED_USER_EMAIL ?? process.env.ADMIN_EMAIL ?? "");
const password = process.env.SEED_USER_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "";
const name = (process.env.SEED_USER_NAME ?? process.env.ADMIN_NAME)?.trim() || "示例用户";

if (!email || !email.includes("@")) {
  throw new Error("SEED_USER_EMAIL must be set to a valid email address");
}

if (password.length < 8 || password.length > 128) {
  throw new Error("SEED_USER_PASSWORD must contain 8 to 128 characters");
}

const existing = await getUserByEmail(email);
const user =
  existing ??
  (await createPasswordUser({
    email,
    name,
    passwordHash: await hashPassword(password),
  }));

const workspace = await requireWorkspaceForUser(user);
console.log(
  existing
    ? `Account ${email} already exists; workspace #${workspace.id} is ready.`
    : `Created account ${email} with workspace #${workspace.id}.`
);

process.exit(0);
