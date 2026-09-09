/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/sheets") return handleSheets(request, env);

    if (request.method === "POST" && (url.pathname === "/api/omr" || url.pathname === "/api/transcribe") && env.FILES) {
      const clone = request.clone();
      ctx.waitUntil(storeUploadedSource(clone, env.FILES, url.pathname === "/api/omr" ? "scores" : "audio"));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

const createSheetsTable = `CREATE TABLE IF NOT EXISTS sheets (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
  instrument TEXT NOT NULL, genre TEXT NOT NULL, difficulty TEXT NOT NULL,
  musical_key TEXT NOT NULL, bpm INTEGER NOT NULL, uploader TEXT NOT NULL,
  avatar TEXT NOT NULL, accent TEXT NOT NULL, music_xml TEXT NOT NULL,
  processing_mode TEXT NOT NULL, processing_provider TEXT NOT NULL,
  processing_warnings TEXT NOT NULL, source_object_key TEXT, created_at INTEGER NOT NULL
)`;

async function handleSheets(request: Request, env: Env) {
  if (!env.DB) {
    if (request.method === "GET") return Response.json({ sheets: [], storage: "browser-fallback" });
    const sheet = await request.json();
    return Response.json({ sheet, persisted: false, storage: "browser-fallback" });
  }
  await env.DB.prepare(createSheetsTable).run();
  if (request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM sheets ORDER BY created_at DESC LIMIT 100").all<Record<string, unknown>>();
    const sheets = result.results.map(row => ({ id: Number(row.id), title: String(row.title), artist: String(row.artist), instrument: String(row.instrument), genre: String(row.genre), difficulty: String(row.difficulty), key: String(row.musical_key), bpm: Number(row.bpm), uploader: String(row.uploader), avatar: String(row.avatar), accent: String(row.accent), musicXml: String(row.music_xml), processingMode: row.processing_mode === "real" ? "real" : "fallback", processingProvider: String(row.processing_provider), processingWarnings: safeWarnings(row.processing_warnings) }));
    return Response.json({ sheets, storage: "D1" });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const sheet = await request.json() as Record<string, unknown>;
  if (!String(sheet.title || "").trim() || !String(sheet.musicXml || "").includes("<score-")) return Response.json({ error: "Title and valid MusicXML are required." }, { status: 400 });
  await env.DB.prepare("INSERT OR REPLACE INTO sheets (id,title,artist,instrument,genre,difficulty,musical_key,bpm,uploader,avatar,accent,music_xml,processing_mode,processing_provider,processing_warnings,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(sheet.id, sheet.title, sheet.artist, sheet.instrument, sheet.genre, sheet.difficulty, sheet.key, sheet.bpm, sheet.uploader, sheet.avatar, sheet.accent, sheet.musicXml, sheet.processingMode, sheet.processingProvider, JSON.stringify(sheet.processingWarnings || []), Date.now()).run();
  return Response.json({ sheet, persisted: true, storage: "D1" });
}

async function storeUploadedSource(request: Request, bucket: R2Bucket, kind: string) {
  try {
    const data = await request.formData(); const file = data.get("file");
    if (!(file instanceof File)) return;
    const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
    await bucket.put(`${kind}/${Date.now()}-${crypto.randomUUID()}-${safeName}`, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { originalName: file.name } });
  } catch { /* Processing can continue even when archival storage is unavailable. */ }
}

function safeWarnings(value: unknown): string[] { try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }

export default worker;
