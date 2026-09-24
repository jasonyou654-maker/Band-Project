import { getDb } from "@/db";
import { favorites, sheets, users } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import type { StudioProfile, StudioSheet } from "./studio17-models";
import { initials } from "./studio17-models";

function usernameBase(user: ChatGPTUser): string {
  const local = user.email.split("@")[0] || "musician";
  const normalized = local.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22);
  return normalized.length >= 3 ? normalized : `musician-${normalized || "new"}`;
}

function usernameSuffix(email: string): string {
  let hash = 0;
  for (const character of email) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash.toString(36).slice(0, 5);
}

export async function ensureUserProfile(user: ChatGPTUser) {
  const db = getDb();
  const email = user.email.toLowerCase();
  const existing = (await db.select().from(users).where(eq(users.email, email))).at(0);
  if (existing) return existing;
  const now = Date.now();
  const base = usernameBase(user);
  const username = `${base}-${usernameSuffix(email)}`.slice(0, 30);
  await db.insert(users).values({
    email,
    username,
    displayName: user.fullName?.trim() || user.displayName || base,
    bio: "",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  return (await db.select().from(users).where(eq(users.email, email))).at(0)!;
}

export function toPublicProfile(row: typeof users.$inferSelect): StudioProfile {
  return { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl, bio: row.bio };
}

export function parseStringArray(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).map(item => item.trim()).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function parseTagsInput(value: unknown): string[] {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map(String).map(item => item.trim()).filter(Boolean).map(item => item.slice(0, 28)))].slice(0, 10);
}

export async function publicSheet(row: typeof sheets.$inferSelect, viewerEmail?: string | null): Promise<StudioSheet> {
  const db = getDb();
  const owner = row.ownerEmail
    ? (await db.select().from(users).where(eq(users.email, row.ownerEmail))).at(0)
    : null;
  const favoriteCount = Number((await db.select({ count: sql<number>`count(*)` }).from(favorites).where(eq(favorites.sheetId, row.id))).at(0)?.count || 0);
  const favorited = viewerEmail
    ? Boolean((await db.select().from(favorites).where(and(eq(favorites.userEmail, viewerEmail.toLowerCase()), eq(favorites.sheetId, row.id)))).at(0))
    : false;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    instrument: row.instrument,
    arrangement: row.arrangement,
    genre: row.genre,
    difficulty: row.difficulty,
    key: row.musicalKey,
    bpm: row.bpm,
    tags: parseStringArray(row.tags),
    description: row.description,
    rightsDeclaration: row.rightsDeclaration,
    uploader: owner?.displayName || row.uploader,
    uploaderUsername: owner?.username || null,
    avatar: owner ? initials(owner.displayName) : row.avatar,
    avatarUrl: owner?.avatarUrl || null,
    accent: row.accent,
    musicXml: row.musicXml,
    processingMode: row.processingMode,
    processingProvider: row.processingProvider,
    processingWarnings: parseStringArray(row.processingWarnings),
    hasSourceFile: Boolean(row.sourceObjectKey),
    downloads: row.downloads,
    favorites: favoriteCount,
    isFavorited: favorited,
    isOwner: Boolean(viewerEmail && row.ownerEmail === viewerEmail.toLowerCase()),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
  };
}
