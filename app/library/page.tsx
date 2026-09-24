import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { StudioHeader } from "@/app/components/StudioHeader";
import LibraryView from "./view";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";

export default async function LibraryPage() {
  if (isStaticExport) return <main className="s17-runtime-note"><h1>My Library requires the full Studio17 app.</h1></main>;
  await requireChatGPTUser("/library");
  return <><StudioHeader active="library"/><LibraryView/></>;
}

