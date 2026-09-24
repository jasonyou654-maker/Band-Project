import { getChatGPTUser } from "@/app/chatgpt-auth";
import { parseTagsInput, publicSheet } from "@/app/lib/studio17-data";
import { privateTranscriptionStore } from "@/app/lib/private-transcription-storage";
import { getDb } from "@/db";
import { favorites, recentItems, sheets, contentReports } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

function sheetId(value: string): number | null { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function text(value: unknown, maximum = 200): string { return String(value || "").trim().slice(0, maximum); }

async function findSheet(id: number) {
  return (await getDb().select().from(sheets).where(and(eq(sheets.id, id), isNull(sheets.deletedAt)))).at(0);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = sheetId(rawId);
  if (!id) return Response.json({ error: "Invalid score ID." }, { status: 400 });
  try {
    const identity = await getChatGPTUser();
    const row = await findSheet(id);
    if (!row || (row.visibility !== "public" && row.ownerEmail !== identity?.email.toLowerCase())) return Response.json({ error: "Score not found." }, { status: 404 });
    return Response.json({ sheet: await publicSheet(row, identity?.email) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Score details are temporarily unavailable." }, { status: 503 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = sheetId(rawId);
  if (!id) return Response.json({ error: "Invalid score ID." }, { status: 400 });
  const row = await findSheet(id);
  if (!row) return Response.json({ error: "Score not found." }, { status: 404 });
  if (row.ownerEmail !== identity.email.toLowerCase()) return Response.json({ error: "Only the uploader can edit this score." }, { status: 403 });
  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return Response.json({ error: "A valid update is required." }, { status: 400 }); }
  const update = {
    title: text(payload.title, 120), artist: text(payload.artist, 120), instrument: text(payload.instrument, 80),
    arrangement: text(payload.arrangement, 120), genre: text(payload.genre, 80), difficulty: text(payload.difficulty, 40),
    musicalKey: text(payload.key, 40) || "Not specified", description: text(payload.description, 2000),
    rightsDeclaration: text(payload.rightsDeclaration, 500), tags: JSON.stringify(parseTagsInput(payload.tags)),
    visibility: payload.visibility === "private" ? "private" : "public",
    bpm: Math.max(1, Math.min(400, Math.round(Number(payload.bpm) || row.bpm))), updatedAt: Date.now(),
  };
  if (!update.title || !update.artist || !update.instrument || !update.arrangement || !update.difficulty || !update.rightsDeclaration) return Response.json({ error: "Complete all required metadata and the rights declaration." }, { status: 400 });
  await getDb().update(sheets).set(update).where(eq(sheets.id, id));
  const updated = await findSheet(id);
  return Response.json({ sheet: await publicSheet(updated!, identity.email) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = sheetId(rawId);
  if (!id) return Response.json({ error: "Invalid score ID." }, { status: 400 });
  const row = await findSheet(id);
  if (!row) return Response.json({ error: "Score not found." }, { status: 404 });
  if (row.ownerEmail !== identity.email.toLowerCase()) return Response.json({ error: "Only the uploader can delete this score." }, { status: 403 });
  if (row.sourceObjectKey) await privateTranscriptionStore().delete(row.sourceObjectKey).catch(() => undefined);
  await getDb().batch([
    getDb().delete(favorites).where(eq(favorites.sheetId, id)),
    getDb().delete(recentItems).where(and(eq(recentItems.itemType, "sheet"), eq(recentItems.itemId, String(id)))),
    getDb().delete(contentReports).where(eq(contentReports.sheetId, id)),
    getDb().update(sheets).set({ deletedAt: Date.now(), visibility: "private", updatedAt: Date.now() }).where(eq(sheets.id, id)),
  ]);
  return Response.json({ deleted: true });
}

