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
const TRANSCRIPTION_JOB_STORAGE_PREFIX = "bandproject:transcription-job:";

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
  // Retain the remote job id across a dropped connection, page reload, or
  // browser restart. The
  // audio itself stays in the user's browser and is only uploaded again if the
  // worker explicitly reports that it restarted and lost the job.
  const storageKey = `${TRANSCRIPTION_JOB_STORAGE_PREFIX}${file.name}:${file.size}:${file.lastModified}:${options.targetInstrument}:${options.sourceType || "unknown"}`;
  const getSavedJob = () => {
    try { return window.localStorage.getItem(storageKey); } catch { return null; }
  };
  const saveJob = (jobId: string) => {
    try { window.localStorage.setItem(storageKey, jobId); } catch { /* storage is optional */ }
  };
  const clearSavedJob = () => {
    try { window.localStorage.removeItem(storageKey); } catch { /* storage is optional */ }
  };

  if (!processor) {
    const response = await fetch("/api/transcribe", { method: "POST", body: createRequestBody() });
    const payload = await response.json().catch(() => ({})) as MusicProcessingResult & { error?: string };
    if (!response.ok || !payload.musicXml) throw new Error(payload.error || "转录服务没有返回真实的 MusicXML。");
    return payload;
  }

  const enqueue = async () => {
    let queued: Response;
    try {
      queued = await fetch(`${processor}/transcribe/jobs`, {
        method: "POST",
        body: createRequestBody(),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new Error("无法连接扒谱服务。免费服务可能正在启动，请稍后重试。");
    }
    const payload = await queued.json().catch(() => ({})) as { jobId?: string; error?: string };
    if (!queued.ok || !payload.jobId) throw new Error(payload.error || "扒谱服务无法创建任务。");
    return payload.jobId;
  };

  let jobId = getSavedJob() || await enqueue();
  saveJob(jobId);
  let restartRetries = 0;
  let connectionFailures = 0;
  options.onStatus?.("queued");

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 1500));
    let response: Response;
    try {
      response = await fetch(`${processor}/transcribe/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    } catch {
      connectionFailures += 1;
      if (connectionFailures <= 3) continue;
      throw new Error("与扒谱服务的连接持续中断。当前任务进度已保存；恢复网络后重新选择同一文件即可继续查询。");
    }
    connectionFailures = 0;
    const payload = await response.json().catch(() => ({})) as MusicProcessingResult & { status?: string; error?: string; stage?: string };
    if (payload.status === "completed" && payload.musicXml) {
      clearSavedJob();
      return payload;
    }
    if (payload.status === "transcribing" || payload.stage === "transcribing") options.onStatus?.("transcribing");
    if (response.status === 404 && restartRetries < 1) {
      // Render's free instance can restart while a job is running. Its queue is
      // intentionally in-memory, so submit the original audio once more rather
      // than turning a lost job into a fabricated result or a dead-end error.
      restartRetries += 1;
      jobId = await enqueue();
      saveJob(jobId);
      options.onStatus?.("queued");
      continue;
    }
    if (payload.status === "failed" || !response.ok) throw new Error(payload.error || "扒谱服务未能生成真实乐谱。");
  }
  throw new Error("扒谱任务仍在处理中，当前进度已保存；请稍后用同一文件继续查询。系统不会以虚拟音符代替真实结果。");
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
