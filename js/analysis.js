// Turns streams of pitch frames into measurements, scores and recommendations.
// A frame is { t: seconds, midi: number|null, rms: number, clarity: number }.
// Pure functions only, so everything here is covered by the Node tests.

import { foldedCents, median, percentile, stdev, midiToName } from './pitch.js';

export const VOICE_TYPES = [
  { id: 'bass', label: 'Bass', low: 40, high: 64 },
  { id: 'baritone', label: 'Baritone', low: 43, high: 67 },
  { id: 'tenor', label: 'Tenor', low: 48, high: 72 },
  { id: 'alto', label: 'Alto', low: 53, high: 77 },
  { id: 'mezzo', label: 'Mezzo-soprano', low: 57, high: 81 },
  { id: 'soprano', label: 'Soprano', low: 60, high: 84 },
];

// Default profile used before the user has taken an assessment (a range most adults can reach).
export const DEFAULT_RANGE = { low: 48, high: 67 };

export function voiced(frames, minClarity = 0.6) {
  return frames.filter((f) => f.midi != null && f.clarity >= minClarity);
}

// Drops isolated spikes and octave jumps: a frame counts only if the previous
// voiced frame was within a semitone of it.
export function stableMidis(frames) {
  const v = voiced(frames);
  const out = [];
  for (let i = 1; i < v.length; i++) {
    if (Math.abs(v[i].midi - v[i - 1].midi) <= 1) out.push(v[i].midi);
  }
  return out;
}

export function analyzeSpeaking(frames) {
  const m = stableMidis(frames);
  if (m.length < 10) return null;
  return {
    medianMidi: median(m),
    // Spread of intonation in semitones; monotone speech is usually under ~1.5.
    variability: stdev(m),
  };
}

// The lowest/highest note the user could *hold*, ignoring brief slips.
export function analyzeExtreme(frames, which) {
  const m = stableMidis(frames);
  if (m.length < 8) return null;
  return which === 'low' ? percentile(m, 5) : percentile(m, 95);
}

export function classifyVoice(low, high) {
  const mid = (low + high) / 2;
  let best = VOICE_TYPES[0];
  for (const t of VOICE_TYPES) {
    if (Math.abs((t.low + t.high) / 2 - mid) < Math.abs((best.low + best.high) / 2 - mid)) best = t;
  }
  return best;
}

// The part of the range used for exercises: a little in from the extremes, at least 9 semitones wide.
export function comfortRange(low, high) {
  let cLow = Math.round(low + 2);
  let cHigh = Math.round(high - 2);
  if (cHigh - cLow < 9) {
    const center = Math.round((low + high) / 2);
    cLow = center - 5;
    cHigh = center + 4;
  }
  return { low: cLow, high: cHigh };
}

/**
 * Builds a timeline of notes: [{ midi, start, end }].
 */
export function buildSchedule(notes, startTime, noteDur, gap = 0) {
  return notes.map((midi, i) => {
    const start = startTime + i * (noteDur + gap);
    return { midi, start, end: start + noteDur };
  });
}

/**
 * Scores how well the user sang a scheduled sequence of notes.
 * The first part of each note window is skipped so a late entry or a scoop into the note is not penalised.
 */
export function scoreNotes(frames, schedule, { settle = 0.3 } = {}) {
  const notes = schedule.map((n) => {
    const from = n.start + (n.end - n.start) * settle;
    const inWindow = voiced(frames).filter((f) => f.t >= from && f.t <= n.end);
    if (inWindow.length < 3) return { midi: n.midi, sung: false, cents: null, score: 0 };
    const cents = foldedCents(median(inWindow.map((f) => (f.midi - n.midi) * 100)));
    return { midi: n.midi, sung: true, cents, score: Math.max(0, 1 - Math.abs(cents) / 100) };
  });
  const sung = notes.filter((n) => n.sung);
  return {
    notes,
    accuracy: notes.length ? Math.round((100 * notes.reduce((a, n) => a + n.score, 0)) / notes.length) : 0,
    hits: notes.filter((n) => n.sung && Math.abs(n.cents) <= 50).length,
    avgAbsCents: sung.length ? Math.round(sung.reduce((a, n) => a + Math.abs(n.cents), 0) / sung.length) : null,
  };
}

/**
 * Long-tone analysis: how long the voice was held, and how steady it was.
 * The tone ends at the first silence longer than `maxGap` seconds after it started.
 */
