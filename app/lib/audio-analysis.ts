export type AudioAnalysisResult = {
  title: string;
  duration: number;
  bpm: number;
  tempoConfidence: number;
  key: string;
  mode: "major" | "minor";
  keyConfidence: number;
  timeSignature: "4/4";
  chords: string[];
  chordConfidence: number;
  sections: { name: string; start: number; color: string }[];
  instruments: { name: string; confidence: number }[];
  waveform: number[];
  analysisSource?: "browser" | "server";
};

const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export async function analyzeAudioFile(file: File): Promise<AudioAnalysisResult> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const mono = mixToMono(decoded);
    const sampleRate = decoded.sampleRate;
    const analysisSamples = limitAndDownsample(mono, sampleRate, 11025, 120);
    const analysisRate = Math.min(sampleRate, 11025);
    const envelope = energyEnvelope(analysisSamples, 1024, 512);
    const tempo = estimateTempo(envelope, analysisRate / 512);
    const globalChroma = chromaForSignal(analysisSamples, analysisRate, 28);
    const key = estimateKey(globalChroma);
    const chordResult = estimateChords(analysisSamples, analysisRate, key.root, key.mode);
    const waveform = makeWaveform(mono, 84);
    const sections = estimateSections(envelope, decoded.duration);
    const instruments = estimateInstruments(analysisSamples, analysisRate, globalChroma);
    return {
      title: file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " "),
      duration: decoded.duration,
      bpm: tempo.bpm,
      tempoConfidence: tempo.confidence,
      key: PITCH_NAMES[key.root],
      mode: key.mode,
      keyConfidence: key.confidence,
      timeSignature: "4/4",
      chords: chordResult.chords,
      chordConfidence: chordResult.confidence,
      sections,
      instruments,
      waveform,
      analysisSource: "browser",
    } as AudioAnalysisResult;
  } finally {
    await context.close();
  }
}

function mixToMono(buffer: AudioBuffer) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

function limitAndDownsample(input: Float32Array, sourceRate: number, targetRate: number, maxSeconds: number) {
  const stride = Math.max(1, Math.round(sourceRate / targetRate));
  const count = Math.min(Math.floor(input.length / stride), targetRate * maxSeconds);
  const output = new Float32Array(count);
  for (let i = 0; i < count; i++) output[i] = input[i * stride];
  return output;
}

function energyEnvelope(samples: Float32Array, size: number, hop: number) {
  const values: number[] = [];
  let previous = 0;
  for (let start = 0; start + size < samples.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + size; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / size);
    values.push(Math.max(0, rms - previous));
    previous = rms;
  }
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  return values.map(value => Math.max(0, value - mean * .45));
}

