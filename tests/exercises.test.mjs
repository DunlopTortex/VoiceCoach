import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL, findExercise } from '../js/exercises.js';
import { comfortRange } from '../js/analysis.js';
import { streak } from '../js/storage.js';

const profiles = [
  { range: { low: 40, high: 62, measured: true }, comfort: comfortRange(40, 62) },
  { range: { low: 58, high: 84, measured: true }, comfort: comfortRange(58, 84) },
];

test('every exercise builds well-formed steps for low and high voices', () => {
  for (const ex of ALL) {
    for (const p of profiles) {
      const steps = ex.steps(p);
      assert.ok(steps.length > 0, ex.id);
      for (const s of steps) {
        assert.ok(['timed', 'manual', 'game'].includes(s.kind), `${ex.id}: bad kind ${s.kind}`);
        assert.ok(s.title, `${ex.id}: step without a title`);
        if (s.kind === 'timed') assert.ok(s.duration > 0, `${ex.id}/${s.title}: timed step needs a duration`);
        if (s.kind === 'game') assert.equal(typeof s.game, 'function');
        if (s.target != null) assert.ok(s.target >= p.comfort.low && s.target <= p.comfort.high, `${ex.id}: target outside comfort range`);
      }
    }
  }
});

test('finish() copes with skipped steps (no results)', () => {
  for (const ex of ALL) {
    const out = ex.finish({}, profiles[0], { noiseFloor: 0.004 });
    assert.ok(out.score === null || typeof out.score === 'number', ex.id);
  }
});

test('recommendations point at real exercises', () => {
  const report = findExercise('assessment').finish({}, profiles[0], { noiseFloor: 0.004 }).report;
  for (const r of report.recommendations) assert.ok(findExercise(r.id), r.id);
});

test('range stretch records a personal best', () => {
  const ex = findExercise('range-stretch');
  const frames = (midi) => Array.from({ length: 60 }, (_, i) => ({ t: i / 30, midi, clarity: 0.9, rms: 0.1 }));
  const out = ex.finish({ low1: frames(38), high1: frames(64) }, profiles[0]);
  assert.match(out.html, /Personal best/);
  assert.equal(out.profile.range.low, 38);
  assert.equal(out.profile.range.high, 64);
});

test('streak counts consecutive local days', () => {
  const day = (n) => { const d = new Date(2026, 9, 7, 12); d.setDate(d.getDate() - n); return { date: d.toISOString() }; };
  const today = new Date(2026, 9, 7, 18);
  assert.equal(streak([day(0), day(1), day(2), day(4)], today), 3);
  assert.equal(streak([day(1), day(2)], today), 2, 'a streak survives until the day is over');
  assert.equal(streak([day(3)], today), 0);
});
