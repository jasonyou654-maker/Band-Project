"use client";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const query = useSearchParams(); const returnTo = query.get("return_to")?.startsWith("/") ? query.get("return_to")! : "/";
  const [register, setRegister] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget); const response = await fetch(`/api/auth?mode=${register ? "register" : "login"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); const data = await response.json() as { error?: string }; if (!response.ok) { setError(data.error || "Could not sign in."); setBusy(false); return; } window.location.assign(returnTo); }
  return <main className="s17-auth"><section><span>S17</span><h1>{register ? "Create your Studio17 account" : "Welcome back"}</h1><p>{register ? "Start sharing music with your own Studio17 account." : "Sign in with your Studio17 email and password."}</p><form onSubmit={submit}>{register && <label>Name<input name="displayName" required maxLength={60} autoComplete="name" /></label>}<label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" required minLength={10} maxLength={200} autoComplete={register ? "new-password" : "current-password"} /></label>{error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button></form><button className="s17-auth-toggle" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Already have an account? Sign in" : "New to Studio17? Create an account"}</button></section></main>;
}
