import Link from "next/link";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { ensureUserProfile, toPublicProfile } from "@/app/lib/studio17-data";
import { sitePath } from "@/app/lib/site-path";
import { StudioAvatar } from "./StudioAvatar";

export async function StudioHeader({ active }: { active?: "explore" | "library" | "upload" | "ai" | "account" }) {
  const identity = await getChatGPTUser();
  let profile = null;
  if (identity) {
    try { profile = toPublicProfile(await ensureUserProfile(identity)); } catch { profile = null; }
  }
  return <header className="s17-header">
    <Link className="s17-brand" href={sitePath("/")}><span>S17</span><b>Studio17</b></Link>
    <nav aria-label="Primary navigation">
      <Link className={active === "explore" ? "active" : ""} href={sitePath("/")}>Explore</Link>
      <Link className={active === "library" ? "active" : ""} href={sitePath("/library")}>My Library</Link>
      <Link className={active === "upload" ? "active" : ""} href={sitePath("/upload")}>Upload</Link>
      <Link className={active === "ai" ? "active" : ""} href={sitePath("/transcription")}>AI Transcription</Link>
    </nav>
    <div className="s17-account-nav">
      {identity ? <>
        <Link className="s17-account-link" href={sitePath("/account")}><StudioAvatar name={profile?.displayName || identity.displayName} src={profile?.avatarUrl} size="small"/><span>{profile?.displayName || identity.displayName}</span></Link>
        <Link className="s17-signout" href={chatGPTSignOutPath("/")}>Log out</Link>
      </> : <Link className="s17-signin" href={chatGPTSignInPath("/account")}>Sign in / Register</Link>}
    </div>
  </header>;
}
