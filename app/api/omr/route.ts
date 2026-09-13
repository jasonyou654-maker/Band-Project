import { getOMRProvider } from "@/app/lib/providers/resolve";

const MAX_SCORE_BYTES = 25 * 1024 * 1024;
const SCORE_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg"]);

export async function POST(request: Request) {
  try {
    const body = await request.formData(); const file = body.get("file");
    if (!(file instanceof File)) return Response.json({ error: "A score file is required." }, { status: 400 });
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!SCORE_EXTENSIONS.has(extension)) return Response.json({ error: "OMR accepts PDF, PNG, JPG, and JPEG files." }, { status: 415 });
    if (file.size === 0) return Response.json({ error: "The uploaded score is empty." }, { status: 400 });
    if (file.size > MAX_SCORE_BYTES) return Response.json({ error: "Score files must be 25 MB or smaller." }, { status: 413 });
    return Response.json(await getOMRProvider().recognize(file));
  } catch (error) {
    const message = error instanceof Error ? error.message : "OMR processing failed.";
    const status = message.includes("not configured") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
