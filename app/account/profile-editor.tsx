"use client";
import { FormEvent, useState } from "react";
import type { StudioProfile } from "@/app/lib/studio17-models";
import { StudioAvatar } from "@/app/components/StudioAvatar";

export default function ProfileEditor({ email, initial }: { email: string; initial: StudioProfile }) {
  const [profile, setProfile] = useState(initial); const [notice, setNotice] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setNotice("");
    const response = await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
    const payload = await response.json() as { profile?: StudioProfile; error?: string };
    if (response.ok && payload.profile) { setProfile(payload.profile); setNotice("Profile saved."); } else setNotice(payload.error || "Could not save your profile.");
    setSaving(false);
  }
  return <section className="s17-profile-panel">
    <div className="s17-profile-preview"><StudioAvatar name={profile.displayName} src={profile.avatarUrl} size="large"/><div><b>{profile.displayName}</b><span>@{profile.username}</span><small>{email}</small></div></div>
    <form onSubmit={submit} className="s17-form">
      <label><span>Username</span><input required minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_-]{2,29}" value={profile.username} onChange={event => setProfile({ ...profile, username: event.target.value.toLowerCase() })}/><small>Letters, numbers, underscores and hyphens.</small></label>
      <label><span>Display name</span><input required maxLength={60} value={profile.displayName} onChange={event => setProfile({ ...profile, displayName: event.target.value })}/></label>
      <label className="wide"><span>Avatar image URL <em>optional</em></span><input type="url" placeholder="https://…" value={profile.avatarUrl || ""} onChange={event => setProfile({ ...profile, avatarUrl: event.target.value || null })}/></label>
      <label className="wide"><span>Short bio</span><textarea maxLength={280} rows={5} value={profile.bio} onChange={event => setProfile({ ...profile, bio: event.target.value })}/><small>{profile.bio.length}/280</small></label>
      <div className="s17-form-actions"><button className="s17-primary" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>{notice && <p role="status">{notice}</p>}</div>
    </form>
  </section>;
}

