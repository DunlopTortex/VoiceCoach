import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, freqToMidi, midiToFreq, midiToName, foldedCents, percentile, median } from '../js/pitch.js';

const SR = 48000;

function tone(freq, { n = 2048, harmonics = [1, 0.5, 0.25], noise = 0 } = {}) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((a, h) => { v += a * Math.sin((2 * Math.PI * freq * (h + 1) * i) / SR); });
    buf[i] = 0.3 * v + noise * (Math.random() * 2 - 1);
  }
  return buf;
}

test('note helpers round-trip', () => {
  assert.equal(midiToName(60), 'C4');
  assert.equal(midiToName(69), 'A4');
  assert.equal(midiToName(45), 'A2');
  assert.ok(Math.abs(freqToMidi(midiToFreq(57.3)) - 57.3) < 1e-9);
});

test('detects sung pitches across the vocal range within 10 cents', () => {
  for (const midi of [40, 48, 55, 62, 69, 76, 84]) {
    const f = midiToFreq(midi);
    const r = detectPitch(tone(f), SR);
    assert.ok(r, `no pitch for ${midiToName(midi)}`);
    const cents = Math.abs(freqToMidi(r.freq) - midi) * 100;
    assert.ok(cents < 10, `${midiToName(midi)} off by ${cents.toFixed(1)} cents`);
    assert.ok(r.clarity > 0.85);
  }
});

test('does not jump an octave on tones with a strong second harmonic', () => {
  const r = detectPitch(tone(150, { harmonics: [0.6, 1, 0.4] }), SR);
  assert.ok(Math.abs(r.freq - 150) < 2, `got ${r.freq}`);
});

test('tolerates some noise', () => {
  const r = detectPitch(tone(220, { noise: 0.05 }), SR);
  assert.ok(r && Math.abs(r.freq - 220) < 3);
});

test('returns null for white noise and silence', () => {
  const noise = new Float32Array(2048).map(() => Math.random() * 2 - 1);
  assert.equal(detectPitch(noise, SR), null);
});

test('foldedCents treats octaves as the same note', () => {
  assert.equal(foldedCents(1200), 0);
  assert.equal(foldedCents(-1210), -10);
  assert.equal(foldedCents(30), 30);
});

test('percentile and median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(percentile([0, 10], 50), 5);
  assert.ok(Number.isNaN(median([])));
});
