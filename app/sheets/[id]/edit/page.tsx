import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { StudioHeader } from "@/app/components/StudioHeader";
import { publicSheet } from "@/app/lib/studio17-data";
import { getDb } from "@/db";
import { sheets } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import SheetEditor from "./sheet-editor";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";
export const dynamicParams = !isStaticExport;
export function generateStaticParams() { return []; }

export default async function EditScorePage({ params }: { params: Promise<{ id: string }> }) {
  if (isStaticExport) return <main className="s17-runtime-note"><h1>Score management requires the full Studio17 app.</h1></main>;
  const { id: rawId } = await params; const id = Number(rawId); if (!Number.isSafeInteger(id)) notFound();
  const identity = await requireChatGPTUser(`/sheets/${rawId}/edit`);
  const row = (await getDb().select().from(sheets).where(and(eq(sheets.id, id), isNull(sheets.deletedAt)))).at(0);
  if (!row || row.ownerEmail !== identity.email.toLowerCase()) notFound();
  return <><StudioHeader/><main className="s17-edit-page"><header><span>CONTENT MANAGEMENT</span><h1>Edit “{row.title}”</h1><p>Update discovery metadata, credits and visibility without replacing the score file.</p></header><SheetEditor sheet={await publicSheet(row, identity.email)}/></main></>;
}

