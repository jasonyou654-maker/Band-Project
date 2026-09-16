import { requireChatGPTUser } from "@/app/chatgpt-auth";
import TranscriptionWorkspace from "./workspace";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";

export default async function PrivateTranscriptionPage() {
  if (isStaticExport) return <main className="private-workspace"><section className="private-upload"><h1>私人扒谱需要完整服务</h1><p>GitHub Pages 仅提供本地音频分析，不保存音频、任务或私人乐谱。</p></section></main>;
  const user = await requireChatGPTUser("/transcription");
  return <TranscriptionWorkspace email={user.email} />;
}
