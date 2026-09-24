"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { StudioProfile, StudioSheet } from "@/app/lib/studio17-models";
import { StudioAvatar } from "@/app/components/StudioAvatar";
import { StudioSheetCard } from "@/app/components/StudioSheetCard";

type Transcription = { id: string; filename: string; targetInstrument: string; status: string; stage: string; createdAt: number; updatedAt: number; error?: string | null };
type LibraryPayload = { profile: StudioProfile; uploads: StudioSheet[]; favorites: StudioSheet[]; transcriptions: Transcription[]; recent: Array<{ type: "sheet"; viewedAt: number; sheet: StudioSheet } | { type: "transcription"; viewedAt: number; transcription: Transcription | null }>; error?: string };

function Empty({ title, copy, action, href }: { title: string; copy: string; action: string; href: string }) {
  return <div className="s17-empty"><span>♪</span><h3>{title}</h3><p>{copy}</p><Link href={href}>{action}</Link></div>;
}

export default function LibraryView() {
  const [data, setData] = useState<LibraryPayload | null>(null); const [error, setError] = useState("");
  useEffect(() => { fetch("/api/library", { cache: "no-store" }).then(async response => { const payload = await response.json() as LibraryPayload; if (!response.ok) throw new Error(payload.error || "Could not load My Library."); setData(payload); }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load My Library.")); }, []);
  if (error) return <main className="s17-library"><div className="s17-error">{error}</div></main>;
  if (!data) return <main className="s17-library"><div className="s17-loading">Building your library…</div></main>;
  return <main className="s17-library">
    <header className="s17-library-hero"><div><span>YOUR STUDIO</span><h1>My Library</h1><p>Uploads, transcription drafts, saved scores and the music you recently opened.</p></div><Link className="s17-primary" href="/upload">Upload a score</Link></header>
    <section className="s17-library-profile"><StudioAvatar name={data.profile.displayName} src={data.profile.avatarUrl} size="large"/><div><h2>{data.profile.displayName}</h2><p>@{data.profile.username}</p><span>{data.profile.bio || "Add a short bio so other musicians know what you play."}</span></div><Link href="/account">Edit profile</Link></section>
    <section className="s17-library-section"><div className="s17-section-heading"><div><span>CREATED BY YOU</span><h2>Uploaded scores</h2></div><b>{data.uploads.length}</b></div>{data.uploads.length ? <div className="s17-card-grid">{data.uploads.map(sheet => <StudioSheetCard key={sheet.id} sheet={sheet}/>)}</div> : <Empty title="No uploads yet" copy="Publish your first arrangement with structured credits and metadata." action="Upload a score" href="/upload"/>}</section>
    <section className="s17-library-section"><div className="s17-section-heading"><div><span>PRIVATE WORK</span><h2>AI transcription drafts</h2></div><b>{data.transcriptions.length}</b></div>{data.transcriptions.length ? <div className="s17-transcription-list">{data.transcriptions.map(item => <Link href={`/transcription/${item.id}`} key={item.id}><span className={`s17-status ${item.status}`}>{item.status}</span><div><b>{item.filename}</b><small>{item.targetInstrument} · {new Date(item.updatedAt).toLocaleDateString()}</small></div><em>Open draft →</em></Link>)}</div> : <Empty title="No transcription drafts" copy="Existing AI transcription remains available as a private Studio17 tool." action="Open AI Transcription" href="/transcription"/>}</section>
    <section className="s17-library-section"><div className="s17-section-heading"><div><span>KEEP CLOSE</span><h2>Saved scores</h2></div><b>{data.favorites.length}</b></div>{data.favorites.length ? <div className="s17-card-grid">{data.favorites.map(sheet => <StudioSheetCard key={sheet.id} sheet={sheet}/>)}</div> : <Empty title="Nothing saved yet" copy="Save a score from its detail page and it will stay here." action="Explore scores" href="/"/>}</section>
    <section className="s17-library-section"><div className="s17-section-heading"><div><span>PICK UP WHERE YOU LEFT OFF</span><h2>Recently viewed</h2></div><b>{data.recent.length}</b></div>{data.recent.length ? <div className="s17-recent-list">{data.recent.map((item, index) => item.type === "sheet" ? <Link key={`sheet-${item.sheet.id}-${index}`} href={`/sheets/${item.sheet.id}`}><span>Score</span><b>{item.sheet.title}</b><small>{item.sheet.artist}</small></Link> : item.transcription ? <Link key={`transcription-${item.transcription.id}-${index}`} href={`/transcription/${item.transcription.id}`}><span>AI draft</span><b>{item.transcription.filename}</b><small>{item.transcription.status}</small></Link> : null)}</div> : <Empty title="No recent activity" copy="Scores and private drafts you open will appear here." action="Explore Studio17" href="/"/>}</section>
  </main>;
}

