import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const COOKIE = "studio17_session";
const SESSION_AGE = 60 * 60 * 24 * 30;

type Credentials = { email?: unknown; password?: unknown; displayName?: unknown };

export async function POST(request: Request) {
  const mode = new URL(request.url).searchParams.get("mode");
  let body: Credentials;
  try { body = await request.json(); } catch { return Response.json({ error: "Please enter your email and password." }, { status: 400 }); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (password.length < 10 || password.length > 200) return Response.json({ error: "Password must be 10–200 characters." }, { status: 400 });
  const db = getDb();
  const existing = (await db.select().from(users).where(eq(users.email, email))).at(0);
  if (mode === "register") {
    if (existing?.passwordHash) return Response.json({ error: "An account with this email already exists." }, { status: 409 });
    const now = Date.now();
    const displayName = String(body.displayName || email.split("@")[0]).trim().slice(0, 60) || "Studio17 musician";
    if (existing) {
      await db.update(users).set({ passwordHash: await hashPassword(password), displayName, updatedAt: now }).where(eq(users.email, email));
    } else {
      const username = await availableUsername(email);
      await db.insert(users).values({ email, passwordHash: await hashPassword(password), username, displayName, bio: "", createdAt: now, updatedAt: now });
    }
    return sessionResponse(email);
  }
  if (!existing?.passwordHash || !(await verifyPassword(password, existing.passwordHash))) return Response.json({ error: "Incorrect email or password." }, { status: 401 });
  return sessionResponse(email);
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("action") !== "logout") return Response.json({ error: "Not found." }, { status: 404 });
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to") || "/");
  const headers = new Headers({ Location: returnTo, "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  return new Response(null, { status: 303, headers });
}

async function sessionResponse(email: string) {
  const rawToken = randomToken(); const now = Date.now(); const expiresAt = now + SESSION_AGE * 1000;
  await getDb().insert(sessions).values({ tokenHash: await sha256(rawToken), userEmail: email, expiresAt, createdAt: now });
  return Response.json({ authenticated: true }, { headers: { "Set-Cookie": `${COOKIE}=${rawToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_AGE}`, "Cache-Control": "no-store" } });
}

async function availableUsername(email: string) {
  const base = (email.split("@")[0] || "musician").toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22) || "musician";
  for (let attempt = 0; attempt < 20; attempt++) { const candidate = attempt ? `${base}-${attempt + 1}` : base; if (!(await getDb().select({ email: users.email }).from(users).where(eq(users.username, candidate))).at(0)) return candidate; }
  return `musician-${crypto.randomUUID().slice(0, 8)}`;
}

async function hashPassword(password: string) { const salt = randomToken(); const derived = await derive(password, salt); return `${salt}.${derived}`; }
async function verifyPassword(password: string, value: string) { const [salt, expected] = value.split("."); if (!salt || !expected) return false; const actual = await derive(password, salt); return timingSafeEqual(actual, expected); }
async function derive(password: string, salt: string) { const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 310_000, hash: "SHA-256" }, material, 256); return toBase64Url(new Uint8Array(bits)); }
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""); }
function randomToken() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return toBase64Url(bytes); }
function toBase64Url(bytes: Uint8Array) { let binary = ""; bytes.forEach(byte => binary += String.fromCharCode(byte)); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function timingSafeEqual(a: string, b: string) { if (a.length !== b.length) return false; let mismatch = 0; for (let index = 0; index < a.length; index++) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index); return mismatch === 0; }
function safeReturnTo(value: string) { return value.startsWith("/") && !value.startsWith("//") ? value : "/"; }
