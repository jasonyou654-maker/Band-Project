export type ProcessingMode = "real" | "fallback";

export type MusicProcessingResult = {
  musicXml?: string;
  provider: string;
  mode: ProcessingMode;
  warnings: string[];
  midiBase64?: string;
  noteEvents?: { pitch: number; start: number; end: number; velocity?: number; confidence?: number | null; source?: string; inferred?: boolean }[];
  rawNoteEvents?: { pitch: number; start: number; end: number; velocity?: number; confidence?: number | null; source?: string }[];
  beatGrid?: { bpm?: number | null; beats_seconds?: number[]; time_signature?: [number, number] | null; confidence?: number | null };
  notation?: { quantized?: boolean; measureCount?: number | null };
  stage?: string;
  pipeline?: { transcriber?: string; separator?: string | null; parameters?: Record<string, unknown>; processing_seconds?: number | null } | null;
};

export interface OMRProvider {
  readonly name: string;
  recognize(file: File): Promise<MusicProcessingResult>;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(file: File, options?: TranscriptionOptions): Promise<MusicProcessingResult>;
}

export type TranscriptionOptions = {
  targetInstrument?: string;
  sourceType?: "isolated" | "mix" | "unknown";
  strictRhythm?: boolean;
};
