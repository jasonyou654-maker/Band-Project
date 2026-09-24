import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { contentReports, sheets } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Sign in to report content." }, { status: 401 });
  let payload: { sheetId?: unknown; reason?: unknown; details?: unknown };
  try { payload = await request.json(); } catch { return Response.json({ error: "A valid report is required." }, { status: 400 }); }
  const sheetId = Number(payload.sheetId); const reason = String(payload.reason || "").trim(); const details = String(payload.details || "").trim().slice(0, 1000);
  if (!Number.isSafeInteger(sheetId) || !reason || reason.length > 80) return Response.json({ error: "Choose a report reason." }, { status: 400 });
  const score = (await getDb().select().from(sheets).where(and(eq(sheets.id, sheetId), isNull(sheets.deletedAt)))).at(0);
  if (!score || (score.visibility !== "public" && score.ownerEmail !== identity.email.toLowerCase())) return Response.json({ error: "Score not found." }, { status: 404 });
  await getDb().insert(contentReports).values({ id: crypto.randomUUID(), reporterEmail: identity.email.toLowerCase(), sheetId, reason, details, status: "open", createdAt: Date.now() });
  return Response.json({ reported: true }, { status: 201 });
}
