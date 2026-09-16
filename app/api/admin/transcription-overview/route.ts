import { requirePrivateTranscriptionUser } from "@/app/lib/transcription-access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requirePrivateTranscriptionUser();
    if (!user.isAdmin) return Response.json({ error: "Administrator access is required." }, { status: 403 });
    const [{ getDb }, { datasetAssets, transcriptionJobs }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    const [assets, jobs] = await Promise.all([getDb().select().from(datasetAssets), getDb().select().from(transcriptionJobs)]);
    return Response.json({ jobs: { total: jobs.length, processing: jobs.filter(job => ["queued", "processing"].includes(job.status)).length, completed: jobs.filter(job => job.status === "completed").length, failed: jobs.filter(job => job.status === "failed").length }, dataset: { total: assets.length, trainingConsented: assets.filter(asset => Boolean(asset.consentedForTraining)).length, bySplit: Object.fromEntries(["train", "validation", "test"].map(split => [split, assets.filter(asset => asset.split === split).length])) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof Response ? error : Response.json({ error: "Administrator overview is temporarily unavailable." }, { status: 503 }); }
}
