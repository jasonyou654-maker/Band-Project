import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

const SESSION_COOKIE = "studio17_session";
const SIGN_IN_PATH = "/login";
const SIGN_OUT_PATH = "/api/auth?action=logout";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const db = getDb();
  const session = (await db.select().from(sessions).where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))).at(0);
  if (!session) return null;
  const user = (await db.select().from(users).where(eq(users.email, session.userEmail))).at(0);
  if (!user) return null;

  return {
    displayName: user.displayName,
    email: user.email,
    fullName: user.displayName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}&return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (url.pathname === SIGN_IN_PATH || url.pathname === SIGN_OUT_PATH) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
