import { config } from "dotenv";

/**
 * Import this instead of `dotenv/config`, which only ever reads `.env`.
 *
 * `.env.local` is the gitignored personal override and `.env` is the shared
 * baseline. dotenv keeps the first value it sees and never overwrites what the
 * real environment already set, so listing local first makes it win locally
 * while Railway's own variables still win in production.
 */
config({ path: [".env.local", ".env"] });
