import type { MusicProcessingResult } from "./providers/types";

const STATIC_PROCESSOR_URL = "https://bandproject-music-processor.onrender.com";

function publicProcessorUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_MUSIC_PROCESSOR_URL?.replace(/\/$/, "")
    || (process.env.NEXT_PUBLIC_STATIC_SITE === "true" ? STATIC_PROCESSOR_URL : undefined);
}

export async function transcribeAudio(file: File, options: { targetInstrument: string; sourceType?: "isolated" | "mix" | "unknown" }): Promise<MusicProcessingResult> {
  const processor = publicProcessorUrl();
  const body = new FormData();
  body.append("file", file);
  body.append("target_instrument", options.targetInstrument);
  body.append("source_type", options.sourceType || "unknown");

  if (!processor) {
    const response = await fetch("/api/transcribe", { method: "POST", body });
    const payload = await response.json().catch(() => ({})) as MusicProcessingResult & { error?: string };
    if (!response.ok || !payload.musicXml) throw new Error(payload.error || "转录服务没有返回真实的 MusicXML。");
    return payload;
  }

  let queued: Response;
  try {
    queued = await fetch(`${processor}/transcribe/jobs`, { method: "POST", body, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error("无法连接扒谱服务。服务可能正在启动，请稍后重试。");
  }
  const queuedPayload = await queued.json().catch(() => ({})) as { jobId?: string; error?: string };
  if (!queued.ok || !queuedPayload.jobId) throw new Error(queuedPayload.error || "扒谱服务无法创建任务。");

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 1500));
    let response: Response;
    try {
      response = await fetch(`${processor}/transcribe/jobs/${encodeURIComponent(queuedPayload.jobId)}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new Error("与扒谱服务的连接中断。任务可能仍在处理中，请稍后重试。");
    }
    const payload = await response.json().catch(() => ({})) as MusicProcessingResult & { status?: string; error?: string };
    if (payload.status === "completed" && payload.musicXml) return payload;
    if (payload.status === "failed" || !response.ok) throw new Error(payload.error || "扒谱服务未能生成真实乐谱。 ");
  }
  throw new Error("扒谱任务仍在处理中，请稍后重试。系统不会以虚拟音符代替真实结果。");
}

export function hasPublicTranscriptionProcessor(): boolean {
  return Boolean(publicProcessorUrl());
}
