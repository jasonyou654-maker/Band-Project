import { FallbackTranscriptionProvider, HttpOMRProvider, HttpTranscriptionProvider, UnavailableOMRProvider } from "./http-providers";
import type { OMRProvider, TranscriptionProvider } from "./types";

export function getOMRProvider(): OMRProvider {
  const endpoint = process.env.MUSIC_PROCESSOR_URL;
  return endpoint ? new HttpOMRProvider(`${endpoint.replace(/\/$/, "")}/omr`) : new UnavailableOMRProvider();
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const endpoint = process.env.MUSIC_PROCESSOR_URL;
  return endpoint ? new HttpTranscriptionProvider(`${endpoint.replace(/\/$/, "")}/transcribe`) : new FallbackTranscriptionProvider();
}
