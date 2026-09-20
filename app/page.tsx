"use client";
/* The source preview intentionally uses a native img element for object URLs. */
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { isMusicXml } from "./lib/musicxml";
import { NotationRenderer } from "./components/NotationRenderer";
import type { MusicProcessingResult } from "./lib/providers/types";
import { formatFileSize, isDirectMusicXml, SCORE_ACCEPT, scoreFileKind, validateScoreFile } from "./lib/omr-client";
import { transcribeAudio } from "./lib/transcription-client";

const isStaticSite = process.env.NEXT_PUBLIC_STATIC_SITE === "true";

type View = "explore" | "sheet" | "upload" | "analysis" | "profile";
type Sheet = {
  id: number; title: string; artist: string; instrument: string; difficulty: string;
  key: string; bpm: number; genre: string; uploader: string; avatar: string;
  likes: number; saves: number; downloads: number; accent: string; featured?: boolean;
  musicXml?: string; processingMode?: "real" | "fallback"; processingProvider?: string; processingWarnings?: string[];
  sourcePreviewUrl?: string; sourceDataUrl?: string; sourceFileName?: string; sourceMimeType?: string;
};
type Activity = { id: number; text: string; time: string; unread: boolean };

function readStoredIds(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}

// Base64 expands a file by roughly one third. Keep this safely below the
// browser-storage quota so a refresh does not turn a recently uploaded score
// into an unavailable preview.
const MAX_PERSISTED_SOURCE_BYTES = 2 * 1024 * 1024;

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取原始文件。"));
    reader.onerror = () => reject(reader.error || new Error("无法读取原始文件。"));
    reader.readAsDataURL(file);
  });
}

function restoreSourcePreview(sheet: Sheet): Sheet {
  return sheet.sourcePreviewUrl || !sheet.sourceDataUrl
    ? sheet
    : { ...sheet, sourcePreviewUrl: sheet.sourceDataUrl };
}

function isTrustedScore(sheet: Sheet): boolean {
  if (!sheet.musicXml) return true;
  return sheet.processingProvider?.includes("Audiveris") === true || sheet.processingProvider === "Direct MusicXML upload";
}

const sheets: Sheet[] = [
  { id: 1, title: "Just the Two of Us", artist: "Grover Washington Jr.", instrument: "Piano", difficulty: "Intermediate", key: "F minor", bpm: 96, genre: "R&B / Soul", uploader: "Maya Chen", avatar: "MC", likes: 824, saves: 312, downloads: 1204, accent: "#e7a449", featured: true },
  { id: 2, title: "Nights", artist: "Frank Ocean", instrument: "Guitar", difficulty: "Intermediate", key: "E major", bpm: 89, genre: "Alternative R&B", uploader: "Noah Williams", avatar: "NW", likes: 641, saves: 278, downloads: 892, accent: "#8eb89b" },
  { id: 3, title: "Someday", artist: "The Strokes", instrument: "Bass", difficulty: "Beginner", key: "A major", bpm: 107, genre: "Indie Rock", uploader: "Leo Park", avatar: "LP", likes: 433, saves: 189, downloads: 736, accent: "#e87258" },
  { id: 4, title: "Misty", artist: "Erroll Garner", instrument: "Piano", difficulty: "Advanced", key: "E♭ major", bpm: 68, genre: "Jazz", uploader: "Sofia Reyes", avatar: "SR", likes: 1092, saves: 441, downloads: 1577, accent: "#758ba7" },
  { id: 5, title: "Good Days", artist: "SZA", instrument: "Guitar", difficulty: "Intermediate", key: "C♯ minor", bpm: 121, genre: "R&B / Soul", uploader: "Ari Brooks", avatar: "AB", likes: 558, saves: 234, downloads: 689, accent: "#b494c7" },
  { id: 6, title: "Everlong", artist: "Foo Fighters", instrument: "Drums", difficulty: "Advanced", key: "D major", bpm: 158, genre: "Rock", uploader: "Jamie Singh", avatar: "JS", likes: 721, saves: 199, downloads: 1138, accent: "#d39b82" },
  { id: 7, title: "From The Start", artist: "Laufey", instrument: "Voice", difficulty: "Intermediate", key: "B♭ major", bpm: 82, genre: "Jazz Pop", uploader: "Ella Kim", avatar: "EK", likes: 937, saves: 386, downloads: 998, accent: "#c38d87" },
  { id: 8, title: "Redbone", artist: "Childish Gambino", instrument: "Bass", difficulty: "Intermediate", key: "D minor", bpm: 80, genre: "Funk / Soul", uploader: "Theo Miles", avatar: "TM", likes: 489, saves: 176, downloads: 621, accent: "#9c8369" },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z"/>, download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>, arrow: <path d="m9 18 6-6-6-6"/>, back: <><path d="m15 18-6-6 6-6"/></>, play: <path d="m8 5 11 7-11 7V5Z"/>, pause: <><path d="M8 5v14"/><path d="M16 5v14"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>, check: <path d="m5 12 4 4L19 6"/>, edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>, close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>, plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>, music: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>, user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function ScorePreview({ sheet }: { sheet: Sheet }) {
  if (!sheet.musicXml) return <div className="score-preview score-preview-unavailable"><span>没有可用的结构化乐谱</span></div>;
  return <div className="score-preview">
    <div className="sheet-heading"><span>{sheet.title.toUpperCase()}</span><small>{sheet.artist}</small></div>
    <div className="score-preview-notation"><NotationRenderer thumbnail title={sheet.title} musicXml={sheet.musicXml}/></div>
  </div>;
}

function SourceCoverPreview({ sheet }: { sheet: Sheet }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const isPdf = sheet.sourceMimeType === "application/pdf" || sheet.sourceFileName?.toLowerCase().endsWith(".pdf");
  useEffect(() => {
    if (!isPdf || !sheet.sourcePreviewUrl || !hostRef.current) return;
    let cancelled = false;
    async function renderFirstPage() {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        pdfjs.GlobalWorkerOptions.workerSrc = location.pathname.startsWith("/Band-Project/")
          ? worker.replace(`${location.origin}/assets/`, `${location.origin}/Band-Project/assets/`)
          : worker;
        const response = await fetch(sheet.sourcePreviewUrl!);
        if (!response.ok) throw new Error("无法读取 PDF 原文件。");
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.8 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.className = "source-cover-pdf-page";
        await page.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: false })!, viewport }).promise;
        if (cancelled || !hostRef.current) return;
        hostRef.current.replaceChildren(canvas);
      } catch {
        if (!cancelled) setFallback(true);
      }
    }
    void renderFirstPage();
    return () => { cancelled = true; };
  }, [isPdf, sheet.sourcePreviewUrl]);
  if (!sheet.sourcePreviewUrl) return <ScorePreview sheet={sheet}/>;
  if (!isPdf) return <div className="source-cover image-source-cover"><img src={sheet.sourcePreviewUrl} alt={`${sheet.title} 原始乐谱第一页`} /></div>;
  return <div className="source-cover pdf-source-cover">{fallback ? <iframe src={sheet.sourcePreviewUrl} title={`${sheet.title} 原始乐谱第一页`} /> : <div ref={hostRef} />}</div>;
}

