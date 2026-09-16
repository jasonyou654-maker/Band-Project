import { requireChatGPTUser } from "@/app/chatgpt-auth";
import TranscriptionWorkspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function PrivateTranscriptionPage() {
  const user = await requireChatGPTUser("/transcription");
  return <TranscriptionWorkspace email={user.email} />;
}
