import { getDb } from "@/db";
import { transcriptionJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePrivateTranscriptionUser } from "@/app/lib/transcription-access";
import { privateObjectKey, privateTranscriptionStore } from "@/app/lib/private-transcription-storage";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const ALLOWED_SUFFIXES = new Set(["wav", "mp3", "m4a", "ogg", "flac"]);
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function createPrivateJob(request: Request): Promise<Response> {
  let user;
  try { user = await requirePrivateTranscriptionUser(); } catch (error) { return error instanceof Response ? error : Response.json({ error: "Unable to verify identity." }, { status: 500 }); }
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "An audio file is required." }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES) return Response.json({ error: "Audio files must be 50 MB or smaller." }, { status: 413 });
  const suffix = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_SUFFIXES.has(suffix)) return Response.json({ error: "Use WAV, MP3, M4A, OGG, or FLAC audio." }, { status: 415 });
  const targetInstrument = String(form.get("target_instrument") || "auto");
  const sourceType = ["isolated", "mix"].includes(String(form.get("source_type"))) ? String(form.get("source_type")) : "unknown";
  const strictRhythm = String(form.get("strict_rhythm") || "false") === "true";
  const id = crypto.randomUUID(); const now = Date.now(); const sourceObjectKey = privateObjectKey(user.email, id, `source.${suffix}`);
  try {
    await privateTranscriptionStore().put(sourceObjectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    await getDb().insert(transcriptionJobs).values({ id, ownerEmail: user.email, status: "queued", stage: "queued", filename: file.name, targetInstrument, sourceType, strictRhythm: strictRhythm ? 1 : 0, sourceObjectKey, createdAt: now, updatedAt: now, expiresAt: now + EXPIRY_MS });
  } catch { return Response.json({ error: "Private storage is temporarily unavailable." }, { status: 503 }); }
  const processor = process.env.MUSIC_PROCESSOR_URL;
  if (!processor) return Response.json({ id, status: "queued", stage: "queued", warning: "Audio was saved privately; the processing service is not configured yet." }, { status: 202 });
  try {
    const processorForm = new FormData(); processorForm.append("file", file, file.name); processorForm.append("target_instrument", targetInstrument); processorForm.append("source_type", sourceType); processorForm.append("strict_rhythm", String(strictRhythm));
    const response = await fetch(`${processor.replace(/\/$/, "")}/transcribe/jobs`, { method: "POST", body: processorForm, signal: AbortSignal.timeout(30_000) });
    const payload = await response.json() as { jobId?: string; error?: string };
    if (!response.ok || !payload.jobId) throw new Error(payload.error || "Processor did not accept the task.");
    await getDb().update(transcriptionJobs).set({ remoteJobId: payload.jobId, status: "processing", stage: "queued", updatedAt: Date.now() }).where(eq(transcriptionJobs.id, id));
    return Response.json({ id, status: "processing", stage: "queued" }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processor dispatch failed.";
    await getDb().update(transcriptionJobs).set({ status: "failed", stage: "failed", error: message, updatedAt: Date.now() }).where(eq(transcriptionJobs.id, id));
    return Response.json({ id, status: "failed", stage: "failed", error: message }, { status: 502 });
  }
}
