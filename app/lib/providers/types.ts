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
  notation?: { quantized?: boolean; measureCount?: number | null; rhythmMode?: "metered" | "free" | null };
  stage?: string;
  pipeline?: { transcriber?: string; separator?: string | null; parameters?: Record<string, unknown>; processing_seconds?: number | null } | null;
  analysis?: {
    duration?: number | null;
    bpm?: number | null;
    tempoConfidence: number;
    key?: string | null;
    mode?: "major" | "minor" | null;
    keyConfidence: number;
    timeSignature?: [number, number] | null;
    chords: string[];
    chordConfidence: number;
    instruments: { name: string; confidence: number }[];
    sections: { name: string; start: number; color: string }[];
    noteCount: number;
    provider: string;
  };
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
