import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureUserProfile, publicSheet, toPublicProfile } from "@/app/lib/studio17-data";
import { getDb } from "@/db";
import { favorites, recentItems, sheets, transcriptionJobs } from "@/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const email = identity.email.toLowerCase();
    const profile = await ensureUserProfile(identity);
    const db = getDb();
    const [uploadsRows, favoriteRows, recentRows, jobs] = await Promise.all([
      db.select().from(sheets).where(and(eq(sheets.ownerEmail, email), isNull(sheets.deletedAt))).orderBy(desc(sheets.updatedAt)),
      db.select().from(favorites).where(eq(favorites.userEmail, email)).orderBy(desc(favorites.createdAt)),
      db.select().from(recentItems).where(eq(recentItems.userEmail, email)).orderBy(desc(recentItems.viewedAt)).limit(20),
      db.select().from(transcriptionJobs).where(eq(transcriptionJobs.ownerEmail, email)).orderBy(desc(transcriptionJobs.updatedAt)).limit(50),
    ]);
    const favoriteIds = favoriteRows.map(row => row.sheetId);
    const recentSheetIds = recentRows.filter(row => row.itemType === "sheet").map(row => Number(row.itemId)).filter(Number.isSafeInteger);
    const favoriteSheetRows = favoriteIds.length ? await db.select().from(sheets).where(and(inArray(sheets.id, favoriteIds), isNull(sheets.deletedAt))) : [];
    const recentSheetRows = recentSheetIds.length ? await db.select().from(sheets).where(and(inArray(sheets.id, recentSheetIds), isNull(sheets.deletedAt))) : [];
    const favoriteById = new Map(favoriteSheetRows.map(row => [row.id, row]));
    const recentById = new Map(recentSheetRows.map(row => [row.id, row]));
    const recent = (await Promise.all(recentRows.map(async item => item.itemType === "sheet" && recentById.has(Number(item.itemId))
      ? { type: "sheet", viewedAt: item.viewedAt, sheet: await publicSheet(recentById.get(Number(item.itemId))!, email) }
      : item.itemType === "transcription"
        ? { type: "transcription", viewedAt: item.viewedAt, transcription: jobs.find(job => job.id === item.itemId) || null }
        : null))).filter(Boolean);
    return Response.json({
      profile: toPublicProfile(profile),
      uploads: await Promise.all(uploadsRows.map(row => publicSheet(row, email))),
      favorites: await Promise.all(favoriteIds.map(id => favoriteById.get(id)).filter(Boolean).map(row => publicSheet(row!, email))),
      transcriptions: jobs.map(job => ({ id: job.id, filename: job.filename, targetInstrument: job.targetInstrument, status: job.status, stage: job.stage, createdAt: job.createdAt, updatedAt: job.updatedAt, error: job.error })),
      recent,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "My Library is temporarily unavailable." }, { status: 503 });
  }
}
