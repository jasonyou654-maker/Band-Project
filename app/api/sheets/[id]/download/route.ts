import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { recentItems, sheets } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params; const id = Number(rawId);
  if (!Number.isSafeInteger(id)) return Response.json({ error: "Invalid score ID." }, { status: 400 });
  const identity = await getChatGPTUser();
  const row = (await getDb().select({ visibility: sheets.visibility, ownerEmail: sheets.ownerEmail }).from(sheets).where(and(eq(sheets.id, id), isNull(sheets.deletedAt)))).at(0);
  if (!row || (row.visibility !== "public" && row.ownerEmail !== identity?.email.toLowerCase())) return Response.json({ error: "Score not found." }, { status: 404 });
  await getDb().update(sheets).set({ downloads: sql`${sheets.downloads} + 1` }).where(eq(sheets.id, id));
  if (identity) await getDb().insert(recentItems).values({ userEmail: identity.email.toLowerCase(), itemType: "sheet", itemId: rawId, viewedAt: Date.now() })
    .onConflictDoUpdate({ target: [recentItems.userEmail, recentItems.itemType, recentItems.itemId], set: { viewedAt: Date.now() } });
  return Response.json({ recorded: true });
}