export function analyzeSustain(frames, { maxGap = 0.6 } = {}) {
  const v = voiced(frames, 0.5);
  if (v.length < 5) return { duration: 0, steadiness: 0, wobbleCents: null };
  let end = 0;
  for (let i = 1; i < v.length; i++) {
    if (v[i].t - v[i - 1].t > maxGap) break;
    end = i;
  }
  const run = v.slice(0, end + 1);
  const duration = run[run.length - 1].t - run[0].t;
  // Ignore the onset, where nearly everyone slides into the note.
  const body = run.filter((f) => f.t >= run[0].t + 0.5).map((f) => f.midi);
  if (body.length < 5) return { duration, steadiness: 0, wobbleCents: null };
  const wobbleCents = stdev(body) * 100;
  return { duration, steadiness: steadinessScore(wobbleCents), wobbleCents: Math.round(wobbleCents) };
}

// 100 for a rock-steady tone (<= 10 cents of drift), falling to 0 at 80 cents.
export function steadinessScore(wobbleCents) {
  return Math.round(Math.max(0, Math.min(100, 100 - ((wobbleCents - 10) / 70) * 100)));
}

// Deterministic PRNG so melodies can be reproduced in tests.
export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];

/**
 * A short, singable melody in a major key that fits in [low, high]:
 * starts on the tonic, moves mostly by step, never leaves the octave above the tonic.
 */
export function generateMelody(range, length, random = Math.random) {
  const span = range.high - range.low;
  const tonic = Math.round(range.low + Math.max(0, (span - 12) / 2));
  let degree = 0;
  const notes = [tonic];
  for (let i = 1; i < length; i++) {
    const options = [-2, -1, -1, 1, 1, 2]
      .map((m) => degree + m)
      .filter((d) => d >= 0 && d < MAJOR.length && tonic + MAJOR[d] <= range.high);
    if (options.length) degree = options[Math.floor(random() * options.length)];
    notes.push(tonic + MAJOR[degree]);
  }
  return notes;
}

export function scaleNotes(tonic, pattern = [0, 2, 4, 5, 7, 5, 4, 2, 0]) {
  return pattern.map((p) => tonic + p);
}

/**
 * Combines assessment parts into a report the UI can display and the app can store.
 */
export function buildReport({ speaking, low, high, melody, sustain }) {
  const rangeLow = low ?? DEFAULT_RANGE.low;
  const rangeHigh = high ?? DEFAULT_RANGE.high;
  const span = Math.max(0, Math.round(rangeHigh - rangeLow));
  const voiceType = classifyVoice(rangeLow, rangeHigh);
  const comfort = comfortRange(rangeLow, rangeHigh);

  const scores = {
    // Two octaves (24 semitones) is a healthy untrained range.
    range: Math.round(Math.min(100, (span / 24) * 100)),
    pitch: melody ? melody.accuracy : 0,
    breath: sustain ? Math.round(Math.min(100, (sustain.duration / 20) * 100)) : 0,
    steadiness: sustain ? sustain.steadiness : 0,
    expression: speaking ? Math.round(Math.min(100, (speaking.variability / 3) * 100)) : 0,
  };
  const overall = Math.round(
    scores.pitch * 0.35 + scores.range * 0.2 + scores.breath * 0.15 + scores.steadiness * 0.15 + scores.expression * 0.15,
  );

  return {
    date: new Date().toISOString(),
    range: { low: Math.round(rangeLow), high: Math.round(rangeHigh), span, measured: low != null && high != null },
    rangeNames: { low: midiToName(rangeLow), high: midiToName(rangeHigh) },
    comfort,
    voiceType: { id: voiceType.id, label: voiceType.label },
    speakingMidi: speaking ? Math.round(speaking.medianMidi) : null,
    speakingVariability: speaking ? Number(speaking.variability.toFixed(2)) : null,
    melody,
    sustain,
    scores,
    overall,
    recommendations: recommend(scores),
  };
}

export function recommend(scores) {
  const recs = [];
  if (scores.pitch < 70) recs.push({ id: 'pitch-match', reason: 'Your pitch accuracy has the most room to grow.' });
  if (scores.pitch < 85) recs.push({ id: 'melody-echo', reason: 'Echoing melodies trains your ear and voice together.' });
  if (scores.breath < 60) recs.push({ id: 'breath', reason: 'A longer breath will support every note you sing.' });
  if (scores.steadiness < 70) recs.push({ id: 'long-tones', reason: 'Long tones will steady a wobbly note.' });
  if (scores.range < 60) recs.push({ id: 'range-stretch', reason: 'Gentle sirens will widen your range over time.' });
  if (scores.expression < 50) recs.push({ id: 'expressive-speaking', reason: 'Your speaking voice is fairly flat; add some melody to it.' });
  recs.push({ id: 'daily-workout', reason: 'A balanced 10-minute routine for every day.' });
  return recs;
}
