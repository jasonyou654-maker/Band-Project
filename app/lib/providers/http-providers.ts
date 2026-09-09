import { demoMusicXml } from "../musicxml";
import type { MusicProcessingResult, OMRProvider, TranscriptionProvider } from "./types";

abstract class HttpProcessingProvider {
  abstract readonly name: string;
  constructor(private endpoint: string) {}
  protected async process(file: File): Promise<MusicProcessingResult> {
    const body = new FormData(); body.append("file", file);
    const response = await fetch(this.endpoint, { method: "POST", body, signal: AbortSignal.timeout(300_000) });
    const payload = await response.json() as MusicProcessingResult & { error?: string };
    if (!response.ok || !payload.musicXml) throw new Error(payload.error || `${this.name} did not return MusicXML.`);
    return payload;
  }
}

export class HttpOMRProvider extends HttpProcessingProvider implements OMRProvider {
  readonly name = "Audiveris";
  recognize(file: File) { return this.process(file); }
}

export class HttpTranscriptionProvider extends HttpProcessingProvider implements TranscriptionProvider {
  readonly name = "Basic Pitch";
  transcribe(file: File) { return this.process(file); }
}

export class FallbackOMRProvider implements OMRProvider {
  readonly name = "OMR fallback";
  async recognize(file: File) { return fallback(file, "OMR processor is not configured. This preview is a clearly marked sample score, not a recognition result."); }
}

export class FallbackTranscriptionProvider implements TranscriptionProvider {
  readonly name = "Transcription fallback";
  async transcribe(file: File) { return fallback(file, "Basic Pitch is not configured. This preview is a clearly marked sample score, not an audio transcription."); }
}

function fallback(file: File, warning: string): MusicProcessingResult {
  const title = file.name.replace(/\.[^/.]+$/, "");
  return { musicXml: demoMusicXml(title, "Piano", 96, file.size), provider: "BandProject fallback", mode: "fallback", warnings: [warning] };
}
