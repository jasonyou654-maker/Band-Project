import { FallbackOMRProvider, FallbackTranscriptionProvider, HttpOMRProvider, HttpTranscriptionProvider } from "./http-providers";
import type { OMRProvider, TranscriptionProvider } from "./types";

export function getOMRProvider(): OMRProvider {
  const endpoint = process.env.MUSIC_PROCESSOR_URL;
  return endpoint ? new HttpOMRProvider(`${endpoint.replace(/\/$/, "")}/omr`) : new FallbackOMRProvider();
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const endpoint = process.env.MUSIC_PROCESSOR_URL;
  return endpoint ? new HttpTranscriptionProvider(`${endpoint.replace(/\/$/, "")}/transcribe`) : new FallbackTranscriptionProvider();
}
