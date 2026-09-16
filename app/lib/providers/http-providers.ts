import type { MusicProcessingResult, OMRProvider, TranscriptionOptions, TranscriptionProvider } from "./types";

abstract class HttpProcessingProvider {
  abstract readonly name: string;
  constructor(private endpoint: string) {}
  protected async process(file: File, fields: Record<string, string> = {}): Promise<MusicProcessingResult> {
    const body = new FormData(); body.append("file", file);
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
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
  transcribe(file: File, options: TranscriptionOptions = {}) {
    return this.process(file, {
      target_instrument: options.targetInstrument || "auto",
      source_type: options.sourceType || "unknown",
      strict_rhythm: String(options.strictRhythm || false),
    });
  }
}

export class UnavailableOMRProvider implements OMRProvider {
  readonly name = "OMR unavailable";
  async recognize(file: File): Promise<MusicProcessingResult> {
    void file;
    throw new Error("OMR processor is not configured. Set MUSIC_PROCESSOR_URL to a running BandProject music processor.");
  }
}

export class FallbackTranscriptionProvider implements TranscriptionProvider {
  readonly name = "Transcription fallback";
  async transcribe(file: File, options?: TranscriptionOptions) { void file; void options; return { provider: "Transcription unavailable", mode: "fallback" as const, warnings: ["Basic Pitch is not configured, so no notes or MusicXML were generated."] }; }
}
