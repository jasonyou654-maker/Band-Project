export type NoteEvent = { pitch: number; start: number; end: number; velocity?: number };

const STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

export function noteEventsToMusicXml(title: string, instrument: string, bpm: number, events: NoteEvent[]) {
  const divisions = 4;
  const secondsPerDivision = 60 / Math.max(30, bpm) / divisions;
  if (events.length === 0) throw new Error("Cannot generate MusicXML without note evidence.");
  const byMeasure = new Map<number, { offset: number; pitch: number; duration: number }[]>();
  for (const event of events) {
    const startDivision = Math.max(0, Math.round(event.start / secondsPerDivision));
    const measure = Math.floor(startDivision / (divisions * 4));
    const offset = startDivision % (divisions * 4);
    const duration = Math.max(1, Math.min(divisions * 4 - offset, Math.round((event.end - event.start) / secondsPerDivision)));
    const entries = byMeasure.get(measure) || [];
    entries.push({ offset, pitch: event.pitch, duration });
    byMeasure.set(measure, entries);
  }
  const lastMeasure = Math.max(0, ...byMeasure.keys());
  const measures = Array.from({ length: lastMeasure + 1 }, (_, index) => {
    const entries = (byMeasure.get(index) || []).sort((a, b) => a.offset - b.offset || a.pitch - b.pitch);
    let cursor = 0;
    const notes: string[] = [];
    for (const entry of entries) {
      if (entry.offset > cursor) notes.push(rest(entry.offset - cursor));
      const pitchClass = ((entry.pitch % 12) + 12) % 12;
      notes.push(`<note><pitch><step>${STEPS[pitchClass]}</step>${ALTERS[pitchClass] ? "<alter>1</alter>" : ""}<octave>${Math.floor(entry.pitch / 12) - 1}</octave></pitch><duration>${entry.duration}</duration><voice>1</voice><type>${durationType(entry.duration, divisions)}</type></note>`);
      cursor = Math.max(cursor, entry.offset + entry.duration);
    }
    if (cursor < divisions * 4) notes.push(rest(divisions * 4 - cursor));
    const attributes = index === 0 ? `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${instrument.toLowerCase().includes("bass") ? "F" : "G"}</sign><line>${instrument.toLowerCase().includes("bass") ? "4" : "2"}</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>` : "";
    return `<measure number="${index + 1}">${attributes}${notes.join("")}</measure>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${escapeXml(title)}</work-title></work><identification><encoding><software>BandProject MusicXML pipeline</software></encoding></identification><part-list><score-part id="P1"><part-name>${escapeXml(instrument)}</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

export function isMusicXml(value: string) {
  return /<score-(partwise|timewise)[\s>]/i.test(value) && /<part[\s>]/i.test(value);
}

/**
 * OMR exports (notably Audiveris) encode the source page geometry with
 * <page-layout>, <print new-system/new-page>, measure widths and note
 * default-x/default-y coordinates. Renderers should keep those encoded line
 * and page breaks instead of reflowing the score as an endless compact sheet.
 */
export function hasEncodedSourceLayout(value: string) {
  return /<page-layout[\s>]/i.test(value)
    || /<print\b[^>]*(?:new-system|new-page)\s*=\s*["']yes["']/i.test(value)
    || /<measure\b[^>]*\bwidth\s*=\s*["'][^"']+["']/i.test(value)
    || /<note\b[^>]*\bdefault-[xy]\s*=\s*["'][^"']+["']/i.test(value);
}

/** A piano/grand-staff part has multiple staves within the same MusicXML part.
 * Keeping this signal separate from the number of systems prevents a renderer
 * from mistaking successive lines on a page for separate instruments. */
export function hasGrandStaff(value: string) {
  return /<staves>\s*(?:[2-9]|[1-9]\d+)\s*<\/staves>/i.test(value)
    || /<staff>\s*2\s*<\/staff>/i.test(value);
}

function rest(duration: number) { return `<note><rest/><duration>${duration}</duration><voice>1</voice><type>${durationType(duration, 4)}</type></note>`; }
function durationType(duration: number, divisions: number) { if (duration >= divisions * 4) return "whole"; if (duration >= divisions * 2) return "half"; if (duration >= divisions) return "quarter"; if (duration >= divisions / 2) return "eighth"; return "16th"; }
function escapeXml(value: string) { return value.replace(/[<>&'\"]/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character] || character); }
