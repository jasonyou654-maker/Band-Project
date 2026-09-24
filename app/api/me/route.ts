import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureUserProfile, toPublicProfile } from "@/app/lib/studio17-data";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function currentProfile() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  return { identity, profile: await ensureUserProfile(identity) };
}

export async function GET() {
  try {
    const current = await currentProfile();
    if (!current) return Response.json({ authenticated: false }, { status: 401 });
    return Response.json({ authenticated: true, email: current.identity.email, profile: toPublicProfile(current.profile) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Studio17 profile storage is temporarily unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Sign in is required." }, { status: 401 });
  let payload: { username?: unknown; displayName?: unknown; avatarUrl?: unknown; bio?: unknown };
  try { payload = await request.json(); } catch { return Response.json({ error: "A valid profile is required." }, { status: 400 }); }
  const username = String(payload.username || "").trim().toLowerCase();
  const displayName = String(payload.displayName || "").trim();
  const bio = String(payload.bio || "").trim();
  const avatarValue = String(payload.avatarUrl || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(username)) return Response.json({ error: "Username must be 3–30 characters using letters, numbers, _ or -." }, { status: 400 });
  if (!displayName || displayName.length > 60) return Response.json({ error: "Display name must be 1–60 characters." }, { status: 400 });
  if (bio.length > 280) return Response.json({ error: "Bio must be 280 characters or fewer." }, { status: 400 });
  let avatarUrl: string | null = null;
  if (avatarValue) {
    try {
      const parsed = new URL(avatarValue);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      avatarUrl = parsed.toString();
    } catch { return Response.json({ error: "Avatar must be a valid http(s) image URL." }, { status: 400 }); }
  }
  try {
    await ensureUserProfile(identity);
    await getDb().update(users).set({ username, displayName, avatarUrl, bio, updatedAt: Date.now() }).where(eq(users.email, identity.email.toLowerCase()));
    const updated = (await getDb().select().from(users).where(eq(users.email, identity.email.toLowerCase()))).at(0)!;
    return Response.json({ profile: toPublicProfile(updated) });
  } catch (error) {
    const message = String(error).toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) return Response.json({ error: "That username is already taken." }, { status: 409 });
    return Response.json({ error: "Could not update your Studio17 profile." }, { status: 503 });
  }
}

