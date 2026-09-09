export type ProcessingMode = "real" | "fallback";

export type MusicProcessingResult = {
  musicXml: string;
  provider: string;
  mode: ProcessingMode;
  warnings: string[];
  midiBase64?: string;
  noteEvents?: { pitch: number; start: number; end: number; velocity?: number }[];
};

export interface OMRProvider {
  readonly name: string;
  recognize(file: File): Promise<MusicProcessingResult>;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(file: File): Promise<MusicProcessingResult>;
}
