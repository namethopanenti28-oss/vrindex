/**
 * Central env bootstrap.
 *
 * Loads .env once and backfills prototype-safe defaults so a fresh clone runs
 * with `npm run dev` and no manual setup. Production values always win because
 * dotenv does not overwrite variables that already exist in the environment.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const ROOT = path.resolve(process.cwd());

// dotenv only reads ./.env by default; resolve it next to the server folder so
// the app works whether it is started from the repo root or the server folder.
const candidates = [
  path.join(ROOT, ".env"),
  path.join(ROOT, "server", ".env"),
  path.resolve(ROOT, "healthcare-appointment-platform", "server", ".env"),
];

let loaded = null;
for (const file of candidates) {
  if (fs.existsSync(file)) {
    loaded = dotenv.config({ path: file });
    break;
  }
}

if (!loaded) {
  console.warn("[env] no .env file found - falling back to built-in defaults");
}

/** Keys the prototype needs, with the value used when unset. */
const DEFAULTS = {
  PORT: "5000",
  NODE_ENV: "development",
  JWT_SECRET: "medicare-prototype-dev-secret",
  JWT_EXPIRES_IN: "7d",
  CORS_ORIGIN: "http://localhost:5173",
  GEMINI_MODEL: "gemini-1.5-flash",
  NOTIFICATION_FROM_EMAIL: "notifications@medicare.demo",
};

for (const [key, fallback] of Object.entries(DEFAULTS)) {
  if (!process.env[key]) process.env[key] = fallback;
}

// Warn (not throw) about optional integrations so the app still boots.
const OPTIONAL = {
  GEMINI_KEY: "Google Gemini (live AI triage) - using rule-based engine",
  SUPABASE_URL: "Supabase - using the in-memory database",
  TWILIO_ACCOUNT_SID: "Twilio SMS - logging notifications to console",
  RESEND_API_KEY: "Resend email - logging notifications to console",
};

for (const [key, label] of Object.entries(OPTIONAL)) {
  if (!process.env[key]) console.warn(`[env] ${label} (${key} not set)`);
}