function scoreFeatureSummary(musicXml: string) {
  const count = (pattern: RegExp) => musicXml.match(pattern)?.length || 0;
  const typeCount = (type: string) => count(new RegExp(`<type>${type}</type>`, "gi"));
  return {
    eighth: typeCount("eighth"), sixteenth: typeCount("16th"), thirtySecond: typeCount("32nd"), quarter: typeCount("quarter"), half: typeCount("half"), whole: typeCount("whole"),
    rests: count(/<rest(?:\s|>)/gi), grace: count(/<grace(?:\s|>)/gi), slurs: count(/<slur\b[^>]*type=["']start["']/gi),
    ties: count(/<tie\b/gi), accidentals: count(/<accidental\b/gi) + count(/<alter>/gi),
  };
}

function ScoreFeatureSummary({ musicXml }: { musicXml: string }) {
  const stats = scoreFeatureSummary(musicXml);
  const features = [
    ["八分", stats.eighth], ["十六分", stats.sixteenth], ["三十二分", stats.thirtySecond], ["四分", stats.quarter], ["二分", stats.half], ["全音符", stats.whole],
    ["休止", stats.rests], ["倚音", stats.grace], ["连音/延音", stats.slurs + stats.ties], ["升降号", stats.accidentals],
  ].filter(([, value]) => value > 0);
  return <div className="score-feature-summary" aria-label="Audiveris 识别统计"><b>Audiveris 识别</b>{features.map(([label, value]) => <span key={String(label)}>{label} <strong>{value}</strong></span>)}</div>;
}

function SourcePreview({ sheet, zoom }: { sheet: Sheet; zoom: number }) {
  if (!sheet.sourcePreviewUrl) return null;
  if (sheet.sourceMimeType === "application/pdf" || sheet.sourceFileName?.toLowerCase().endsWith(".pdf")) {
    return <PdfSourcePreview url={sheet.sourcePreviewUrl} title={sheet.title} zoom={zoom}/>;
  }
  return <div className="source-file-preview image-preview" style={{ "--score-zoom": zoom / 100 }}><img src={sheet.sourcePreviewUrl} alt={`${sheet.title} 原始乐谱`} /></div>;
}

function PdfSourcePreview({ url, title, zoom }: { url: string; title: string; zoom: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function renderPdf() {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        pdfjs.GlobalWorkerOptions.workerSrc = location.pathname.startsWith("/Band-Project/")
          ? worker.replace(`${location.origin}/assets/`, `${location.origin}/Band-Project/assets/`)
          : worker;
        // PDF.js cannot reliably fetch a data: URL in static deployments.
        // Reading it into bytes first also works for same-session blob URLs.
        const response = await fetch(url);
        if (!response.ok) throw new Error("无法读取 PDF 原文件。");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled || !hostRef.current) return;
        hostRef.current.replaceChildren();
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.max(.8, Math.min(2.2, 1150 / base.width)) * zoom / 100;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          canvas.className = "pdf-page-canvas";
          canvas.setAttribute("aria-label", `${title} 第 ${pageNumber} 页`);
          hostRef.current.appendChild(canvas);
          await page.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: false })!, viewport }).promise;
          if (cancelled) return;
        }
      } catch {
        if (!cancelled) setError("无法显示 PDF 原文件，请点击下载原文件查看。");
      }
    }
    void renderPdf();
    return () => { cancelled = true; };
  }, [url, title, zoom]);
  return <div ref={hostRef} className="source-file-preview pdf-pages" aria-label={`${title} 原始 PDF`}>{error && <iframe className="native-pdf-fallback" src={url} title={`${title} 原始 PDF`} />}</div>;
}

function Logo({ onClick }: { onClick: () => void }) { return <button className="logo" onClick={onClick}><span className="logo-mark">B</span><span>BandProject</span></button>; }

function Nav({ view, go, activity, markRead }: { view: View; go: (v: View) => void; activity: Activity[]; markRead: () => void }) {
  const [searchOpen, setSearchOpen] = useState(false); const [notifications, setNotifications] = useState(false);
  const unread = activity.filter(item => item.unread).length;
  return <header className="nav"><Logo onClick={() => go("explore")} /><nav>
    <button className={view === "explore" || view === "sheet" ? "active" : ""} onClick={() => go("explore")}>Explore</button>
    <button className={view === "analysis" ? "active" : ""} onClick={() => go("analysis")}>AI Analysis <span className="new">NEW</span></button>
    <button className={view === "upload" ? "active" : ""} onClick={() => go("upload")}>Upload</button>
  </nav><div className="nav-actions">
    <div className={`nav-search ${searchOpen ? "open" : ""}`}><Icon name="search" size={17}/>{searchOpen && <input autoFocus placeholder="Search BandProject" onKeyDown={e => { if (e.key === "Enter") go("explore"); }}/>}</div>
    <button className="icon-btn" aria-label="Search" onClick={() => setSearchOpen(!searchOpen)}>{searchOpen ? <Icon name="close"/> : <Icon name="search"/>}</button>
    <button className={`icon-btn notice ${unread ? "has-unread" : ""}`} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} onClick={() => { setNotifications(!notifications); if (!notifications) markRead(); }}><Icon name="bell"/></button>
    <button className="nav-avatar" onClick={() => go("profile")}>MC</button>
    {notifications && <div className="notification-menu"><div><b>Notifications</b><button onClick={() => setNotifications(false)}><Icon name="close" size={15}/></button></div>{activity.length ? activity.map(item=><article key={item.id}><span>MC</span><p>{item.text}<small>{item.time}</small></p></article>) : <p className="notification-empty">没有新的通知。</p>}<button className="mark-read" onClick={() => { markRead(); setNotifications(false); }}>Mark all as read</button></div>}
  </div></header>;
}

function SheetCard({ sheet, open, liked, saved, toggleLike, toggleSave }: { sheet: Sheet; open: () => void; liked: boolean; saved: boolean; toggleLike: () => void; toggleSave: () => void }) {
  return <article className="sheet-card"><button className="cover" onClick={open} style={{ "--card-accent": sheet.accent } as React.CSSProperties}><SourceCoverPreview sheet={sheet}/><span className="instrument-tag">{sheet.instrument}</span></button>
    <div className="card-copy"><div><button className="title-link" onClick={open}>{sheet.title}</button><p>{sheet.artist}</p></div><div className="card-buttons"><button aria-label={liked ? "Unlike" : "Like"} className={liked ? "selected" : ""} onClick={toggleLike}><Icon name="heart" size={17}/></button><button aria-label={saved ? "Remove from My saving" : "Save to My saving"} className={saved ? "selected" : ""} onClick={toggleSave}><Icon name="bookmark" size={17}/></button></div></div>
    <div className="card-meta"><span>{sheet.difficulty}</span><span>•</span><span>{sheet.genre}</span><span className="plays">{sheet.downloads.toLocaleString()} plays</span></div>
    <div className="uploader"><span className="tiny-avatar" style={{ background: sheet.accent }}>{sheet.avatar}</span><span>by {sheet.uploader}</span></div></article>;
}

