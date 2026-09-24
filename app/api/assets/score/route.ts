import { getChatGPTUser } from "@/app/chatgpt-auth";
import { privateTranscriptionStore } from "@/app/lib/private-transcription-storage";
import { validateScoreFile } from "@/app/lib/omr-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Sign in to upload a score." }, { status: 401 });
  try {
    const body = await request.formData();
    const file = body.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a score file." }, { status: 400 });
    validateScoreFile(file);
    const safeOwner = encodeURIComponent(identity.email.toLowerCase());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "score";
    const key = `score-assets/${safeOwner}/${crypto.randomUUID()}/${safeName}`;
    await privateTranscriptionStore().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    return Response.json({ sourceObjectKey: key, filename: file.name }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not store this score." }, { status: 503 });
  }
}

