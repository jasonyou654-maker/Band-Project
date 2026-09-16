type StoredObject = { text(): Promise<string> };
type PrivateObjectStore = {
  put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<StoredObject | null>;
  delete(keys: string | string[]): Promise<void>;
};

type RuntimeEnv = { FILES?: PrivateObjectStore };

export function privateTranscriptionStore(): PrivateObjectStore {
  const env = (globalThis as typeof globalThis & { env?: RuntimeEnv }).env;
  if (!env?.FILES) throw new Error("Private file storage is unavailable.");
  return env.FILES;
}

export function privateObjectKey(ownerEmail: string, jobId: string, name: string): string {
  const safeOwner = encodeURIComponent(ownerEmail.toLowerCase());
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "audio";
  return `private-transcriptions/${safeOwner}/${jobId}/${safeName}`;
}
