import "dotenv/config";
import { createPasswordUser, getUserByEmail, updateUserRole } from "../server/db";
import { hashPassword, normalizeEmail } from "../server/_core/auth";

const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
const password = process.env.ADMIN_PASSWORD ?? "";
const name = process.env.ADMIN_NAME?.trim() || "系统管理员";

if (!email || !email.includes("@")) {
  throw new Error("ADMIN_EMAIL must be set to a valid email address");
}

if (password.length < 8 || password.length > 128) {
  throw new Error("ADMIN_PASSWORD must contain 8 to 128 characters");
}

const existing = await getUserByEmail(email);
if (existing) {
  await updateUserRole(existing.id, "admin");
  console.log(`Promoted ${email} to admin.`);
} else {
  await createPasswordUser({
    email,
    name,
    passwordHash: await hashPassword(password),
    role: "admin",
  });
  console.log(`Created admin account ${email}.`);
}

process.exit(0);
