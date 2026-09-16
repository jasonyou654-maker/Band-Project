import { requirePrivateTranscriptionUser } from "@/app/lib/transcription-access";
import AdminOverview from "./overview";

const isStaticExport = process.env.GITHUB_PAGES === "true";
export const dynamic = isStaticExport ? "force-static" : "force-dynamic";

export default async function AdminTranscriptionPage() {
  if (isStaticExport) return <main className="private-workspace"><section className="private-upload"><h1>管理员工具仅在完整服务中可用</h1></section></main>;
  const user = await requirePrivateTranscriptionUser();
  if (!user.isAdmin) return <main className="private-workspace"><section className="private-upload"><h1>访问受限</h1><p>此页面仅供转录系统管理员使用。</p></section></main>;
  return <AdminOverview />;
}
