import { getTranscriptionProvider } from "@/app/lib/providers/resolve";

export async function POST(request: Request) {
  try {
    const body = await request.formData(); const file = body.get("file");
    if (!(file instanceof File)) return Response.json({ error: "An audio file is required." }, { status: 400 });
    if (file.size > 50 * 1024 * 1024) return Response.json({ error: "Audio files must be 50 MB or smaller." }, { status: 413 });
    return Response.json(await getTranscriptionProvider().transcribe(file));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Transcription failed." }, { status: 502 }); }
}
