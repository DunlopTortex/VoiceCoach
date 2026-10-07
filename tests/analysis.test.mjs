import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeExtreme, analyzeSpeaking, analyzeSustain, buildReport, buildSchedule, classifyVoice,
  comfortRange, generateMelody, scoreNotes, seededRandom, stableMidis,
} from '../js/analysis.js';

const DT = 1 / 30;
const frame = (t, midi, clarity = 0.95) => ({ t, midi, clarity, rms: 0.1 });

// Frames of someone singing `midi` (optionally off by `cents`) from t0 to t1.
function sing(t0, t1, midi, cents = 0, wobble = 0) {
  const out = [];
  for (let t = t0; t < t1; t += DT) out.push(frame(t, midi + cents / 100 + wobble * Math.sin(t * 30) / 100));
  return out;
}

test('stableMidis drops single-frame spikes and octave jumps', () => {
  const frames = [frame(0, 50), frame(0.03, 50.1), frame(0.06, 62), frame(0.09, 50.2), frame(0.12, 50.1)];
  assert.deepEqual(stableMidis(frames), [50.1, 50.1]);
});

test('range extremes come from held notes', () => {
  const low = [...sing(0, 2, 50), ...sing(2, 4, 45)];
  const high = [...sing(0, 2, 60), ...sing(2, 4, 70)];
  assert.ok(Math.abs(analyzeExtreme(low, 'low') - 45) < 0.5);
  assert.ok(Math.abs(analyzeExtreme(high, 'high') - 70) < 0.5);
  assert.equal(analyzeExtreme([], 'low'), null);
});

test('voice classification', () => {
  assert.equal(classifyVoice(41, 63).id, 'bass');
  assert.equal(classifyVoice(48, 72).id, 'tenor');
  assert.equal(classifyVoice(60, 84).id, 'soprano');
});

test('comfort range is inset and never too narrow', () => {
  assert.deepEqual(comfortRange(45, 70), { low: 47, high: 68 });
  const narrow = comfortRange(50, 56);
  assert.ok(narrow.high - narrow.low >= 9);
});

test('melodies stay in range and move mostly by step', () => {
  const range = { low: 48, high: 64 };
  for (let seed = 1; seed < 50; seed++) {
    const m = generateMelody(range, 6, seededRandom(seed));
    assert.equal(m.length, 6);
    for (let i = 0; i < m.length; i++) {
      assert.ok(m[i] >= range.low && m[i] <= range.high, `note ${m[i]} out of range`);
      if (i) assert.ok(Math.abs(m[i] - m[i - 1]) <= 4, 'leap too large');
    }
  }
});

test('scoreNotes rewards accurate singing and handles silence', () => {
  const schedule = buildSchedule([48, 50, 52], 10, 1);
  const perfect = schedule.flatMap((n) => sing(n.start, n.end, n.midi));
  const r1 = scoreNotes(perfect, schedule);
  assert.equal(r1.hits, 3);
  assert.ok(r1.accuracy >= 99);

  const flat = schedule.flatMap((n) => sing(n.start, n.end, n.midi, -40));
  const r2 = scoreNotes(flat, schedule);
  assert.equal(r2.hits, 3);
  assert.ok(r2.accuracy > 55 && r2.accuracy < 65);

  const octave = schedule.flatMap((n) => sing(n.start, n.end, n.midi + 12));
  assert.equal(scoreNotes(octave, schedule).hits, 3, 'octave-equivalent notes count');

  const r3 = scoreNotes(sing(10, 11, 48), schedule);
  assert.equal(r3.hits, 1);
  assert.equal(r3.notes[1].sung, false);
});

test('sustain measures duration until the voice stops, and steadiness', () => {
  const steady = [...sing(0, 12, 55, 0, 5), ...sing(14, 16, 55)];
  const r = analyzeSustain(steady);
  assert.ok(Math.abs(r.duration - 12) < 0.1, `duration ${r.duration}`);
  assert.ok(r.steadiness >= 95);

  const wobbly = analyzeSustain(sing(0, 8, 55, 0, 90));
  assert.ok(wobbly.steadiness < 30, `steadiness ${wobbly.steadiness}`);
  assert.equal(analyzeSustain([]).duration, 0);
});

test('speaking variability separates monotone from expressive speech', () => {
  const mono = analyzeSpeaking(sing(0, 3, 50, 0, 30));
  const lively = analyzeSpeaking(sing(0, 3, 50, 0, 400).map((f, i) => ({ ...f, midi: 50 + 4 * Math.sin(i / 10) })));
  assert.ok(mono.variability < 0.5);
  assert.ok(lively.variability > 2);
});

test('report combines parts and recommends exercises', () => {
  const report = buildReport({
    speaking: { medianMidi: 47, variability: 0.8 },
    low: 41, high: 62,
    melody: { accuracy: 55, hits: 3, notes: [], avgAbsCents: 60 },
    sustain: { duration: 8, steadiness: 50, wobbleCents: 45 },
  });
  assert.equal(report.voiceType.id, 'bass');
  assert.equal(report.range.span, 21);
  assert.ok(report.overall > 0 && report.overall < 100);
  const ids = report.recommendations.map((r) => r.id);
  for (const id of ['pitch-match', 'breath', 'long-tones', 'expressive-speaking', 'daily-workout']) assert.ok(ids.includes(id), id);
});

test('report falls back to a default range when nothing was measured', () => {
  const report = buildReport({});
  assert.equal(report.range.measured, false);
  assert.ok(report.comfort.high > report.comfort.low);
});
