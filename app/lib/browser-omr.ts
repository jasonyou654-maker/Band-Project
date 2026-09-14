import type { MusicProcessingResult } from "./providers/types";

type Staff = { lines: number[]; spacing: number; left: number; right: number };
type NoteGroup = { pitches: number[]; page: number; staff: number; x: number };

const TREBLE_TOP_DIATONIC = 38; // F5, where C0 is 0.
const BASS_TOP_DIATONIC = 25; // A3.
const STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"];

export async function recognizeScoreInBrowser(file: File): Promise<MusicProcessingResult> {
  const pages = file.name.toLowerCase().endsWith(".pdf") ? await renderPdf(file) : [await renderImage(file)];
  const groups: NoteGroup[] = [];
  let staffCount = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const canvas = pages[pageIndex];
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const binary = binarize(image.data, canvas.width, canvas.height);
    const staves = detectStaves(binary, canvas.width, canvas.height);
    staffCount += staves.length;
    const grandStaff = staves.length >= 2 && staves.length % 2 === 0;
    staves.forEach((staff, staffIndex) => {
      groups.push(...detectNotes(binary, canvas.width, staff, pageIndex, staffIndex, grandStaff && staffIndex % 2 === 1));
    });
  }

  if (!staffCount) throw new Error("浏览器 OMR 没有找到完整的五线谱。请使用正向、清晰、背景干净的扫描件。");
  if (!groups.length) throw new Error("已找到五线谱，但没有可靠识别到音符。请尝试更高分辨率或裁掉页面外的杂乱背景。");

  groups.sort((a, b) => a.page - b.page || a.staff - b.staff || a.x - b.x);
  return {
    musicXml: groupsToMusicXml(file.name.replace(/\.[^.]+$/, ""), groups),
    provider: "BandProject Browser OMR",
    mode: "real",
    warnings: [
      `浏览器 OMR 从 ${pages.length} 页、${staffCount} 组五线谱中识别了 ${groups.reduce((sum, group) => sum + group.pitches.length, 0)} 个音符。`,
      "浏览器识谱会保留音高和基础和弦，复杂节奏、连音、歌词与装饰音建议发布后人工核对。",
    ],
  };
}

async function renderImage(file: File): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / bitmap.width);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  }

  // Safari/WebKit and some embedded browsers may not expose createImageBitmap.
  // Use the broadly supported Image decoder so PNG, JPG, and JPEG uploads
  // still reach the same OMR pipeline.
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取图片文件，请重新选择 PNG 或 JPG 图片。"));
      element.src = objectUrl;
    });
    const scale = Math.min(1, 2200 / image.naturalWidth);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return canvas;
}

async function renderPdf(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  const bundledWorker = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  pdfjs.GlobalWorkerOptions.workerSrc = location.pathname.startsWith("/Band-Project/")
    ? bundledWorker.replace(`${location.origin}/assets/`, `${location.origin}/Band-Project/assets/`)
    : bundledWorker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWorkerFetch: true });
  const pdf = await task.promise;
  const canvases: HTMLCanvasElement[] = [];
  const pageLimit = Math.min(pdf.numPages, 8);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.4, 2200 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) continue;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    canvases.push(canvas);
  }
  // PDF.js builds used by static exports do not all expose `destroy()` on the
  // document proxy. Cleaning up is optional here: the canvases are already
  // detached from PDF.js, and letting the document be garbage-collected is
  // safer than turning a successful recognition into a runtime error.
  const documentProxy = pdf as unknown as { cleanup?: () => Promise<unknown>; destroy?: () => Promise<unknown> };
  if (typeof documentProxy.cleanup === "function") await documentProxy.cleanup();
  return canvases;
}

function binarize(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let pixel = 0, offset = 0; pixel < gray.length; pixel += 1, offset += 4) {
    const value = Math.round(rgba[offset] * .299 + rgba[offset + 1] * .587 + rgba[offset + 2] * .114);
    gray[pixel] = value;
    histogram[value] += 1;
  }
  const threshold = otsu(histogram, gray.length);
  const binary = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) binary[index] = gray[index] < Math.min(220, threshold + 18) ? 1 : 0;
  return binary;
}

function otsu(histogram: Uint32Array, total: number): number {
  let totalWeight = 0;
  for (let index = 0; index < 256; index += 1) totalWeight += index * histogram[index];
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 160;
  for (let index = 0; index < 256; index += 1) {
    backgroundWeight += histogram[index];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += index * histogram[index];
    const difference = backgroundSum / backgroundWeight - (totalWeight - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * difference * difference;
    if (variance > bestVariance) { bestVariance = variance; threshold = index; }
  }
  return threshold;
}

function detectStaves(binary: Uint8Array, width: number, height: number): Staff[] {
  const rowInk = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let ink = 0;
    for (let x = 0; x < width; x += 1) ink += binary[y * width + x];
    rowInk[y] = ink;
  }
  const candidates: number[] = [];
  let start = -1;
  for (let y = 0; y <= height; y += 1) {
    const lineLike = y < height && rowInk[y] > width * .28;
    if (lineLike && start < 0) start = y;
    if (!lineLike && start >= 0) { candidates.push(Math.round((start + y - 1) / 2)); start = -1; }
  }
  const staves: Staff[] = [];
  for (let index = 0; index <= candidates.length - 5;) {
    const lines = candidates.slice(index, index + 5);
    const gaps = lines.slice(1).map((line, gapIndex) => line - lines[gapIndex]);
    const spacing = gaps.reduce((sum, gap) => sum + gap, 0) / 4;
    if (spacing >= 5 && spacing <= 36 && gaps.every(gap => Math.abs(gap - spacing) <= Math.max(2, spacing * .28))) {
      const extents = staffExtents(binary, width, lines);
      staves.push({ lines, spacing, ...extents });
      index += 5;
    } else index += 1;
  }
  return staves;
}