function Explore({ openSheet, go, library, likedIds, savedIds, toggleLike, toggleSave }: { openSheet: (s: Sheet) => void; go: (v: View) => void; library: Sheet[]; likedIds: number[]; savedIds: number[]; toggleLike: (sheet: Sheet) => void; toggleSave: (sheet: Sheet) => void }) {
  const [search, setSearch] = useState(""); const [instrument, setInstrument] = useState("All instruments"); const [genre, setGenre] = useState("All genres"); const [difficulty, setDifficulty] = useState("All levels");
  const filtered = useMemo(() => library.filter(s => `${s.title} ${s.artist} ${s.uploader}`.toLowerCase().includes(search.toLowerCase()) && (instrument === "All instruments" || s.instrument === instrument) && (genre === "All genres" || s.genre.includes(genre)) && (difficulty === "All levels" || s.difficulty === difficulty)), [search, instrument, genre, difficulty, library]);
  return <main>
    <section className="explore-hero"><div className="hero-note">THE SHEET MUSIC COMMUNITY</div><h1>Play something<br/><em>worth sharing.</em></h1><p>Discover arrangements from musicians everywhere—or share your own take.</p>
      <div className="big-search"><Icon name="search" size={21}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search songs, artists, or arrangers"/><kbd>⌘ K</kbd></div>
      <div className="quick-links"><span>Trending:</span><button onClick={() => setSearch("SZA")}>SZA</button><button onClick={() => setSearch("Misty")}>Jazz standards</button><button onClick={() => setInstrument("Guitar")}>Guitar</button><button onClick={() => setSearch("")}>New uploads</button></div>
    </section>
    <section className="featured-strip"><div className="feature-art"><div className="vinyl"><span/></div><div className="feature-notes">♪<br/>♩ ♫</div></div><div className="feature-copy"><span className="editor-pick">EDITOR&apos;S PICK · THIS WEEK</span><h2>Neo-soul, without<br/>the guesswork.</h2><p>A beautifully voiced piano arrangement of “Just the Two of Us,” with chord symbols and performance notes.</p><button onClick={() => openSheet(sheets[0])}>View sheet <Icon name="arrow" size={15}/></button></div><div className="feature-stats"><b>824</b><span>musicians liked this</span></div></section>
    <section className="library"><div className="section-title"><div><span className="kicker">COMMUNITY LIBRARY</span><h2>Sheets for your next session</h2></div><button className="upload-cta" onClick={() => go("upload")}><Icon name="upload" size={17}/> Upload a sheet</button></div>
      <div className="filters"><select value={instrument} onChange={e => setInstrument(e.target.value)}><option>All instruments</option><option>Piano</option><option>Guitar</option><option>Bass</option><option>Drums</option><option>Voice</option></select><select value={genre} onChange={e => setGenre(e.target.value)}><option>All genres</option><option>R&B</option><option>Jazz</option><option>Rock</option><option>Pop</option></select><select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option>All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select><select><option>Any key</option><option>C major</option><option>D major</option><option>F minor</option></select><span className="result-count">{filtered.length} sheets</span></div>
      {filtered.length ? <div className="sheet-grid">{filtered.map(s => <SheetCard key={s.id} sheet={s} open={() => openSheet(s)} liked={likedIds.includes(s.id)} saved={savedIds.includes(s.id)} toggleLike={() => toggleLike(s)} toggleSave={() => toggleSave(s)}/>)}</div> : <div className="empty"><Icon name="music" size={28}/><h3>No sheets found</h3><p>Try a different search or clear your filters.</p><button onClick={() => { setSearch(""); setInstrument("All instruments"); setGenre("All genres"); setDifficulty("All levels"); }}>Clear filters</button></div>}
    </section>
  </main>;
}

function downloadSheet(sheet: Sheet) {
  if (!sheet.musicXml) return;
  const url = URL.createObjectURL(new Blob([sheet.musicXml], { type: "application/vnd.recordare.musicxml+xml" }));
  const link = document.createElement("a"); link.href = url; link.download = `${sheet.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.musicxml`; link.click(); URL.revokeObjectURL(url);
}

function SheetDetail({ sheet, back, liked, saved, toggleLike, toggleSave }: { sheet: Sheet; back: () => void; liked: boolean; saved: boolean; toggleLike: () => void; toggleSave: () => void }) {
  const [comment, setComment] = useState(""), [expanded, setExpanded] = useState(false), [following, setFollowing] = useState(false), [zoom, setZoom] = useState(85), [shared, setShared] = useState(false), [comments, setComments] = useState(["The voicings in the second chorus are gorgeous. Super readable, too!", "Played this at our school showcase last week—thank you for arranging it."]);
  const scorePortRef = useRef<HTMLDivElement>(null);
  const changeZoom = (amount: number) => setZoom(value => Math.max(55, Math.min(130, value + amount)));
  async function share(){ await navigator.clipboard?.writeText(`${sheet.title} — ${sheet.artist} on BandProject`); setShared(true); setTimeout(() => setShared(false), 1800); }
  useEffect(() => {
    const port = scorePortRef.current;
    if (!port) return;
    // A native non-passive listener is required: React's wheel listener cannot
    // reliably cancel Chrome's page-level pinch zoom.
    const handlePinch = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 2 : -2);
    };
    port.addEventListener("wheel", handlePinch, { passive: false });
    return () => port.removeEventListener("wheel", handlePinch);
  }, []);
  return <main className="detail-page"><button className="back" onClick={back}><Icon name="back"/> Back to explore</button><div className="detail-grid">
    <section className="sheet-viewer"><div className="viewer-bar"><span>{sheet.sourcePreviewUrl ? "Original uploaded score" : sheet.processingProvider?.includes("Audiveris") ? "Source-layout OMR score" : "MusicXML score"}</span><div className="zoom-controls"><button aria-label="Zoom out" onClick={() => setZoom(Math.max(55, zoom - 10))}>−</button><span>{zoom}%</span><button aria-label="Zoom in" onClick={() => setZoom(Math.min(130, zoom + 10))}>＋</button></div>{sheet.sourcePreviewUrl ? <a className="download" href={sheet.sourcePreviewUrl} download={sheet.sourceFileName || "score"}><Icon name="download" size={16}/> Download original</a> : sheet.musicXml ? <button className="download" onClick={() => downloadSheet(sheet)}><Icon name="download" size={16}/> Download MusicXML</button> : null}</div><div ref={scorePortRef} className="score-scrollport" aria-label="可滚动谱面查看器">{sheet.sourcePreviewUrl ? <SourcePreview sheet={sheet} zoom={zoom}/> : sheet.musicXml ? <div className="real-score" style={{ "--score-zoom": zoom / 100 } as React.CSSProperties}><NotationRenderer preserveSourceLayout={sheet.processingProvider?.includes("Audiveris")} title={sheet.title} musicXml={sheet.musicXml}/></div> : <div className="source-unavailable">原始文件仅在上传会话中预览；请重新上传该 PDF 或图片。</div>}</div>{sheet.musicXml && <ScoreFeatureSummary musicXml={sheet.musicXml}/>} {sheet.processingMode === "fallback" && <div className="provider-warning"><b>Fallback preview</b>{sheet.processingWarnings?.[0]}</div>}</section>
    <aside className="sheet-info"><div className="eyebrow">{sheet.genre} · {sheet.instrument}</div><h1>{sheet.title}</h1><p className="artist">{sheet.artist}</p><div className="actions"><button className={liked ? "active" : ""} onClick={toggleLike}><Icon name="heart"/> {liked ? sheet.likes + 1 : sheet.likes}</button><button className={saved ? "active" : ""} onClick={toggleSave}><Icon name="bookmark"/> {saved ? "Saved" : "Save"}</button><button aria-label="Copy share text" onClick={share}>{shared ? <Icon name="check"/> : <Icon name="more"/>}</button></div>
      <dl className="specs"><div><dt>Instrument</dt><dd>{sheet.instrument}</dd></div><div><dt>Difficulty</dt><dd>{sheet.difficulty}</dd></div><div><dt>Key</dt><dd>{sheet.key}</dd></div><div><dt>Tempo</dt><dd>{sheet.bpm} BPM</dd></div></dl>
      <div className="description"><h3>About this arrangement</h3><p>A warm, playable arrangement with detailed chord symbols and thoughtful voicings. Built for solo performance, rehearsals, and anyone looking to dig into the harmony.{expanded && " The score includes rehearsal marks, suggested dynamics, chord extensions, and a simplified ending suitable for ensemble performances."}</p><button onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show full description"}</button></div>
      <div className="profile-row"><span className="profile-avatar">MC</span><div><b>{sheet.uploader}</b><span>Pianist · 24 arrangements</span></div><button className={following ? "following" : ""} onClick={() => setFollowing(!following)}>{following ? "Following" : "Follow"}</button></div>
      <div className="sheet-stats"><span><b>{sheet.downloads.toLocaleString()}</b> downloads</span><span><b>{sheet.saves}</b> saves</span><span>Uploaded Aug 18, 2026</span></div>
    </aside></div>
    <section className="comments"><div className="comments-head"><h2>Notes from the community</h2><span>{comments.length} comments</span></div><form onSubmit={e => { e.preventDefault(); if(comment.trim()){ setComments([...comments, comment]); setComment(""); } }}><span className="nav-avatar">MC</span><input value={comment} onChange={e => setComment(e.target.value)} placeholder="Share a thought or performance tip…"/><button disabled={!comment.trim()}>Post</button></form>{comments.map((c, i) => <article key={i}><span className="comment-avatar">{i ? "NW" : "EK"}</span><div><b>{i ? "Noah Williams" : "Ella Kim"}</b><span>{i ? "2 days ago" : "5 hours ago"}</span><p>{c}</p><button>Reply</button></div></article>)}</section>
  </main>;
}

