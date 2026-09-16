import { requireChatGPTUser } from "@/app/chatgpt-auth";
import ScoreReview from "./review";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";
export const dynamicParams = false;
export function generateStaticParams() { return []; }

export default async function ScoreReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (isStaticExport) return <main className="private-workspace"><section className="private-upload"><h1>私人乐谱仅在完整服务中可用</h1></section></main>;
  const { id } = await params;
  await requireChatGPTUser(`/transcription/${id}`);
  return <ScoreReview id={id} />;
}
