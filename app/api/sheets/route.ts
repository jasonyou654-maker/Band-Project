import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureUserProfile, parseTagsInput, publicSheet } from "@/app/lib/studio17-data";
import { isMusicXml } from "@/app/lib/musicxml";
import { getDb } from "@/db";
import { sheets } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

type SheetPayload = {
  title?: unknown; artist?: unknown; instrument?: unknown; arrangement?: unknown;
  genre?: unknown; difficulty?: unknown; key?: unknown; bpm?: unknown; tags?: unknown;
  description?: unknown; rightsDeclaration?: unknown; accent?: unknown; musicXml?: unknown;
  processingMode?: unknown; processingProvider?: unknown; processingWarnings?: unknown;
  sourceObjectKey?: unknown; visibility?: unknown;
};

function text(value: unknown, maximum = 200): string { return String(value || "").trim().slice(0, maximum); }

export async function GET() {
  try {
    const identity = await getChatGPTUser();
    const rows = await getDb().select().from(sheets)
      .where(and(eq(sheets.visibility, "public"), isNull(sheets.deletedAt)))
      .orderBy(desc(sheets.createdAt));
    return Response.json({
      sheets: await Promise.all(rows.map(row => publicSheet(row, identity?.email))),
      storage: "d1",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ sheets: [], storage: "browser-fallback" });
  }
}

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Sign in to publish a score." }, { status: 401 });
  let payload: SheetPayload;
  try { payload = await request.json(); } catch { return Response.json({ error: "A valid score payload is required." }, { status: 400 }); }
  const title = text(payload.title, 120);
  const artist = text(payload.artist, 120);
  const instrument = text(payload.instrument, 80);
  const arrangement = text(payload.arrangement, 120) || instrument;
  const genre = text(payload.genre, 80) || "Other";
  const difficulty = text(payload.difficulty, 40);
  const musicalKey = text(payload.key, 40) || "Not specified";
  const description = text(payload.description, 2000);
  const rightsDeclaration = text(payload.rightsDeclaration, 500);
  const musicXml = String(payload.musicXml || "");
  const sourceObjectKey = text(payload.sourceObjectKey, 500) || null;
  const ownerPrefix = `score-assets/${encodeURIComponent(identity.email.toLowerCase())}/`;
  if (!title || !artist || !instrument || !difficulty) return Response.json({ error: "Title, artist, instrument/arrangement, and difficulty are required." }, { status: 400 });
  if (!rightsDeclaration) return Response.json({ error: "A source and copyright declaration is required." }, { status: 400 });
  if (!sourceObjectKey && !isMusicXml(musicXml)) return Response.json({ error: "Upload a score file or valid MusicXML." }, { status: 400 });
  if (sourceObjectKey && !sourceObjectKey.startsWith(ownerPrefix)) return Response.json({ error: "The uploaded source file does not belong to this account." }, { status: 403 });
  if (musicXml && !isMusicXml(musicXml)) return Response.json({ error: "The generated notation is not valid MusicXML." }, { status: 400 });
  const profile = await ensureUserProfile(identity);
  const now = Date.now();
  const id = now;
  const bpmValue = Number(payload.bpm);
  const warnings = Array.isArray(payload.processingWarnings) ? payload.processingWarnings.map(String).slice(0, 20) : [];
  try {
    await getDb().insert(sheets).values({
      id, title, artist, instrument, arrangement, genre, difficulty, musicalKey,
      bpm: Number.isFinite(bpmValue) ? Math.max(1, Math.min(400, Math.round(bpmValue))) : 96,
      uploader: profile.displayName,
      avatar: profile.displayName.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "S17",
      accent: text(payload.accent, 20) || "#6e5ae6",
      musicXml,
      processingMode: text(payload.processingMode, 30) || "real",
      processingProvider: text(payload.processingProvider, 120) || "Direct score upload",
      processingWarnings: JSON.stringify(warnings),
      sourceObjectKey,
      ownerEmail: identity.email.toLowerCase(),
      tags: JSON.stringify(parseTagsInput(payload.tags)),
      description,
      rightsDeclaration,
      visibility: payload.visibility === "private" ? "private" : "public",
      downloads: 0,
      createdAt: now,
      updatedAt: now,
    });
    const row = (await getDb().select().from(sheets).where(eq(sheets.id, id))).at(0)!;
    return Response.json({ sheet: await publicSheet(row, identity.email), persisted: true, storage: "d1" }, { status: 201 });
  } catch {
    return Response.json({ error: "Studio17 could not publish this score." }, { status: 503 });
  }
}