function staffExtents(binary: Uint8Array, width: number, lines: number[]) {
  const votes = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) for (const y of lines) {
    for (let offset = -1; offset <= 1; offset += 1) if (binary[(y + offset) * width + x]) { votes[x] += 1; break; }
  }
  let left = 0, right = width - 1;
  while (left < right && votes[left] < 3) left += 1;
  while (right > left && votes[right] < 3) right -= 1;
  return { left, right };
}

function detectNotes(binary: Uint8Array, width: number, staff: Staff, page: number, staffIndex: number, bass: boolean): NoteGroup[] {
  const spacing = staff.spacing;
  const radiusX = Math.max(3, Math.round(spacing * .62));
  const radiusY = Math.max(2, Math.round(spacing * .38));
  const firstX = Math.round(staff.left + spacing * 5.5);
  const lastX = Math.round(staff.right - spacing);
  const candidates: { x: number; position: number; score: number }[] = [];
  const lineRows = new Set<number>();
  staff.lines.forEach(line => { lineRows.add(Math.round(line) - 1); lineRows.add(Math.round(line)); lineRows.add(Math.round(line) + 1); });

  for (let x = firstX; x <= lastX; x += Math.max(1, Math.round(spacing * .22))) {
    for (let position = -4; position <= 12; position += 1) {
      const centerY = Math.round(staff.lines[0] + position * spacing / 2);
      let ink = 0, area = 0;
      for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
        if (y < 0 || lineRows.has(y)) continue;
        for (let px = x - radiusX; px <= x + radiusX; px += 1) {
          if (px < 0 || px >= width) continue;
          ink += binary[y * width + px]; area += 1;
        }
      }
      const score = area ? ink / area : 0;
      if (score > .29) candidates.push({ x, position, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (selected.some(note => Math.abs(note.x - candidate.x) < spacing * 1.15 && Math.abs(note.position - candidate.position) <= 1)) continue;
    selected.push(candidate);
  }
  selected.sort((a, b) => a.x - b.x || a.position - b.position);

  const groups: NoteGroup[] = [];
  for (const candidate of selected) {
    let group = groups.find(item => Math.abs(item.x - candidate.x) < spacing * .8);
    const pitch = diatonicToMidi((bass ? BASS_TOP_DIATONIC : TREBLE_TOP_DIATONIC) - candidate.position);
    if (!group) { group = { pitches: [], page, staff: staffIndex, x: candidate.x }; groups.push(group); }
    if (!group.pitches.some(existing => Math.abs(existing - pitch) < 2)) group.pitches.push(pitch);
  }
  groups.forEach(group => group.pitches.sort((a, b) => a - b));
  return groups.filter(group => group.pitches.length <= 5);
}

function diatonicToMidi(diatonic: number): number {
  const octave = Math.floor(diatonic / 7);
  const step = ((diatonic % 7) + 7) % 7;
  return 12 + octave * 12 + [0, 2, 4, 5, 7, 9, 11][step];
}

function groupsToMusicXml(title: string, groups: NoteGroup[]): string {
  const measures: string[] = [];
  for (let offset = 0; offset < groups.length; offset += 4) {
    const measureGroups = groups.slice(offset, offset + 4);
    const notes = measureGroups.map(group => group.pitches.map((midi, noteIndex) => {
      const pitchClass = ((midi % 12) + 12) % 12;
      const naturalSteps = [0, 2, 4, 5, 7, 9, 11];
      const stepIndex = naturalSteps.findIndex(value => value === pitchClass);
      const resolvedStep = stepIndex >= 0 ? stepIndex : Math.max(0, naturalSteps.findIndex(value => value > pitchClass) - 1);
      const alter = naturalSteps[resolvedStep] === pitchClass ? "" : "<alter>1</alter>";
      return `<note>${noteIndex ? "<chord/>" : ""}<pitch><step>${STEP_NAMES[resolvedStep]}</step>${alter}<octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
    }).join("")).join("");
    const rests = Array.from({ length: 4 - measureGroups.length }, () => "<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>").join("");
    const attributes = offset === 0 ? "<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>" : "";
    measures.push(`<measure number="${measures.length + 1}">${attributes}${notes}${rests}</measure>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${escapeXml(title)}</work-title></work><identification><encoding><software>BandProject Browser OMR</software></encoding></identification><part-list><score-part id="P1"><part-name>Recognized score</part-name></score-part></part-list><part id="P1">${measures.join("")}</part></score-partwise>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;" })[character] || character);
}
