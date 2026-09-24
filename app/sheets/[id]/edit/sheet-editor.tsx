"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { StudioSheet } from "@/app/lib/studio17-models";

export default function SheetEditor({ sheet }: { sheet: StudioSheet }) {
  const router = useRouter(); const [notice, setNotice] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice(""); const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/sheets/${sheet.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); const payload = await response.json() as { error?: string };
    if (response.ok) { router.push(`/sheets/${sheet.id}`); router.refresh(); } else { setNotice(payload.error || "Could not update this score."); setSaving(false); }
  }
  async function remove() { if (!window.confirm("Delete this score from Studio17? This cannot be undone.")) return; const response = await fetch(`/api/sheets/${sheet.id}`, { method: "DELETE" }); if (response.ok) { router.push("/library"); router.refresh(); } else setNotice("Could not delete this score."); }
  return <form className="s17-publish-form" onSubmit={submit}><section className="s17-form-section"><div><span>01</span><h2>Score metadata</h2></div><div className="s17-form-grid">
    <label><span>Song title</span><input name="title" required defaultValue={sheet.title}/></label><label><span>Artist / composer</span><input name="artist" required defaultValue={sheet.artist}/></label>
    <label><span>Instrument</span><input name="instrument" required defaultValue={sheet.instrument}/></label><label><span>Arrangement</span><input name="arrangement" required defaultValue={sheet.arrangement}/></label>
    <label><span>Difficulty</span><select name="difficulty" defaultValue={sheet.difficulty}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><label><span>Genre</span><input name="genre" defaultValue={sheet.genre}/></label>
    <label><span>Key</span><input name="key" defaultValue={sheet.key}/></label><label><span>BPM</span><input name="bpm" type="number" min="1" max="400" defaultValue={sheet.bpm}/></label>
    <label className="wide"><span>Tags</span><input name="tags" defaultValue={sheet.tags.join(", ")}/></label><label className="wide"><span>Description</span><textarea name="description" rows={5} maxLength={2000} defaultValue={sheet.description}/></label>
    <label className="wide"><span>Source / copyright declaration</span><textarea name="rightsDeclaration" required rows={4} maxLength={500} defaultValue={sheet.rightsDeclaration}/></label><label><span>Visibility</span><select name="visibility" defaultValue="public"><option value="public">Public</option><option value="private">Private</option></select></label>
  </div></section><div className="s17-publish-actions"><button className="s17-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button><button type="button" className="s17-danger" onClick={() => void remove()}>Delete score</button>{notice && <p role="status">{notice}</p>}</div></form>;
}

