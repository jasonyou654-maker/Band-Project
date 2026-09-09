type SheetPayload = {
  id?: number;
  title?: string;
  artist?: string;
  instrument?: string;
  genre?: string;
  difficulty?: string;
  key?: string;
  bpm?: number;
  uploader?: string;
  avatar?: string;
  accent?: string;
  musicXml?: string;
  processingMode?: string;
  processingProvider?: string;
  processingWarnings?: string[];
};

function toClientSheet(row: {
  id: number; title: string; artist: string; instrument: string; genre: string;
  difficulty: string; musicalKey: string; bpm: number; uploader: string; avatar: string;
  accent: string; musicXml: string; processingMode: string; processingProvider: string;
  processingWarnings: string;
}) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    instrument: row.instrument,
    genre: row.genre,
    difficulty: row.difficulty,
    key: row.musicalKey,
    bpm: row.bpm,
    uploader: row.uploader,
    avatar: row.avatar,
    accent: row.accent,
    musicXml: row.musicXml,
    processingMode: row.processingMode,
    processingProvider: row.processingProvider,
    processingWarnings: JSON.parse(row.processingWarnings) as string[],
  };
}

function unavailable() {
  return Response.json({ sheets: [], storage: "browser-fallback" });
}

export async function GET() {
  try {
    // Keep the D1-only module out of local/static renders where the Cloudflare
    // runtime protocol is not available; the browser fallback remains usable.
    const [{ getDb }, { sheets }, { desc }] = await Promise.all([
      import("@/db"), import("@/db/schema"), import("drizzle-orm"),
    ]);
    const rows = await getDb().select().from(sheets).orderBy(desc(sheets.createdAt));
    return Response.json({ sheets: rows.map(toClientSheet), storage: "d1" });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  let payload: SheetPayload;
  try {
    payload = await request.json() as SheetPayload;
  } catch {
    return Response.json({ error: "A valid JSON sheet payload is required." }, { status: 400 });
  }

  const required = ["title", "artist", "instrument", "genre", "difficulty", "key", "uploader", "avatar", "accent", "musicXml"] as const;
  if (required.some(field => typeof payload[field] !== "string" || !payload[field]?.trim())) {
    return Response.json({ error: "Sheet title, metadata, and MusicXML are required." }, { status: 400 });
  }

  const id = Number.isSafeInteger(payload.id) ? payload.id as number : Date.now();
  const bpm = Number.isFinite(payload.bpm) ? Math.max(1, Math.round(payload.bpm as number)) : 96;
  try {
    const [{ getDb }, { sheets }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    await getDb().insert(sheets).values({
      id,
      title: payload.title!.trim(),
      artist: payload.artist!.trim(),
      instrument: payload.instrument!.trim(),
      genre: payload.genre!.trim(),
      difficulty: payload.difficulty!.trim(),
      musicalKey: payload.key!.trim(),
      bpm,
      uploader: payload.uploader!.trim(),
      avatar: payload.avatar!.trim(),
      accent: payload.accent!.trim(),
      musicXml: payload.musicXml!,
      processingMode: payload.processingMode || "real",
      processingProvider: payload.processingProvider || "Unknown",
      processingWarnings: JSON.stringify(payload.processingWarnings || []),
      createdAt: Date.now(),
    });
    return Response.json({ persisted: true, storage: "d1" });
  } catch {
    return Response.json({ persisted: false, storage: "browser-fallback" });
  }
}
