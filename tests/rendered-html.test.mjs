import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

test("server renders the BandProject community", async () => {
  const response = await render();
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<title>BandProject/i);
  assert.match(html, /Play something/);
  assert.match(html, /AI Analysis/i);
  assert.match(html, /Sheets for your next session/i);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("OMR API exposes an explicit MusicXML fallback when no processor is configured", async () => {
  const app = await worker();
  const body = new FormData();
  body.append("file", new Blob(["not-a-real-image"], { type: "image/png" }), "score.png");
  const response = await app.fetch(new Request("http://localhost/api/omr", { method: "POST", body }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.mode, "fallback");
  assert.match(payload.musicXml, /<score-partwise/);
  assert.match(payload.warnings[0], /not configured/i);
});

test("transcription API exposes an explicit fallback instead of claiming Basic Pitch ran", async () => {
  const app = await worker();
  const body = new FormData();
  body.append("file", new Blob(["audio"], { type: "audio/wav" }), "take.wav");
  const response = await app.fetch(new Request("http://localhost/api/transcribe", { method: "POST", body }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  const payload = await response.json();
  assert.equal(payload.mode, "fallback");
  assert.match(payload.warnings[0], /not configured/i);
});

test("sheet data API degrades to browser storage only when D1 is unavailable", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/api/sheets"), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.storage, "browser-fallback");
  assert.deepEqual(payload.sheets, []);
});
