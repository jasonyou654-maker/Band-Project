"use client";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isMusicXml } from "@/app/lib/musicxml";
import { formatFileSize, isDirectMusicXml, recognizeScore, SCORE_ACCEPT, scoreFileKind, validateScoreFile } from "@/app/lib/omr-client";

const INSTRUMENTS = ["Piano", "Guitar", "Bass", "Drums", "Voice", "Lead Sheet", "Full Band", "Other"];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

export default function StudioUploadForm() {
  const router = useRouter(); const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null); const [notice, setNotice] = useState(""); const [submitting, setSubmitting] = useState(false);
  function choose(next: File | null) { setNotice(""); if (!next) return setFile(null); try { validateScoreFile(next); setFile(next); } catch (error) { setNotice(error instanceof Error ? error.message : "Unsupported score file."); setFile(null); } }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!file) return fileInput.current?.click(); setSubmitting(true); setNotice("Saving your original score…");
    try {
      const form = new FormData(event.currentTarget); const asset = new FormData(); asset.append("file", file);
      const assetResponse = await fetch("/api/assets/score", { method: "POST", body: asset }); const assetPayload = await assetResponse.json() as { sourceObjectKey?: string; error?: string };
      if (!assetResponse.ok || !assetPayload.sourceObjectKey) throw new Error(assetPayload.error || "Could not store the source score.");
      let musicXml = ""; let provider = "Original score upload"; let warnings: string[] = [];
      if (isDirectMusicXml(file)) {
        musicXml = await file.text(); if (!isMusicXml(musicXml)) throw new Error("This is not valid MusicXML."); provider = "Direct MusicXML upload";
      } else {
        setNotice("Reading the score notation…");
        try { const result = await recognizeScore(file); musicXml = result.musicXml || ""; provider = result.provider; warnings = result.warnings || []; }
        catch (error) { warnings = [error instanceof Error ? error.message : "Automatic notation recognition was unavailable.", "The original score remains available for preview and download."]; }
      }
      setNotice("Publishing your score…");
      const response = await fetch("/api/sheets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        title: form.get("title"), artist: form.get("artist"), instrument: form.get("instrument"), arrangement: form.get("arrangement"), genre: form.get("genre"), difficulty: form.get("difficulty"), key: form.get("key"), bpm: Number(form.get("bpm")), tags: form.get("tags"), description: form.get("description"), rightsDeclaration: form.get("rightsDeclaration"), visibility: form.get("visibility"), sourceObjectKey: assetPayload.sourceObjectKey, musicXml, processingMode: "real", processingProvider: provider, processingWarnings: warnings,
      }) });
      const payload = await response.json() as { sheet?: { id: number }; error?: string };
      if (!response.ok || !payload.sheet) throw new Error(payload.error || "Could not publish this score.");
      router.push(`/sheets/${payload.sheet.id}`); router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Upload failed."); setSubmitting(false); }
  }
  return <form className="s17-publish-form" onSubmit={submit}>
    <section className="s17-upload-file"><input ref={fileInput} type="file" name="score" accept={SCORE_ACCEPT} onChange={event => choose(event.target.files?.[0] || null)}/><button type="button" onClick={() => fileInput.current?.click()}><span>＋</span><b>{file ? file.name : "Choose PDF, image or MusicXML"}</b><small>{file ? `${scoreFileKind(file)} · ${formatFileSize(file.size)}` : "Up to 25 MB"}</small></button></section>
    <section className="s17-form-section"><div><span>01</span><h2>Music details</h2></div><div className="s17-form-grid">
      <label><span>Song title</span><input name="title" required maxLength={120}/></label><label><span>Artist / composer</span><input name="artist" required maxLength={120}/></label>
      <label><span>Instrument</span><select name="instrument" required defaultValue=""><option value="" disabled>Select instrument</option>{INSTRUMENTS.map(item => <option key={item}>{item}</option>)}</select></label><label><span>Arrangement</span><input name="arrangement" required placeholder="e.g. Piano solo, SATB, Full band" maxLength={120}/></label>
      <label><span>Difficulty</span><select name="difficulty" required defaultValue="Intermediate">{DIFFICULTIES.map(item => <option key={item}>{item}</option>)}</select></label><label><span>Genre</span><input name="genre" placeholder="Pop, Jazz, Rock…" maxLength={80}/></label>
      <label><span>Key</span><input name="key" placeholder="e.g. E♭ major" maxLength={40}/></label><label><span>BPM</span><input name="bpm" type="number" min="1" max="400" defaultValue="96"/></label>
      <label className="wide"><span>Tags</span><input name="tags" placeholder="school band, acoustic, concert"/><small>Separate tags with commas.</small></label><label className="wide"><span>Description</span><textarea name="description" rows={5} maxLength={2000} placeholder="Describe the arrangement, notation choices and intended players."/></label>
    </div></section>
    <section className="s17-form-section"><div><span>02</span><h2>Rights & visibility</h2></div><div className="s17-form-grid">
      <label className="wide"><span>Source / copyright declaration</span><textarea name="rightsDeclaration" required rows={4} maxLength={500} placeholder="State who created the arrangement and what permission or exception allows you to share it."/></label>
      <label><span>Visibility</span><select name="visibility"><option value="public">Public</option><option value="private">Private</option></select></label>
      <p className="s17-rights-note">“Personal / Educational Use” does not automatically grant permission. Only upload material you are allowed to store and share.</p>
    </div></section>
    <div className="s17-publish-actions"><button className="s17-primary" disabled={submitting}>{submitting ? "Working…" : "Publish score"}</button>{notice && <p role="status">{notice}</p>}</div>
  </form>;
}

