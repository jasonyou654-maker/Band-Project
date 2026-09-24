import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { StudioHeader } from "@/app/components/StudioHeader";
import StudioUploadForm from "./upload-form";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";

export default async function UploadPage() {
  if (isStaticExport) return <main className="s17-runtime-note"><h1>Publishing requires the full Studio17 app.</h1><p>The existing local upload preview remains available on the Explore page.</p></main>;
  await requireChatGPTUser("/upload");
  return <><StudioHeader active="upload"/><main className="s17-upload-page">
    <header><span>PUBLISH TO STUDIO17</span><h1>Share a score with context.</h1><p>Structured metadata makes your arrangement easier to discover, understand and credit.</p></header>
    <StudioUploadForm/>
  </main></>;
}

