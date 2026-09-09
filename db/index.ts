import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type RuntimeEnv = { DB?: D1Database };

export function getDb() {
  // The deployed Worker handles /api/sheets directly. This lookup keeps the
  // local route usable without importing the Cloudflare-only `env` protocol,
  // which cannot be bundled by the GitHub Pages static build.
  const env = (globalThis as typeof globalThis & { env?: RuntimeEnv }).env;
  if (!env?.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
