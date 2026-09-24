import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { favorites, sheets } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function contextFor(rawId: string) {
  const identity = await getChatGPTUser();
  if (!identity) return { error: Response.json({ error: "Sign in to save scores." }, { status: 401 }) };
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) return { error: Response.json({ error: "Invalid score ID." }, { status: 400 }) };
  const score = (await getDb().select().from(sheets).where(and(eq(sheets.id, id), isNull(sheets.deletedAt)))).at(0);
  if (!score || (score.visibility !== "public" && score.ownerEmail !== identity.email.toLowerCase())) return { error: Response.json({ error: "Score not found." }, { status: 404 }) };
  return { identity, id };
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params; const result = await contextFor(rawId); if (result.error) return result.error;
  await getDb().insert(favorites).values({ userEmail: result.identity!.email.toLowerCase(), sheetId: result.id!, createdAt: Date.now() }).onConflictDoNothing();
  return Response.json({ favorited: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params; const result = await contextFor(rawId); if (result.error) return result.error;
  await getDb().delete(favorites).where(and(eq(favorites.userEmail, result.identity!.email.toLowerCase()), eq(favorites.sheetId, result.id!)));
  return Response.json({ favorited: false });
}

