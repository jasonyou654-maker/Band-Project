import { requireChatGPTUser } from "@/app/chatgpt-auth";
import ScoreReview from "./review";

export const dynamic = "force-dynamic";

export default async function ScoreReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChatGPTUser(`/transcription/${id}`);
  return <ScoreReview id={id} />;
}
