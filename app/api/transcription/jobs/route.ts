import { canAccessOwner, requirePrivateTranscriptionUser } from "@/app/lib/transcription-access";
import { createPrivateJob } from "./create";

export const dynamic = "force-dynamic";

function authFailure(error: unknown): Response | null {
  return error instanceof Response ? error : null;
}

/** Lists only the caller's own private transcription history. Administrators may filter by owner. */
export async function GET(request: Request) {
  let user;
  try {
    user = await requirePrivateTranscriptionUser();
  } catch (error) {
    return authFailure(error) || Response.json({ error: "Unable to verify identity." }, { status: 500 });
  }
  const requestedOwner = new URL(request.url).searchParams.get("owner")?.trim().toLowerCase();
  if (requestedOwner && !canAccessOwner(user, requestedOwner)) return Response.json({ error: "You may only view your own transcription history." }, { status: 403 });
  const ownerEmail = requestedOwner || user.email;
  try {
    const [{ getDb }, { transcriptionJobs }, { desc, eq }] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
    const jobs = await getDb().select().from(transcriptionJobs).where(eq(transcriptionJobs.ownerEmail, ownerEmail)).orderBy(desc(transcriptionJobs.createdAt));
    return Response.json({ jobs: jobs.map(job => ({ id: job.id, status: job.status, stage: job.stage, filename: job.filename, targetInstrument: job.targetInstrument, sourceType: job.sourceType, strictRhythm: Boolean(job.strictRhythm), error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt, expiresAt: job.expiresAt })), scope: user.isAdmin && requestedOwner ? "admin" : "private" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Private transcription history is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  return createPrivateJob(request);
}
