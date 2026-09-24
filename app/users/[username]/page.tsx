import { notFound } from "next/navigation";
import { StudioHeader } from "@/app/components/StudioHeader";
import { StudioAvatar } from "@/app/components/StudioAvatar";
import { StudioSheetCard } from "@/app/components/StudioSheetCard";
import { publicSheet, toPublicProfile } from "@/app/lib/studio17-data";
import { getDb } from "@/db";
import { sheets, users } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";
export const dynamicParams = !isStaticExport;
export function generateStaticParams() { return []; }

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  if (isStaticExport) return <main className="s17-runtime-note"><h1>Profiles are available in the full Studio17 app.</h1></main>;
  const { username } = await params;
  const row = (await getDb().select().from(users).where(eq(users.username, username.toLowerCase()))).at(0);
  if (!row) notFound();
  const profile = toPublicProfile(row);
  const uploads = await getDb().select().from(sheets).where(and(eq(sheets.ownerEmail, row.email), eq(sheets.visibility, "public"), isNull(sheets.deletedAt))).orderBy(desc(sheets.createdAt));
  const publicUploads = await Promise.all(uploads.map(sheet => publicSheet(sheet)));
  return <><StudioHeader/><main className="s17-public-profile">
    <header><StudioAvatar name={profile.displayName} src={profile.avatarUrl} size="large"/><div><span>STUDIO17 CREATOR</span><h1>{profile.displayName}</h1><p>@{profile.username}</p></div></header>
    <p className="s17-public-bio">{profile.bio || "This musician has not added a bio yet."}</p>
    <section className="s17-library-section"><div className="s17-section-heading"><div><span>PUBLIC SCORES</span><h2>Arrangements by {profile.displayName}</h2></div><b>{publicUploads.length}</b></div>{publicUploads.length ? <div className="s17-card-grid">{publicUploads.map(sheet => <StudioSheetCard key={sheet.id} sheet={sheet}/>)}</div> : <div className="s17-empty"><span>♪</span><h3>No public uploads yet</h3></div>}</section>
  </main></>;
}

