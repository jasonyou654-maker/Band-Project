import Link from "next/link";
import { notFound } from "next/navigation";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { StudioHeader } from "@/app/components/StudioHeader";
import { StudioAvatar } from "@/app/components/StudioAvatar";
import { NotationRenderer } from "@/app/components/NotationRenderer";
import { publicSheet } from "@/app/lib/studio17-data";
import { getDb } from "@/db";
import { sheets } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import SheetActions from "./sheet-actions";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";
export const dynamicParams = !isStaticExport;
export function generateStaticParams() { return []; }

export default async function IndependentSheetPage({ params }: { params: Promise<{ id: string }> }) {
  if (isStaticExport) return <main className="s17-runtime-note"><h1>Open this score in the full Studio17 app.</h1></main>;
  const { id: rawId } = await params; const id = Number(rawId); if (!Number.isSafeInteger(id)) notFound();
  const identity = await getChatGPTUser();
  const row = (await getDb().select().from(sheets).where(and(eq(sheets.id, id), isNull(sheets.deletedAt)))).at(0);
  if (!row || (row.visibility !== "public" && row.ownerEmail !== identity?.email.toLowerCase())) notFound();
  const sheet = await publicSheet(row, identity?.email);
  return <><StudioHeader/><main className="s17-detail-page">
    <div className="s17-detail-breadcrumb"><Link href="/">Explore</Link><span>/</span><span>{sheet.title}</span></div>
    <header className="s17-detail-heading"><div><span>{sheet.genre || "Score"} · {sheet.instrument}</span><h1>{sheet.title}</h1><p>{sheet.artist}</p></div><SheetActions sheet={sheet} authenticated={Boolean(identity)}/></header>
    <div className="s17-detail-layout">
      <section className="s17-score-panel">
        <div className="s17-score-toolbar"><span>{sheet.musicXml ? "MusicXML score" : "Original uploaded score"}</span><em>{sheet.processingProvider}</em></div>
        {sheet.musicXml ? <div className="s17-score-canvas"><NotationRenderer title={sheet.title} musicXml={sheet.musicXml}/></div> : sheet.hasSourceFile ? <iframe className="s17-source-frame" src={`/api/sheets/${sheet.id}/source`} title={`${sheet.title} original score`}/> : <div className="s17-score-empty">This legacy entry does not include a stored score file.</div>}
      </section>
      <aside className="s17-detail-aside">
        <div className="s17-tag-row">{sheet.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        <dl><div><dt>Instrument</dt><dd>{sheet.instrument}</dd></div><div><dt>Arrangement</dt><dd>{sheet.arrangement}</dd></div><div><dt>Difficulty</dt><dd>{sheet.difficulty}</dd></div><div><dt>Key / tempo</dt><dd>{sheet.key} · {sheet.bpm} BPM</dd></div></dl>
        <section><h2>About this arrangement</h2><p>{sheet.description || "The uploader has not added a description yet."}</p></section>
        <section className="s17-rights"><h2>Source & rights</h2><p>{sheet.rightsDeclaration}</p></section>
        <section className="s17-uploader-card"><StudioAvatar name={sheet.uploader} src={sheet.avatarUrl} size="medium"/><div><span>Uploaded by</span>{sheet.uploaderUsername ? <Link href={`/users/${sheet.uploaderUsername}`}>{sheet.uploader}</Link> : <b>{sheet.uploader}</b>}<small>{new Date(sheet.createdAt).toLocaleDateString()}</small></div></section>
        <div className="s17-detail-stats"><span><b>{sheet.downloads}</b> downloads</span><span><b>{sheet.favorites}</b> saves</span></div>
        {sheet.isOwner && <Link className="s17-owner-edit" href={`/sheets/${sheet.id}/edit`}>Edit score details</Link>}
      </aside>
    </div>
  </main></>;
}
