import { canAccessOwner, requirePrivateTranscriptionUser } from "@/app/lib/transcription-access";
import { privateObjectKey, privateTranscriptionStore } from "@/app/lib/private-transcription-storage";
import { getDb } from "@/db";
import { recentItems, scoreRevisions, transcriptionJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type ProcessorResult = { status?: string; stage?: string; error?: string; [key: string]: unknown };

async function restartLostProcessorJob(job: typeof transcriptionJobs.$inferSelect, processor: string): Promise<Response | null> {
  const storedAudio = await privateTranscriptionStore().get(job.sourceObjectKey);
  if (!storedAudio) return null;
  const form = new FormData();
  form.append("file", new Blob([await storedAudio.arrayBuffer()]), job.filename);
  form.append("target_instrument", job.targetInstrument);
  form.append("source_type", job.sourceType);
  form.append("strict_rhythm", String(Boolean(job.strictRhythm)));
  const response = await fetch(`${processor.replace(/\/$/, "")}/transcribe/jobs`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  const payload = await response.json() as { jobId?: string; error?: string };
  if (!response.ok || !payload.jobId) return null;
  await getDb().update(transcriptionJobs).set({ remoteJobId: payload.jobId, status: "processing", stage: "queued", error: null, updatedAt: Date.now() }).where(eq(transcriptionJobs.id, job.id));
  return Response.json({ ...publicJob(job), status: "processing", stage: "queued", warning: "The processing worker restarted, so the private audio was safely resubmitted." }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requirePrivateTranscriptionUser(); } catch (error) { return error instanceof Response ? error : Response.json({ error: "Unable to verify identity." }, { status: 500 }); }
  const { id } = await context.params;
  const job = (await getDb().select().from(transcriptionJobs).where(eq(transcriptionJobs.id, id))).at(0);
  if (!job) return Response.json({ error: "Transcription task not found." }, { status: 404 });
  if (!canAccessOwner(user, job.ownerEmail)) return Response.json({ error: "You may only view your own transcription tasks." }, { status: 403 });
  const viewedAt = Date.now();
  await getDb().insert(recentItems).values({ userEmail: user.email.toLowerCase(), itemType: "transcription", itemId: id, viewedAt })
    .onConflictDoUpdate({ target: [recentItems.userEmail, recentItems.itemType, recentItems.itemId], set: { viewedAt } });
  if (job.resultObjectKey) {
    const stored = await privateTranscriptionStore().get(job.resultObjectKey);
    if (stored) return Response.json(JSON.parse(await stored.text()), { headers: { "Cache-Control": "no-store" } });
  }
  if (!job.remoteJobId || job.status === "failed") return Response.json(publicJob(job), { headers: { "Cache-Control": "no-store" } });
  const processor = process.env.MUSIC_PROCESSOR_URL;
  if (!processor) return Response.json(publicJob(job), { headers: { "Cache-Control": "no-store" } });
  try {
    const response = await fetch(`${processor.replace(/\/$/, "")}/transcribe/jobs/${encodeURIComponent(job.remoteJobId)}`, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json() as ProcessorResult;
    if (response.status === 404) {
      const restarted = await restartLostProcessorJob(job, processor);
      if (restarted) return restarted;
    }
    if (!response.ok || payload.status === "failed") {
      const error = payload.error || "Transcription failed.";
      await getDb().update(transcriptionJobs).set({ status: "failed", stage: "failed", error, updatedAt: Date.now() }).where(eq(transcriptionJobs.id, id));
      return Response.json({ ...publicJob(job), status: "failed", stage: "failed", error });
    }
    if (payload.status !== "completed") {
      await getDb().update(transcriptionJobs).set({ status: String(payload.status || "processing"), stage: String(payload.stage || "processing"), updatedAt: Date.now() }).where(eq(transcriptionJobs.id, id));
      return Response.json({ ...publicJob(job), status: payload.status || "processing", stage: payload.stage || "processing" });
    }
    const resultObjectKey = privateObjectKey(job.ownerEmail, job.id, "result.json");
    const privateResult = { ...payload, id: job.id, owner: undefined };
    await privateTranscriptionStore().put(resultObjectKey, JSON.stringify(privateResult), { httpMetadata: { contentType: "application/json" } });
    await getDb().update(transcriptionJobs).set({ status: "completed", stage: "completed", resultObjectKey, updatedAt: Date.now() }).where(eq(transcriptionJobs.id, id));
    return Response.json(privateResult, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ...publicJob(job), warning: "The processor is still being checked; try again shortly." }, { headers: { "Cache-Control": "no-store" } });
  }
}

function publicJob(job: typeof transcriptionJobs.$inferSelect) {
  return { id: job.id, status: job.status, stage: job.stage, filename: job.filename, targetInstrument: job.targetInstrument, sourceType: job.sourceType, strictRhythm: Boolean(job.strictRhythm), error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt, expiresAt: job.expiresAt };
}

/** A deletion removes private audio, generated output, and every revision together. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requirePrivateTranscriptionUser(); } catch (error) { return error instanceof Response ? error : Response.json({ error: "Unable to verify identity." }, { status: 500 }); }
  const { id } = await context.params;
  try {
    const job = (await getDb().select().from(transcriptionJobs).where(eq(transcriptionJobs.id, id))).at(0);
    if (!job) return Response.json({ error: "Transcription task not found." }, { status: 404 });
    if (!canAccessOwner(user, job.ownerEmail)) return Response.json({ error: "You may only delete your own transcription tasks." }, { status: 403 });
    const keys = [job.sourceObjectKey, job.resultObjectKey].filter((key): key is string => Boolean(key));
    if (keys.length) await privateTranscriptionStore().delete(keys);
    await getDb().batch([
      getDb().delete(scoreRevisions).where(eq(scoreRevisions.jobId, id)),
      getDb().delete(recentItems).where(and(eq(recentItems.itemType, "transcription"), eq(recentItems.itemId, id))),
      getDb().delete(transcriptionJobs).where(eq(transcriptionJobs.id, id)),
    ]);
    return Response.json({ deleted: true, id });
  } catch { return Response.json({ error: "Could not delete this private transcription." }, { status: 503 }); }
}