function Field({ label, children, wide = false, optional = false }: { label: string; children: React.ReactNode; wide?: boolean; optional?: boolean }) { return <label className={`field ${wide ? "wide" : ""}`}><span>{label}{optional && <em>Optional</em>}</span>{children}</label>; }

function Upload({ done, publish }: { done: () => void; publish: (sheet: Sheet) => Promise<void> }) {
  const [file, setFile] = useState(""); const [scoreFile, setScoreFile] = useState<File|null>(null); const [submitted, setSubmitted] = useState(false); const [processing,setProcessing]=useState(false); const [uploadError,setUploadError]=useState(""); const [dragging,setDragging]=useState(false); const input = useRef<HTMLInputElement>(null);
  function chooseFile(chosen:File|null){setUploadError("");if(!chosen){setScoreFile(null);setFile("");return}try{validateScoreFile(chosen);setScoreFile(chosen);setFile(chosen.name)}catch(error){setScoreFile(null);setFile("");setUploadError(error instanceof Error?error.message:"无法使用这个文件。");if(input.current)input.current.value=""}}
  async function submit(e: FormEvent<HTMLFormElement>){ e.preventDefault(); if(!scoreFile){input.current?.click();return} setProcessing(true);setUploadError("");const fields=e.currentTarget.elements;const text=(index:number)=>(fields.item(index) as HTMLInputElement|HTMLSelectElement)?.value||"";const checked=e.currentTarget.querySelector<HTMLInputElement>('input[name="diff"]:checked');let processed:MusicProcessingResult;try{let sourcePreviewUrl:string|undefined;let sourceDataUrl:string|undefined;let sourceMimeType:string|undefined;if(isDirectMusicXml(scoreFile)){const musicXml=await scoreFile.text();if(!isMusicXml(musicXml))throw new Error("这个文件不是有效的 MusicXML 乐谱。");processed={musicXml,provider:"Direct MusicXML upload",mode:"real",warnings:[]}}else{sourceDataUrl=scoreFile.size<=MAX_PERSISTED_SOURCE_BYTES?await fileAsDataUrl(scoreFile):undefined;sourcePreviewUrl=sourceDataUrl||URL.createObjectURL(scoreFile);sourceMimeType=scoreFile.type;processed={musicXml:"",provider:"Direct source preview",mode:"real",warnings:[sourceDataUrl?"原始 PDF/图片直接显示，未进行 OMR 转谱。":"原始文件较大，仅在当前上传会话中预览；未进行 OMR 转谱。"]}}await publish({id:Date.now(),title:text(0),artist:text(1),instrument:text(2),genre:text(3),difficulty:checked?.id?checked.id[0].toUpperCase()+checked.id.slice(1):"Beginner",key:text(8)||"Not specified",bpm:Number(text(9))||96,uploader:"Maya Chen",avatar:"MC",likes:0,saves:0,downloads:0,accent:"#6256a8",musicXml:processed.musicXml,processingMode:processed.mode,processingProvider:processed.provider,processingWarnings:processed.warnings,sourcePreviewUrl,sourceDataUrl,sourceFileName:scoreFile.name,sourceMimeType});setSubmitted(true)}catch(error){setUploadError(error instanceof Error?error.message:"上传失败。")}finally{setProcessing(false)} }
  if (submitted) return <main className="success-page"><div className="success-icon"><Icon name="check" size={32}/></div><span className="kicker">UPLOAD COMPLETE</span><h1>Your arrangement is in.</h1><p>It&apos;s now part of the BandProject community. You can edit details any time from your profile.</p><button className="primary" onClick={done}>Explore the community <Icon name="arrow"/></button></main>;
  return <main className="form-page"><div className="form-intro"><span className="kicker">SHARE YOUR SOUND</span><h1>Upload sheet music</h1><p>Turn your arrangement into someone else&apos;s next favorite thing to play.</p></div><form className="upload-form" onSubmit={submit}><section><div className="form-section-title"><span>01</span><div><h2>About the music</h2><p>Help musicians find the right arrangement.</p></div></div><div className="field-grid"><Field label="Song title"><input required placeholder="e.g. Just the Two of Us"/></Field><Field label="Artist / composer"><input required placeholder="e.g. Grover Washington Jr."/></Field><Field label="Instrument"><select required defaultValue=""><option value="" disabled>Select instrument</option><option>Piano</option><option>Guitar</option><option>Bass</option><option>Drums</option><option>Voice</option></select></Field><Field label="Genre"><select required defaultValue=""><option value="" disabled>Select genre</option><option>Pop</option><option>R&B / Soul</option><option>Jazz</option><option>Rock</option></select></Field><Field label="Difficulty"><div className="segmented"><input type="radio" name="diff" id="beginner" defaultChecked/><label htmlFor="beginner">Beginner</label><input type="radio" name="diff" id="intermediate"/><label htmlFor="intermediate">Intermediate</label><input type="radio" name="diff" id="advanced"/><label htmlFor="advanced">Advanced</label></div></Field><Field label="Sheet type"><select><option>Full score</option><option>Lead sheet</option><option>Tablature</option><option>Chord chart</option></select></Field><Field label="Key" optional><input placeholder="e.g. F minor"/></Field><Field label="BPM" optional><input type="number" placeholder="96"/></Field></div></section>
    <section><div className="form-section-title"><span>02</span><div><h2>Add your sheet</h2><p>上传 PDF、PNG 或 JPG 后，OMR 会自动识别音符并转换成可播放、可下载的 MusicXML。</p></div></div><button type="button" className={`dropzone ${file ? "has-file" : ""} ${dragging ? "dragging" : ""}`} onClick={() => input.current?.click()} onDragEnter={e=>{e.preventDefault();setDragging(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}} onDrop={e=>{e.preventDefault();setDragging(false);chooseFile(e.dataTransfer.files?.[0]||null)}}><input ref={input} type="file" accept={SCORE_ACCEPT} onChange={e => chooseFile(e.target.files?.[0]||null)}/>{scoreFile ? <><span className="file-check"><Icon name="check"/></span><b>{file}</b><small>{scoreFileKind(scoreFile)} · {formatFileSize(scoreFile.size)} · {isDirectMusicXml(scoreFile)?"可直接读取":"发布时自动 OMR 识谱"} · 点击替换</small></> : <><span className="upload-circle"><Icon name="upload"/></span><b>把乐谱拖到这里，或 <u>选择文件</u></b><small>PDF、PNG、JPG 或 MusicXML · 最大 25 MB</small></>}</button>{uploadError&&<div className="processing-error" role="alert">{uploadError}</div>}<div className="omr-note"><b>提高识别准确率</b><span>请使用正向、清晰、背景干净的扫描件；图片建议 300 DPI 以上。手写谱和严重倾斜的照片可能需要人工校正。</span></div><Field label="Description" wide optional><textarea rows={5} placeholder="Tell musicians about this arrangement, performance notes, or what inspired it…"/></Field></section>
    <section><div className="form-section-title"><span>03</span><div><h2>Rights & usage</h2><p>Keep creative work respected.</p></div></div><div className="rights-box"><label><input type="checkbox" required/><span><b>I have the right to share this file.</b><small>I created this arrangement, it is public domain, or I have permission from the rights holder.</small></span></label><label><input type="checkbox" required/><span><b>Personal / Educational Use</b><small>I&apos;m sharing this for non-commercial learning and performance. I understand this selection does not itself grant or prove copyright permission.</small></span></label></div></section><div className="form-submit"><span aria-live="polite">{processing?"正在识别五线谱并生成 MusicXML，复杂乐谱可能需要几分钟…":"发布后仍可修改标题和乐谱信息。"}</span><button className="primary" type="submit" disabled={processing}>{processing?"OMR 识谱中…":"Publish sheet"} {!processing&&<Icon name="arrow"/>}</button></div></form></main>;
}


/* Legacy analysis UI removed from the live product because it contained browser estimates and placeholder visualization.
function MeasuredWaveform({ values, active = false }: { values?: number[]; active?: boolean }) { const bars = values || Array.from({length:84},(_,i)=>.18+((i*37)%54)/100); return <div className={`waveform ${active ? "active" : ""}`}>{bars.map((value,i)=><i key={i} style={{height:`${Math.max(10,value*100)}%`,opacity:.35+((i*17)%7)/10,animationDelay:`${-(i%11)*.07}s`}}/>)}</div>; }

function TranscriptionView({result,serverScore,target,saved,setSaved,back}:{result:AudioAnalysisResult;serverScore:MusicProcessingResult|null;target:string;saved:boolean;setSaved:(value:boolean)=>void;back:()=>void}) {
  const musicXml=serverScore?.mode==="real" ? serverScore.musicXml : undefined;
  const mode=serverScore?.mode||"fallback";
  const provider=serverScore?.provider||"Audiveris unavailable";
  return <main className="transcription-page"><button className="back" onClick={back}><Icon name="back"/> Back to analysis</button><div className="transcription-head"><div><span className="kicker">{musicXml ? "BASIC PITCH → MIDI → MUSICXML" : "NO SCORE GENERATED"}</span><h1>{target} transcription</h1><p>“{result.title}” · {result.key} {result.mode} · {result.bpm} BPM</p></div><div><button className="secondary" onClick={back}><Icon name="edit"/> Adjust analysis</button>{musicXml&&<button className="primary" onClick={()=>downloadSheet({...sheets[0],title:result.title,instrument:target,bpm:result.bpm,musicXml})}><Icon name="download"/> Export MusicXML</button>}</div></div><div className="transcription-layout"><div className="generated-sheet"><div className="sheet-doc-head"><div><h2>{result.title.toUpperCase()}</h2><p>{target} · {provider}</p></div><span>♩ = {result.bpm}</span></div>{musicXml ? <NotationRenderer title={result.title} musicXml={musicXml}/> : <div className="no-score"><h2>未生成乐谱</h2><p>{serverScore?.warnings?.[0] || "转录服务没有返回真实的 MusicXML，因此这里不会显示或导出任何虚拟音符。"}</p></div>}<div className={`provider-status ${mode}`}><b>{musicXml ? "Real server transcription" : "No transcription result"}</b><span>{serverScore?.warnings?.[0] || "Review the generated notation before performance."}</span></div></div><aside><span className="kicker">PROCESSING SOURCE</span><h3>{provider}</h3><ul><li><Icon name="check" size={15}/>{result.bpm} BPM browser signal analysis</li><li><Icon name="check" size={15}/>{result.key} {result.mode} tonal estimate</li><li><Icon name={musicXml ? "check" : "close"} size={15}/>{musicXml ? "Basic Pitch notes converted through MIDI" : "No Basic Pitch note data returned"}</li></ul><button className="save-project" onClick={()=>setSaved(true)}><Icon name={saved ? "check" : "bookmark"}/>{saved ? "Saved to projects" : "Save to projects"}</button></aside></div></main>;
}

function AnalysisV2Legacy() {
  const [stage,setStage]=useState<"upload"|"analyzing"|"results"|"transcription">("upload"); const [progress,setProgress]=useState(0); const [target,setTarget]=useState("Guitar"); const [saved,setSaved]=useState(false); const [error,setError]=useState(""); const [editing,setEditing]=useState(false); const [result,setResult]=useState<AudioAnalysisResult|null>(null); const [serverScore,setServerScore]=useState<MusicProcessingResult|null>(null); const [audioFile,setAudioFile]=useState<File|null>(null); const [audioUrl,setAudioUrl]=useState(""); const [playing,setPlaying]=useState(false); const [playhead,setPlayhead]=useState(0); const [transcribing,setTranscribing]=useState(false); const [transcriptionStatus,setTranscriptionStatus]=useState<"idle"|"queued"|"transcribing">("idle"); const input=useRef<HTMLInputElement>(null); const player=useRef<HTMLAudioElement>(null); const audioUrlRef=useRef("");
  function targetForApi(){return target.toLowerCase().replace(" ","-")}
  async function requestTranscription(file:File):Promise<MusicProcessingResult>{if(isStaticSite&&!hasPublicTranscriptionProcessor())return {provider:"GitHub Pages browser mode",mode:"fallback",warnings:["未配置公开的扒谱服务，因此没有生成音符或 MusicXML。"]};return transcribeAudio(file,{targetInstrument:targetForApi(),onStatus:setTranscriptionStatus})}
  useEffect(()=>()=>{if(audioUrlRef.current)URL.revokeObjectURL(audioUrlRef.current)},[]);
  function togglePlayback(){const audio=player.current;if(!audio)return;if(audio.paused)void audio.play();else audio.pause()}
  async function analyze(file?:File){if(!file)return;setError("");setServerScore(null);setAudioFile(file);if(audioUrlRef.current)URL.revokeObjectURL(audioUrlRef.current);const nextUrl=URL.createObjectURL(file);audioUrlRef.current=nextUrl;setAudioUrl(nextUrl);setPlaying(false);setPlayhead(0);setStage("analyzing");setProgress(7);let current=7;const timer=window.setInterval(()=>{current=Math.min(91,current+4);setProgress(current)},180);try{const verified=await analyzeAudioOnServer(file);if(!verified)throw new Error("未配置服务器分析服务。");window.clearInterval(timer);setProgress(100);setResult({title:file.name.replace(/\.[^/.]+$/,"").replace(/[_-]+/g," "),duration:verified.duration,bpm:verified.bpm,tempoConfidence:verified.tempoConfidence,key:verified.key,mode:verified.mode,keyConfidence:verified.keyConfidence,timeSignature:null,chords:verified.chords,chordConfidence:verified.chordConfidence,sections:verified.sections,instruments:verified.instruments,waveform:verified.waveform,analysisSource:"server"});if(verified.warnings.length)setError(verified.warnings.join(" "));window.setTimeout(()=>setStage("results"),350)}catch(reason){window.clearInterval(timer);setError(reason instanceof Error?`完整服务器分析未完成：${reason.message}`:"完整服务器分析连接中断。请稍后重试。");setStage("upload")} }
  async function generateTranscription(){if(!audioFile)return;setError("");setTranscriptionStatus("queued");setTranscribing(true);try{const transcribed=await requestTranscription(audioFile);setServerScore(transcribed);setStage("transcription")}catch(reason){setError(reason instanceof Error?reason.message:"Server transcription failed.")}finally{setTranscribing(false);setTranscriptionStatus("idle")}}
  if(stage==="upload")return <main className="ai-page"><section className="ai-hero"><span className="ai-label"><i/> BANDPROJECT AUDIO LAB</span><h1>Hear more in<br/>every song.</h1><p>Analysis runs on the audio itself in your browser: onset timing, tonal energy, chord candidates, and dynamics—not a filename lookup.</p></section><section className="audio-upload"><button onClick={()=>input.current?.click()}><input ref={input} type="file" accept="audio/*" onChange={e=>analyze(e.target.files?.[0])}/><span><Icon name="music" size={24}/></span><h3>Drop an audio file here</h3><p>or click to browse · MP3, WAV, M4A up to 50 MB</p></button>{error&&<div className="analysis-error">{error}</div>}<div className="privacy"><Icon name="check" size={15}/>{isStaticSite?"Audio is decoded locally in this static preview.":"Audio is sent to the BandProject processing service only to create your transcription draft."}</div></section><section className="ai-benefits"><article><b>01</b><h3>Measure the pulse</h3><p>Onset-energy autocorrelation estimates tempo from recurring attacks.</p></article><article><b>02</b><h3>Map the harmony</h3><p>Pitch-class energy is compared across major, minor, and chord templates.</p></article><article><b>03</b><h3>Make a draft</h3><p>Transcription starts from the detected key, tempo, and progression for review.</p></article></section></main>;
  if(stage==="analyzing")return <main className="analyzing"><div className="analysis-orbit"><span>{progress}%</span><i/></div><span className="kicker">ANALYZING AUDIO SIGNAL</span><h1>Finding the music inside.</h1><MeasuredWaveform active/><div className="progress"><i style={{width:`${progress}%`}}/></div><p>{progress<35?"Decoding waveform and finding note attacks…":progress<70?"Comparing tempo and tonal candidates…":"Segmenting harmony and dynamics…"}</p></main>;
  if(!result)return null;
  const duration=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,"0")}`;
  if(stage==="transcription") return <TranscriptionView result={result} serverScore={serverScore} target={target} saved={saved} setSaved={setSaved} back={()=>setStage("results")}/>;
  return <main className="results-page"><div className="result-top"><div><span className="ai-label"><i/> SIGNAL ANALYSIS COMPLETE</span><h1>{result.title}</h1><p>{duration(result.duration)} · {result.analysisSource==="server"?"measured by processing service":"rough browser estimate"}</p></div><div className="result-actions"><button className="secondary" onClick={()=>setEditing(!editing)}><Icon name="edit"/> {editing?"Done editing":"Edit results"}</button><button className="secondary" onClick={()=>setStage("upload")}>Analyze another</button></div></div><audio ref={player} src={audioUrl} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);setPlayhead(0)}} onTimeUpdate={event=>setPlayhead(event.currentTarget.currentTime)}/><div className={`audio-playback ${playing?"playing":""}`}><MeasuredWaveform values={result.waveform} active={playing}/><button className="audio-toggle" type="button" aria-pressed={playing} aria-label={playing?"Pause audio":"Play audio"} onClick={togglePlayback}><Icon name={playing?"pause":"play"} size={15}/><span>{playing?"暂停":"播放"}</span></button><input className="audio-scrubber" aria-label="Audio progress" type="range" min="0" max={result.duration} step="0.01" value={Math.min(playhead,result.duration)} onChange={event=>{const value=Number(event.target.value);setPlayhead(value);if(player.current)player.current.currentTime=value}}/></div><div className="timestamp"><span>{duration(playhead)}</span><span>{duration(result.duration)}</span></div><div className="analysis-grid"><section className="overview-card"><div className="card-label">MEASURED OVERVIEW <span>Editable</span></div><div className="metrics"><div><span>Tempo</span>{editing?<input className="metric-input" type="number" value={result.bpm} onChange={e=>setResult({...result,bpm:Number(e.target.value)})}/>:<b>{result.bpm} <small>BPM</small></b>}<em>{result.tempoConfidence}% confidence</em></div><div><span>Key</span>{editing?<select className="metric-input" value={result.key} onChange={e=>setResult({...result,key:e.target.value})}>{["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"].map(k=><option key={k}>{k}</option>)}</select>:<b>{result.key} <small>{result.mode}</small></b>}<em>{result.keyConfidence}% confidence</em></div><div><span>Time</span><b>4/4</b><em>inferred from pulse grouping</em></div></div></section><section className="instrument-card"><div className="card-label">TIMBRAL CANDIDATES <span>{result.instruments.length} detected</span></div><div className="instruments">{result.instruments.map(item=><div key={item.name}><span>{item.name}</span><i><b style={{width:`${item.confidence}%`}}/></i><em>{item.confidence}%</em></div>)}</div><p className="method-note">Instrument labels are broad timbral estimates, not isolated stems.</p></section><section className="chord-card"><div className="card-label">CHORD CANDIDATES <span>{result.chordConfidence}% confidence</span></div><div className="chords">{result.chords.length?result.chords.map((chord,i)=><span key={`${chord}-${i}`} contentEditable={editing} suppressContentEditableWarning>{chord}</span>):<em>没有足够的和声数据</em>}</div><p>Only signal candidates are shown; no chord progression is filled in.</p></section><section className="structure-card"><div className="card-label">ENERGY REGIONS <span>estimated</span></div><div className="timeline">{result.sections.map((section,i)=><span key={`${section.name}-${i}`} style={{background:section.color}}>{section.name}</span>)}</div><div className="timeline-times"><span>0:00</span>{result.sections.slice(1,-1).filter((_,i)=>i%2===0).map(s=><span key={s.start}>{duration(s.start)}</span>)}<span>{duration(result.duration)}</span></div></section></div>{error&&<div className="analysis-error">{error}</div>}<div className="analysis-note"><b>How to read this:</b> confidence reflects separation between the best and next-best signal candidates. Complex mixes, rubato, or tuning drift can reduce accuracy; edit the musical result before generating a draft.</div><section className="transcribe-cta"><div><span className="kicker">NEXT STEP</span><h2>Build a draft from this analysis.</h2><p>The draft uses the measured tempo and key above. It will only display a score when the service returns real MusicXML.</p></div><div className="target-picker">{["Guitar","Bass","Piano","Chords","Lead sheet"].map(item=><button key={item} className={target===item?"active":""} onClick={()=>setTarget(item)} disabled={transcribing}>{item}</button>)}<button className="generate" onClick={generateTranscription} disabled={transcribing}>{transcribing?(transcriptionStatus==="transcribing"?"识别真实音符中…":"任务排队中…"):`Generate ${target}`} {!transcribing&&<Icon name="arrow"/>}</button></div></section></main>;
}
*/

function AnalysisV2() {
  const [stage,setStage]=useState<"upload"|"processing"|"results"|"score">("upload");
  const [status,setStatus]=useState<"queued"|"transcribing">("queued");
  const [error,setError]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [audioUrl,setAudioUrl]=useState("");
  const [score,setScore]=useState<MusicProcessingResult|null>(null);
  const [target,setTarget]=useState("Auto");
  const [playing,setPlaying]=useState(false);
  const [playhead,setPlayhead]=useState(0);
  const [audioDuration,setAudioDuration]=useState(0);
  const player=useRef<HTMLAudioElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const audioUrlRef=useRef("");
  useEffect(()=>()=>{if(audioUrlRef.current)URL.revokeObjectURL(audioUrlRef.current)},[]);
  const analysis=score?.analysis;
  const title=file?.name.replace(/\.[^/.]+$/,"").replace(/[_-]+/g," ")||"Untitled";
  const durationValue=analysis?.duration||audioDuration||0;
  const formatDuration=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,"0")}`;
  const targetForApi=(value:string)=>value.toLowerCase().replace(" ","-");

  async function runTranscription(nextFile:File,nextTarget="Auto"){
    setError("");
    setStage("processing");
    setStatus("queued");
    try{
      const result=await transcribeAudio(nextFile,{targetInstrument:targetForApi(nextTarget),onStatus:setStatus});
      if(result.mode!=="real"||!result.musicXml||!result.noteEvents?.length){
        throw new Error("服务器没有返回可验证的音符事件和 MusicXML。系统不会显示替代音符。");
      }
      if(!result.analysis)throw new Error("服务器没有返回与音符事件对应的音乐分析。");
      setScore(result);
      setStage("results");
    }catch(reason){
      setScore(null);
      setError(reason instanceof Error?reason.message:"完整扒谱服务未完成任务。");
      setStage("upload");
    }
  }

  function chooseFile(nextFile?:File){
    if(!nextFile)return;
    setFile(nextFile);
    if(audioUrlRef.current)URL.revokeObjectURL(audioUrlRef.current);
    const nextUrl=URL.createObjectURL(nextFile);
    audioUrlRef.current=nextUrl;
    setAudioUrl(nextUrl);
    setPlayhead(0);
    setAudioDuration(0);
    void runTranscription(nextFile,"Auto");
  }

  async function rerunForTarget(){
    if(file)await runTranscription(file,target);
  }

  function togglePlayback(){
    const audio=player.current;
    if(!audio)return;
    if(audio.paused)void audio.play();else audio.pause();
  }

  if(stage==="upload")return <main className="ai-page"><section className="ai-hero"><span className="ai-label"><i/> BANDPROJECT AUDIO LAB</span><h1>真实音频，<br/>真实乐谱。</h1><p>上传后由服务器完成音符识别、节拍分析与 MusicXML 制谱。没有可靠证据的项目会留空，不会用预设数据补齐。</p></section><section className="audio-upload"><button onClick={()=>input.current?.click()}><input ref={input} type="file" accept="audio/*" onChange={event=>chooseFile(event.target.files?.[0])}/><span><Icon name="music" size={24}/></span><h3>上传音频开始完整扒谱</h3><p>MP3、WAV、M4A、OGG、FLAC · 最大 50 MB</p></button>{error&&<div className="analysis-error">{error}</div>}<div className="privacy"><Icon name="check" size={15}/>音频仅发送到私人扒谱服务，不会发布到网站乐谱库。</div></section></main>;

  if(stage==="processing")return <main className="analyzing"><div className="analysis-orbit"><span><Icon name="music" size={24}/></span><i/></div><span className="kicker">REAL SERVER TRANSCRIPTION</span><h1>{status==="queued"?"正在连接处理服务。":"正在识别真实音符。"}</h1><p>{status==="queued"?"免费处理实例可能需要先唤醒，请保持页面打开。":"正在完成音符、节拍、调性与和弦分析，随后导出 MusicXML。"}</p></main>;

  if(!score||!analysis||!file)return null;
  if(stage==="score")return <main className="transcription-page"><button className="back" onClick={()=>setStage("results")}><Icon name="back"/> 返回分析</button><div className="transcription-head"><div><span className="kicker">VERIFIED NOTE EVENTS → MUSICXML</span><h1>{title}</h1><p>{analysis.noteCount} 个真实音符事件 · {score.provider}</p></div><button className="primary" onClick={()=>downloadSheet({...sheets[0],title,instrument:target,bpm:analysis.bpm||0,musicXml:score.musicXml})}><Icon name="download"/> 导出 MusicXML</button></div><div className="generated-sheet"><NotationRenderer title={title} musicXml={score.musicXml!}/><div className="provider-status real"><b>服务器真实扒谱</b><span>乐谱仅由模型返回的音符事件生成；请在正式演奏前人工复核。</span></div></div></main>;

  const tempoKnown=Boolean(analysis.bpm&&analysis.tempoConfidence>=38);
  const keyKnown=Boolean(analysis.key&&analysis.mode&&analysis.keyConfidence>=8);
  const meter=analysis.timeSignature?`${analysis.timeSignature[0]}/${analysis.timeSignature[1]}`:null;
  return <main className="results-page"><div className="result-top"><div><span className="ai-label"><i/> SERVER TRANSCRIPTION COMPLETE</span><h1>{title}</h1><p>{formatDuration(durationValue)} · {analysis.noteCount} 个可验证音符事件</p></div><div className="result-actions"><button className="secondary" onClick={()=>setStage("upload")}>分析另一首</button><button className="primary" onClick={()=>setStage("score")}>查看真实乐谱</button></div></div><audio ref={player} src={audioUrl} onLoadedMetadata={event=>setAudioDuration(event.currentTarget.duration)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onTimeUpdate={event=>setPlayhead(event.currentTarget.currentTime)}/><div className={`audio-playback ${playing?"playing":""}`}><button className="audio-toggle" type="button" aria-pressed={playing} onClick={togglePlayback}><Icon name={playing?"pause":"play"} size={15}/><span>{playing?"暂停":"播放"}</span></button><input className="audio-scrubber" aria-label="Audio progress" type="range" min="0" max={durationValue||1} step="0.01" value={Math.min(playhead,durationValue||1)} onChange={event=>{const value=Number(event.target.value);setPlayhead(value);if(player.current)player.current.currentTime=value}}/></div><div className="timestamp"><span>{formatDuration(playhead)}</span><span>{formatDuration(durationValue)}</span></div><div className="analysis-grid"><section className="overview-card"><div className="card-label">VERIFIED OVERVIEW <span>{analysis.provider}</span></div><div className="metrics"><div><span>Tempo</span><b>{tempoKnown?analysis.bpm:"—"} {tempoKnown&&<small>BPM</small>}</b><em>{tempoKnown?`${analysis.tempoConfidence}% confidence`:"未可靠检测"}</em></div><div><span>Key</span><b>{keyKnown?analysis.key:"—"} {keyKnown&&<small>{analysis.mode}</small>}</b><em>{keyKnown?`${analysis.keyConfidence}% confidence`:"未可靠检测"}</em></div><div><span>Time</span><b>{meter||"—"}</b><em>{meter?"来自重拍证据":"未检测，不作预设"}</em></div></div></section><section className="instrument-card"><div className="card-label">NOTE EVIDENCE <span>{analysis.noteCount} events</span></div><p className="method-note">节拍由波形起音与识别出的音符起点联合计算；调性与和弦低于可信门槛时保持为空。</p></section><section className="chord-card"><div className="card-label">CHORD CANDIDATES <span>{analysis.chordConfidence}% confidence</span></div><div className="chords">{analysis.chords.length?analysis.chords.map((chord,index)=><span key={`${chord}-${index}`}>{chord}</span>):<em>没有足够的和声证据</em>}</div><p>只展示音符事件能支持且超过可信门槛的三和弦候选，不补全和弦进行。</p></section><section className="structure-card"><div className="card-label">PROCESSING PROVENANCE <span>real</span></div><p className="method-note">{score.pipeline?.transcriber||score.provider}<br/>{score.notation?.rhythmMode==="free"?"自由节奏 · 未宣称 BPM 或拍号":score.notation?.quantized?`节拍量化 · ${score.notation.measureCount||0} 小节`:"保留模型原始时值，未宣称拍号"}</p></section></div>{score.warnings?.length>0&&<div className="analysis-note"><b>处理说明：</b> {score.warnings.join(" ")}</div>}<section className="transcribe-cta"><div><span className="kicker">INSTRUMENT PROFILE</span><h2>按乐器范围重新扒谱。</h2><p>重新运行会使用对应音域与起音阈值，不会修改或补造音符。</p></div><div className="target-picker">{["Auto","Guitar","Bass","Piano","Chords","Lead sheet"].map(item=><button key={item} className={target===item?"active":""} onClick={()=>setTarget(item)}>{item}</button>)}<button className="generate" onClick={()=>void rerunForTarget()}>重新运行 {target}<Icon name="arrow"/></button></div></section></main>;
}

function Profile({ openSheet, uploads, library, likedIds, savedIds, toggleLike, toggleSave }: { openSheet: (s: Sheet) => void; uploads: Sheet[]; library: Sheet[]; likedIds: number[]; savedIds: number[]; toggleLike: (sheet: Sheet) => void; toggleSave: (sheet: Sheet) => void }) { const [tab,setTab]=useState("Uploads"); const visible=tab==="Uploads"?[...uploads,...sheets.slice(0,4)]:library.filter(sheet=>savedIds.includes(sheet.id)); return <main className="profile-page"><section className="profile-cover"><div className="profile-monogram">MC</div></section><section className="profile-main"><div className="profile-header"><div><h1>Maya Chen</h1><p>@mayaplayskeys · New York, NY</p></div><button className="secondary"><Icon name="edit"/> Edit profile</button></div><p className="bio">Pianist, arranger, and music student. Usually somewhere between jazz harmony and a perfect pop hook.</p><div className="profile-tags"><div><span>PLAYS</span><b>Piano</b><b>Voice</b></div><div><span>LOVES</span><b>Jazz</b><b>R&B</b><b>Indie pop</b></div></div><div className="profile-numbers"><span><b>{24+uploads.length}</b> uploads</span><span><b>8.4k</b> downloads</span><span><b>1.2k</b> followers</span></div><div className="profile-tabs"><button className={tab==="Uploads"?"active":""} onClick={()=>setTab("Uploads")}>Uploaded sheets</button><button className={tab==="Saved"?"active":""} onClick={()=>setTab("Saved")}>My saving <span>{savedIds.length}</span></button></div>{visible.length ? <div className="sheet-grid profile-grid">{visible.map(s=><SheetCard key={s.id} sheet={s} open={()=>openSheet(s)} liked={likedIds.includes(s.id)} saved={savedIds.includes(s.id)} toggleLike={()=>toggleLike(s)} toggleSave={()=>toggleSave(s)}/>)}</div> : <div className="saved-empty"><Icon name="bookmark" size={25}/><h3>Your saving is empty</h3><p>收藏乐谱后会集中显示在这里。</p></div>}</section></main>; }

export default function Home() {
  const [view, setView] = useState<View>("explore"); const [selected, setSelected] = useState(sheets[0]); const [uploads,setUploads]=useState<Sheet[]>([]); const [likedIds,setLikedIds]=useState<number[]>(()=>readStoredIds("bandproject-liked")); const [savedIds,setSavedIds]=useState<number[]>(()=>readStoredIds("bandproject-saved")); const [activity,setActivity]=useState<Activity[]>([]); const [toast,setToast]=useState("");
  const library=[...uploads,...sheets];
  useEffect(()=>{queueMicrotask(async()=>{let localUploads:Sheet[]=[];try{const stored=localStorage.getItem("bandproject-uploads");if(stored){localUploads=(JSON.parse(stored) as Sheet[]).filter(isTrustedScore).map(restoreSourcePreview);localStorage.setItem("bandproject-uploads",JSON.stringify(localUploads.map(sheet=>{const persistable={...sheet};delete persistable.sourcePreviewUrl;return persistable})))}}catch{/* ignore corrupt fallback data */}if(!isStaticSite)try{const response=await fetch("/api/sheets",{cache:"no-store"});const payload=await response.json() as {sheets?:Sheet[]};if(payload.sheets?.length){const localById=new Map(localUploads.map(sheet=>[sheet.id,sheet]));setUploads(payload.sheets.filter(isTrustedScore).map(sheet=>restoreSourcePreview({...sheet,likes:0,saves:0,downloads:0,...localById.get(sheet.id)})));return}}catch{/* D1 is optional in local development */}setUploads(localUploads)})},[]);
  function record(text:string){const id=Date.now();setToast(text);setActivity(current=>[{id,text,time:"刚刚",unread:true},...current].slice(0,8));window.setTimeout(()=>setToast(current=>current===text?"":current),2600)}
  function toggleLike(sheet:Sheet){const added=!likedIds.includes(sheet.id);const next=added?[sheet.id,...likedIds]:likedIds.filter(id=>id!==sheet.id);setLikedIds(next);localStorage.setItem("bandproject-liked",JSON.stringify(next));record(added?`已点赞「${sheet.title}」`:`已取消点赞「${sheet.title}」`)}
  function toggleSave(sheet:Sheet){const added=!savedIds.includes(sheet.id);const next=added?[sheet.id,...savedIds]:savedIds.filter(id=>id!==sheet.id);setSavedIds(next);localStorage.setItem("bandproject-saved",JSON.stringify(next));record(added?`已收藏「${sheet.title}」，已加入 My saving`:`已从 My saving 移除「${sheet.title}」`)}
  async function publish(sheet:Sheet){const persistable=Object.fromEntries(Object.entries(sheet).filter(([key])=>key!=="sourcePreviewUrl")) as Sheet;setUploads(current=>[sheet,...current]);try{const current=JSON.parse(localStorage.getItem("bandproject-uploads")||"[]") as Sheet[];localStorage.setItem("bandproject-uploads",JSON.stringify([persistable,...current.filter(item=>item.id!==sheet.id)]))}catch{/* The current-session preview remains available if storage is full. */}if(!isStaticSite)try{await fetch("/api/sheets",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(persistable)})}catch{/* Browser storage remains the preview fallback. */}}
  function go(v: View){ setView(v); window.scrollTo({top:0,behavior:"smooth"}); }
  function openSheet(s: Sheet){ setSelected(s); go("sheet"); }
  return <><Nav view={view} go={go} activity={activity} markRead={()=>setActivity(current=>current.map(item=>({...item,unread:false})))} />{toast&&<div className="action-toast" role="status"><Icon name="check" size={16}/>{toast}</div>}{view === "explore" && <Explore openSheet={openSheet} go={go} library={library} likedIds={likedIds} savedIds={savedIds} toggleLike={toggleLike} toggleSave={toggleSave}/>} {view === "sheet" && <SheetDetail sheet={selected} back={()=>go("explore")} liked={likedIds.includes(selected.id)} saved={savedIds.includes(selected.id)} toggleLike={()=>toggleLike(selected)} toggleSave={()=>toggleSave(selected)}/>} {view === "upload" && <Upload done={()=>go("explore")} publish={publish}/>} {view === "analysis" && <AnalysisV2/>} {view === "profile" && <Profile openSheet={openSheet} uploads={uploads} library={library} likedIds={likedIds} savedIds={savedIds} toggleLike={toggleLike} toggleSave={toggleSave}/>}<footer><Logo onClick={()=>go("explore")}/><p>Made for the next generation of musicians.</p><span>© 2026 BandProject</span></footer></>;
}
