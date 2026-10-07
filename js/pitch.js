// Pitch detection and music helpers. Pure functions, no DOM, so they run in Node tests too.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi) {
  const m = Math.round(midi);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

// Signed distance in cents from `freq` to the target note.
export function centsFrom(freq, targetMidi) {
  return (freqToMidi(freq) - targetMidi) * 100;
}

// Like centsFrom, but singing the right note in another octave counts as on pitch.
// Result is folded into [-600, 600).
export function foldedCents(cents) {
  return ((((cents + 600) % 1200) + 1200) % 1200) - 600;
}

export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 * Returns { freq, clarity } or null when no clear pitch is present.
 * clarity is 1 - aperiodicity: near 1 for a clean sung tone, lower for breathy/noisy sound.
 */
export function detectPitch(buf, sampleRate, { threshold = 0.15, minFreq = 60, maxFreq = 1100 } = {}) {
  const half = Math.floor(buf.length / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(half - 1, Math.ceil(sampleRate / minFreq));
  if (tauMax <= tauMin) return null;

  // Difference function d(tau), then cumulative mean normalized difference d'(tau).
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    d[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  // First dip below the threshold, followed down to its local minimum.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // Parabolic interpolation around the minimum for sub-sample accuracy.
  let betterTau = tau;
  if (tau > 1 && tau < tauMax) {
    const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tau + (s2 - s0) / denom;
  }
  const freq = sampleRate / betterTau;
  if (freq < minFreq || freq > maxFreq) return null;
  return { freq, clarity: Math.max(0, Math.min(1, 1 - d[tau])) };
}

// ---- small stats helpers ----

export function median(values) {
  return percentile(values, 50);
}

export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (values.length - 1);
  return Math.sqrt(v);
}