function estimateTempo(envelope: number[], framesPerSecond: number) {
  const candidates: { lag: number; score: number }[] = [];
  const minimumLag = Math.max(2, Math.floor(framesPerSecond * 60 / 190));
  const maximumLag = Math.max(minimumLag + 1, Math.ceil(framesPerSecond * 60 / 60));
  for (let lag = minimumLag; lag <= maximumLag; lag++) {
    let score = 0;
    for (let i = lag; i < envelope.length; i++) score += envelope[i] * envelope[i - lag];
    candidates.push({ lag, score: score / Math.max(1, envelope.length - lag) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0] || { lag: Math.round(framesPerSecond / 2), score: 0 };
  const runnerUp = candidates.find(candidate => Math.abs(candidate.lag - winner.lag) > 1)?.score || 0;
  const byLag = [...candidates].sort((a, b) => a.lag - b.lag);
  const winnerIndex = byLag.findIndex(candidate => candidate.lag === winner.lag);
  let refinedLag = winner.lag;
  if (winnerIndex > 0 && winnerIndex < byLag.length - 1) {
    const left = byLag[winnerIndex - 1].score, center = winner.score, right = byLag[winnerIndex + 1].score;
    const denominator = left - 2 * center + right;
    if (Math.abs(denominator) > 1e-12) refinedLag += .5 * (left - right) / denominator;
  }
  let bestBpm = Math.round(framesPerSecond * 60 / refinedLag);
  const best = winner.score, second = runnerUp;
  while (bestBpm < 78) bestBpm *= 2;
  while (bestBpm > 170) bestBpm = Math.round(bestBpm / 2);
  const separation = best > 0 ? Math.max(0, (best - second) / best) : 0;
  return { bpm: bestBpm, confidence: Math.round(Math.min(100, separation * 100)) };
}

function goertzel(samples: Float32Array, start: number, length: number, frequency: number, rate: number) {
  const omega = 2 * Math.PI * frequency / rate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0, previous2 = 0;
  for (let i = 0; i < length && start + i < samples.length; i++) {
    const window = .5 - .5 * Math.cos(2 * Math.PI * i / Math.max(1, length - 1));
    const value = samples[start + i] * window + coefficient * previous - previous2;
    previous2 = previous; previous = value;
  }
  return Math.sqrt(Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2));
}

function chromaForSignal(samples: Float32Array, rate: number, frameCount: number) {
  const chroma = Array(12).fill(0) as number[];
  const frameSize = Math.min(4096, samples.length);
  for (let frame = 0; frame < frameCount; frame++) {
    const start = Math.floor((samples.length - frameSize) * (frame + .5) / frameCount);
    for (let midi = 36; midi <= 83; midi++) {
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      chroma[midi % 12] += Math.log1p(goertzel(samples, start, frameSize, frequency, rate));
    }
  }
  const total = chroma.reduce((a, b) => a + b, 0) || 1;
  return chroma.map(value => value / total);
}

function correlation(chroma: number[], profile: number[], root: number) {
  let score = 0;
  for (let i = 0; i < 12; i++) score += chroma[(i + root) % 12] * profile[i];
  return score;
}

function estimateKey(chroma: number[]) {
  const candidates: { root: number; mode: "major" | "minor"; score: number }[] = [];
  for (let root = 0; root < 12; root++) {
    candidates.push({ root, mode: "major", score: correlation(chroma, MAJOR_PROFILE, root) });
    candidates.push({ root, mode: "minor", score: correlation(chroma, MINOR_PROFILE, root) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const margin = Math.max(0, (candidates[0].score - candidates[1].score) / candidates[0].score);
  return { ...candidates[0], confidence: Math.round(Math.min(100, margin * 100)) };
}

function estimateChords(samples: Float32Array, rate: number, keyRoot: number, mode: "major" | "minor") {
  const chordNames: string[] = [];
  const scores: number[] = [];
  const segmentCount = 8;
  for (let segment = 0; segment < segmentCount; segment++) {
    const start = Math.floor(samples.length * segment / segmentCount);
    const end = Math.floor(samples.length * (segment + 1) / segmentCount);
    const slice = samples.subarray(start, end);
    const chroma = chromaForSignal(slice, rate, 4);
    let best = { root: keyRoot, minor: mode === "minor", score: 0 };
    for (let root = 0; root < 12; root++) for (const minor of [false, true]) {
      const third = (root + (minor ? 3 : 4)) % 12, fifth = (root + 7) % 12;
      const score = chroma[root] * 1.15 + chroma[third] + chroma[fifth] * .85;
      if (score > best.score) best = { root, minor, score };
    }
    const name = `${PITCH_NAMES[best.root]}${best.minor ? "m" : ""}`;
    if (chordNames[chordNames.length - 1] !== name) chordNames.push(name);
    scores.push(best.score);
  }
  const average = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  return { chords: average > .045 ? chordNames.slice(0, 6) : [], confidence: Math.round(Math.min(100, average * 1000)) };
}

function estimateSections(envelope: number[], duration: number) {
  const average = envelope.reduce((sum, value) => sum + value, 0) / Math.max(1, envelope.length);
  const boundaries = [0];
  for (let index = 2; index < envelope.length - 2; index++) {
    const before = (envelope[index - 2] + envelope[index - 1]) / 2;
    const after = (envelope[index] + envelope[index + 1]) / 2;
    if (Math.abs(after - before) > average * 2.5 && boundaries.length < 6) boundaries.push(duration * index / envelope.length);
  }
  boundaries.push(duration);
  const count = Math.max(1, boundaries.length - 1);
  const palette = ["#c9b8e7", "#e9aa6d", "#9ab5a2", "#8ea5c7"];
  return Array.from({ length: count }, (_, index) => ({ name: `Region ${index + 1}`, start: boundaries[index], color: palette[index % palette.length] }));
}

function estimateInstruments(samples: Float32Array, rate: number, chroma: number[]) {
  let crossings = 0, lowEnergy = 0, totalEnergy = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
    const energy = samples[i] * samples[i]; totalEnergy += energy;
    if (i % Math.max(1, Math.round(rate / 180)) < 2) lowEnergy += energy;
  }
  const zcr = crossings / Math.max(1, samples.length);
  const tonal = Math.max(...chroma) / Math.max(.001, chroma.reduce((a, b) => a + b, 0) / 12);
  const results = [
    { name: "Harmonic instrument", confidence: Math.round(Math.min(94, 58 + tonal * 7)) },
    { name: "Percussion", confidence: Math.round(Math.min(93, 55 + zcr * 520)) },
  ];
  if (lowEnergy / Math.max(.001, totalEnergy) > .0005) results.push({ name: "Bass", confidence: 72 });
  if (tonal > 1.4) results.push({ name: "Lead / vocal", confidence: Math.round(Math.min(89, 55 + tonal * 8)) });
  return results;
}

function makeWaveform(samples: Float32Array, bars: number) {
  const values: number[] = [];
  const block = Math.max(1, Math.floor(samples.length / bars));
  for (let bar = 0; bar < bars; bar++) {
    let peak = 0;
    for (let i = bar * block; i < Math.min(samples.length, (bar + 1) * block); i++) peak = Math.max(peak, Math.abs(samples[i]));
    values.push(Math.max(.08, peak));
  }
  const max = Math.max(...values) || 1;
  return values.map(value => value / max);
}
