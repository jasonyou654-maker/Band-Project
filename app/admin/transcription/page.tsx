import { requirePrivateTranscriptionUser } from "@/app/lib/transcription-access";
import AdminOverview from "./overview";

export const dynamic = "force-dynamic";

export default async function AdminTranscriptionPage() {
  const user = await requirePrivateTranscriptionUser();
  if (!user.isAdmin) return <main className="private-workspace"><section className="private-upload"><h1>访问受限</h1><p>此页面仅供转录系统管理员使用。</p></section></main>;
  return <AdminOverview />;
}
