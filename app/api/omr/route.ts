import { getOMRProvider } from "@/app/lib/providers/resolve";

export async function POST(request: Request) {
  try {
    const body = await request.formData(); const file = body.get("file");
    if (!(file instanceof File)) return Response.json({ error: "A score file is required." }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return Response.json({ error: "Score files must be 25 MB or smaller." }, { status: 413 });
    return Response.json(await getOMRProvider().recognize(file));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "OMR processing failed." }, { status: 502 }); }
}
