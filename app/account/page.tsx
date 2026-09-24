import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { ensureUserProfile, toPublicProfile } from "@/app/lib/studio17-data";
import { StudioHeader } from "@/app/components/StudioHeader";
import ProfileEditor from "./profile-editor";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";

export default async function AccountPage() {
  if (isStaticExport) return <main className="s17-runtime-note"><h1>Studio17 accounts require the full app.</h1><p>Open the hosted Studio17 version to sign in and manage your profile.</p></main>;
  const identity = await requireChatGPTUser("/account");
  const profile = toPublicProfile(await ensureUserProfile(identity));
  return <><StudioHeader active="account"/><main className="s17-account-page">
    <section className="s17-account-intro"><span>STUDIO17 IDENTITY</span><h1>Your musician profile.</h1><p>This is how your uploads and arrangements appear across Studio17.</p></section>
    <ProfileEditor email={identity.email} initial={profile}/>
  </main></>;
}

