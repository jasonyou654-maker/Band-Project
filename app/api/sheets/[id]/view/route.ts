import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { recentItems } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getChatGPTUser();
  if (!identity) return new Response(null, { status: 204 });
  const { id } = await context.params;
  if (!Number.isSafeInteger(Number(id))) return Response.json({ error: "Invalid score ID." }, { status: 400 });
  await getDb().insert(recentItems).values({ userEmail: identity.email.toLowerCase(), itemType: "sheet", itemId: id, viewedAt: Date.now() })
    .onConflictDoUpdate({ target: [recentItems.userEmail, recentItems.itemType, recentItems.itemId], set: { viewedAt: Date.now() } });
  return new Response(null, { status: 204 });
}

