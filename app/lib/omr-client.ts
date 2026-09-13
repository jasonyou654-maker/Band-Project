import type { MusicProcessingResult } from "./providers/types";

export const MAX_SCORE_BYTES = 25 * 1024 * 1024;
export const SCORE_ACCEPT = ".pdf,.musicxml,.xml,.png,.jpg,.jpeg";

const DIRECT_XML_EXTENSIONS = new Set(["musicxml", "xml"]);
const OMR_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg"]);

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

function processingEndpoint(): string {
  const publicProcessor = process.env.NEXT_PUBLIC_MUSIC_PROCESSOR_URL?.replace(/\/$/, "");
  if (publicProcessor) return `${publicProcessor}/omr`;
  return "/api/omr";
}

export async function recognizeScore(file: File): Promise<MusicProcessingResult> {
  validateScoreFile(file);
  const browserFallback = async () => (await import("./browser-omr")).recognizeScoreInBrowser(file);
  if (process.env.NEXT_PUBLIC_STATIC_SITE === "true" && !process.env.NEXT_PUBLIC_MUSIC_PROCESSOR_URL) {
    return browserFallback();
  }
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
      return browserFallback();
    }
    return browserFallback();
  }

  const payload = await response.json().catch(() => ({})) as Partial<MusicProcessingResult> & { error?: string; detail?: string };
  if (!response.ok || !payload.musicXml) {
    return browserFallback();
  }
  if (payload.mode !== "real") {
    return browserFallback();
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
