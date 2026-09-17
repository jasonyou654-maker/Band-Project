import type { MusicProcessingResult } from "./providers/types";

export type ServerAudioAnalysis = {
  duration: number;
  bpm: number;
  tempoConfidence: number;
  key: string;
  mode: "major" | "minor";
  keyConfidence: number;
  provider: string;
  waveform: number[];
  chords: string[];
  chordConfidence: number;
  sections: { name: string; start: number; color: string }[];
  instruments: { name: string; confidence: number }[];
  warnings: string[];
};

const STATIC_PROCESSOR_URL = "https://bandproject-music-processor.onrender.com";

function publicProcessorUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_MUSIC_PROCESSOR_URL?.replace(/\/$/, "")
    || (process.env.NEXT_PUBLIC_STATIC_SITE === "true" ? STATIC_PROCESSOR_URL : undefined);
}

export async function transcribeAudio(file: File, options: { targetInstrument: string; sourceType?: "isolated" | "mix" | "unknown"; onStatus?: (status: "queued" | "transcribing") => void }): Promise<MusicProcessingResult> {
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
  options.onStatus?.("queued");

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
    if (payload.status === "transcribing") options.onStatus?.("transcribing");
    if (payload.status === "failed" || !response.ok) throw new Error(payload.error || "扒谱服务未能生成真实乐谱。");
  }
  throw new Error("扒谱任务仍在处理中，请稍后重试。系统不会以虚拟音符代替真实结果。");
}

export async function analyzeAudioOnServer(file: File): Promise<ServerAudioAnalysis | null> {
  const processor = publicProcessorUrl();
  if (!processor) return null;
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${processor}/analyze`, { method: "POST", body, signal: AbortSignal.timeout(180_000) });
  const payload = await response.json().catch(() => ({})) as ServerAudioAnalysis & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || "服务器未能完成节拍与调性分析。");
  return payload;
}

export function hasPublicTranscriptionProcessor(): boolean {
  return Boolean(publicProcessorUrl());
}
