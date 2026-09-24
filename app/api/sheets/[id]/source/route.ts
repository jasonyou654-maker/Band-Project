import { getChatGPTUser } from "@/app/chatgpt-auth";
import { privateTranscriptionStore } from "@/app/lib/private-transcription-storage";
import { getDb } from "@/db";
import { sheets } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

function contentType(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "xml" || extension === "musicxml") return "application/vnd.recordare.musicxml+xml";
  return "application/octet-stream";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params; const id = Number(rawId);
  if (!Number.isSafeInteger(id)) return Response.json({ error: "Invalid score ID." }, { status: 400 });
  const identity = await getChatGPTUser();
  const row = (await getDb().select().from(sheets).where(and(eq(sheets.id, id), isNull(sheets.deletedAt)))).at(0);
  if (!row || !row.sourceObjectKey || (row.visibility !== "public" && row.ownerEmail !== identity?.email.toLowerCase())) return Response.json({ error: "Source file not found." }, { status: 404 });
  const object = await privateTranscriptionStore().get(row.sourceObjectKey);
  if (!object) return Response.json({ error: "Source file not found." }, { status: 404 });
  const filename = row.sourceObjectKey.split("/").at(-1) || `score-${row.id}`;
  return new Response(await object.arrayBuffer(), { headers: { "Content-Type": contentType(row.sourceObjectKey), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": row.visibility === "public" ? "public, max-age=3600" : "private, no-store" } });
}
