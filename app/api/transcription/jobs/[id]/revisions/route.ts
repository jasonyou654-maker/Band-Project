import { canAccessOwner, requirePrivateTranscriptionUser } from "@/app/lib/transcription-access";
import { getDb } from "@/db";
import { scoreRevisions, transcriptionJobs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function authorizedJob(id: string) {
  const user = await requirePrivateTranscriptionUser();
  const job = (await getDb().select().from(transcriptionJobs).where(eq(transcriptionJobs.id, id))).at(0);
  if (!job) throw new Response("Transcription task not found.", { status: 404 });
  if (!canAccessOwner(user, job.ownerEmail)) throw new Response("You may only access your own score revisions.", { status: 403 });
  return { user, job };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; await authorizedJob(id);
    const revisions = await getDb().select().from(scoreRevisions).where(eq(scoreRevisions.jobId, id)).orderBy(desc(scoreRevisions.revision));
    return Response.json({ revisions: revisions.map(revision => ({ id: revision.id, revision: revision.revision, operations: JSON.parse(revision.operations), consentedForTraining: Boolean(revision.consentedForTraining), createdAt: revision.createdAt })) });
  } catch (error) { return error instanceof Response ? error : Response.json({ error: "Private revisions are temporarily unavailable." }, { status: 503 }); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { user } = await authorizedJob(id);
    const payload = await request.json() as { operations?: unknown; consentedForTraining?: unknown };
    if (!Array.isArray(payload.operations) || payload.operations.length === 0 || payload.operations.length > 200) return Response.json({ error: "Submit between 1 and 200 score-edit operations." }, { status: 400 });
    const latest = (await getDb().select().from(scoreRevisions).where(eq(scoreRevisions.jobId, id)).orderBy(desc(scoreRevisions.revision))).at(0);
    const revision = (latest?.revision || 0) + 1; const createdAt = Date.now(); const revisionId = crypto.randomUUID();
    await getDb().insert(scoreRevisions).values({ id: revisionId, ownerEmail: user.email, jobId: id, revision, operations: JSON.stringify(payload.operations), consentedForTraining: payload.consentedForTraining === true ? 1 : 0, createdAt });
    return Response.json({ id: revisionId, revision, consentedForTraining: payload.consentedForTraining === true, createdAt }, { status: 201 });
  } catch (error) { return error instanceof Response ? error : Response.json({ error: "Could not save this private revision." }, { status: 503 }); }
}
