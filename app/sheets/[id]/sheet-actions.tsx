"use client";
import { useEffect, useState } from "react";
import type { StudioSheet } from "@/app/lib/studio17-models";

export default function SheetActions({ sheet, authenticated }: { sheet: StudioSheet; authenticated: boolean }) {
  const [saved, setSaved] = useState(Boolean(sheet.isFavorited)); const [reporting, setReporting] = useState(false); const [notice, setNotice] = useState("");
  useEffect(() => { void fetch(`/api/sheets/${sheet.id}/view`, { method: "POST" }); }, [sheet.id]);
  async function toggleSave() {
    if (!authenticated) { window.location.href = `/signin-with-chatgpt?return_to=${encodeURIComponent(`/sheets/${sheet.id}`)}`; return; }
    const next = !saved; const response = await fetch(`/api/sheets/${sheet.id}/favorite`, { method: next ? "POST" : "DELETE" });
    if (response.ok) { setSaved(next); setNotice(next ? "Saved to My Library." : "Removed from My Library."); }
  }
  async function download() {
    await fetch(`/api/sheets/${sheet.id}/download`, { method: "POST" });
    if (sheet.musicXml) {
      const url = URL.createObjectURL(new Blob([sheet.musicXml], { type: "application/vnd.recordare.musicxml+xml" })); const link = document.createElement("a"); link.href = url; link.download = `${sheet.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.musicxml`; link.click(); URL.revokeObjectURL(url);
    } else if (sheet.hasSourceFile) window.location.href = `/api/sheets/${sheet.id}/source`;
  }
  async function report(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sheetId: sheet.id, reason: form.get("reason"), details: form.get("details") }) });
    const payload = await response.json() as { error?: string }; setNotice(response.ok ? "Report received. Thank you." : payload.error || "Could not submit this report."); if (response.ok) setReporting(false);
  }
  return <div className="s17-detail-actions"><button className={saved ? "selected" : ""} onClick={() => void toggleSave()}>{saved ? "✓ Saved" : "♡ Save"}</button><button className="s17-primary" onClick={() => void download()}>↓ Download</button><button onClick={() => authenticated ? setReporting(!reporting) : window.location.href = `/signin-with-chatgpt?return_to=${encodeURIComponent(`/sheets/${sheet.id}`)}`}>Report</button>{notice && <p role="status">{notice}</p>}{reporting && <form className="s17-report" onSubmit={report}><select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option><option>Copyright or attribution</option><option>Incorrect metadata</option><option>Broken or misleading file</option><option>Inappropriate content</option></select><textarea name="details" placeholder="Optional details" maxLength={1000}/><div><button type="button" onClick={() => setReporting(false)}>Cancel</button><button>Submit report</button></div></form>}</div>;
}
