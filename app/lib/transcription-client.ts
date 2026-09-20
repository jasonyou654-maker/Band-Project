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
  const createRequestBody = () => {
    const body = new FormData();
    body.append("file", file);
    body.append("target_instrument", options.targetInstrument);
    body.append("source_type", options.sourceType || "unknown");
    body.append("strict_rhythm", "true");
    return body;
  };
  if (!processor) {
    const response = await fetch("/api/transcribe", { method: "POST", body: createRequestBody() });
    const payload = await response.json().catch(() => ({})) as MusicProcessingResult & { error?: string };
    if (!response.ok || !payload.musicXml) throw new Error(payload.error || "转录服务没有返回真实的 MusicXML。");
    return payload;
  }

  // A queued job can disappear if a single-worker service is recycled between
  // POST and polling. Keep upload and result in one request instead.
  options.onStatus?.("transcribing");
  let response: Response;
  try {
    response = await fetch(`${processor}/transcribe`, {
      method: "POST",
      body: createRequestBody(),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new Error("无法完成扒谱请求。处理服务可能正在启动或重启，请重新上传；音频不会被保存或发布。");
  }
  const payload = await response.json().catch(() => ({})) as MusicProcessingResult & { detail?: string; error?: string };
  if (!response.ok) throw new Error(payload.detail || payload.error || "扒谱服务未能生成真实乐谱。");
  if (!payload.musicXml || !payload.noteEvents?.length || !payload.analysis) {
    throw new Error("扒谱服务返回了不完整结果：缺少音符、音乐分析或 MusicXML。");
  }
  return payload;
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
