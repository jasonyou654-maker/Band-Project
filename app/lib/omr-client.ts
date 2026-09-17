import type { MusicProcessingResult } from "./providers/types";

export const MAX_SCORE_BYTES = 25 * 1024 * 1024;
export const SCORE_ACCEPT = ".pdf,.musicxml,.xml,.png,.jpg,.jpeg";

const DIRECT_XML_EXTENSIONS = new Set(["musicxml", "xml"]);
const OMR_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg"]);
const STATIC_PROCESSOR_URL = "https://bandproject-music-processor.onrender.com";

function extension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() || "";
}

export function validateScoreFile(file: File): void {
  const ext = extension(file);
  if (!DIRECT_XML_EXTENSIONS.has(ext) && !OMR_EXTENSIONS.has(ext)) {
    throw new Error("请选择 PDF、PNG、JPG 或 MusicXML 乐谱文件。");
  }
  if (file.size === 0) throw new Error("这个文件是空的，请重新选择乐谱。");
  if (file.size > MAX_SCORE_BYTES) throw new Error("乐谱文件不能超过 25 MB。");
}

export function isDirectMusicXml(file: File): boolean {
  return DIRECT_XML_EXTENSIONS.has(extension(file));
}

function publicProcessorUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_MUSIC_PROCESSOR_URL?.replace(/\/$/, "")
    || (process.env.NEXT_PUBLIC_STATIC_SITE === "true" ? STATIC_PROCESSOR_URL : undefined);
}

function processingEndpoint(): string {
  const publicProcessor = publicProcessorUrl();
  if (publicProcessor) return `${publicProcessor}/omr`;
  return "/api/omr";
}

async function recognizeWithQueuedProcessor(file: File, processor: string): Promise<MusicProcessingResult> {
  const body = new FormData();
  body.append("file", file);
  let queued: Response;
  try {
    queued = await fetch(`${processor}/omr/jobs`, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("无法连接 Audiveris 服务。识谱服务可能正在唤醒，请稍后刷新页面重试。");
  }
  const queuedPayload = await queued.json().catch(() => ({})) as { jobId?: string; status?: string; error?: string };
  if (!queued.ok || !queuedPayload.jobId) {
    throw new Error(queuedPayload.error || "OMR 服务无法创建识谱任务。");
  }

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 1500));
    let result: Response;
    try {
      result = await fetch(`${processor}/omr/jobs/${encodeURIComponent(queuedPayload.jobId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new Error("与 Audiveris 服务的连接中断。识谱任务可能仍在服务器运行，请稍后刷新查看。");
    }
    const payload = await result.json().catch(() => ({})) as Partial<MusicProcessingResult> & { status?: string; error?: string };
    if (payload.status === "completed" && payload.musicXml) return payload as MusicProcessingResult;
    if (payload.status === "failed" || !result.ok) throw new Error(payload.error || "Audiveris 无法识别这份乐谱。");
  }
  throw new Error("这份乐谱识别时间较长，任务仍在服务器处理中，请稍后重试。系统不会用简化谱覆盖完整识谱结果。");
}

export async function recognizeScore(file: File): Promise<MusicProcessingResult> {
  validateScoreFile(file);
  const publicProcessor = publicProcessorUrl();
  if (process.env.NEXT_PUBLIC_STATIC_SITE === "true" && !publicProcessor) {
    throw new Error("未配置 Audiveris 服务。请为网站设置 NEXT_PUBLIC_MUSIC_PROCESSOR_URL 后再上传乐谱。");
  }
  if (publicProcessor) return recognizeWithQueuedProcessor(file, publicProcessor);
  const body = new FormData();
  body.append("file", file);

  const endpoint = processingEndpoint();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Audiveris 识谱超时。请检查处理服务状态，或使用分辨率更高、页数更少的乐谱。");
    }
    throw new Error("无法连接 Audiveris 识谱服务。请确认 MUSIC_PROCESSOR_URL 已配置且服务正在运行。");
  }

  const payload = await response.json().catch(() => ({})) as Partial<MusicProcessingResult> & { error?: string; detail?: string };
  if (!response.ok || !payload.musicXml) {
    throw new Error(payload.error || payload.detail || "Audiveris 未能从这份乐谱生成 MusicXML。");
  }
  return payload as MusicProcessingResult;
}

export function scoreFileKind(file: File): "MusicXML" | "PDF" | "Image" {
  const ext = extension(file);
  if (DIRECT_XML_EXTENSIONS.has(ext)) return "MusicXML";
  return ext === "pdf" ? "PDF" : "Image";
}

export function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
