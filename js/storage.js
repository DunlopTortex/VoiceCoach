// Everything is stored on the device in localStorage. Reads and writes never throw:
// in private mode or with storage blocked, the app still works for the current visit.

import { DEFAULT_RANGE, comfortRange } from './analysis.js';

const KEY = 'voice-coach-v1';

function defaults() {
  return {
    profile: {
      range: { ...DEFAULT_RANGE, span: DEFAULT_RANGE.high - DEFAULT_RANGE.low, measured: false },
      comfort: comfortRange(DEFAULT_RANGE.low, DEFAULT_RANGE.high),
      voiceType: null,
      speakingMidi: null,
      noiseFloor: 0.004,
      assessedAt: null,
    },
    settings: { voiceGuide: false, volume: 0.6 },
    history: [],
    assessments: [],
  };
}

let memory = null;

export function load() {
  if (memory) return memory;
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      memory = {
        ...base,
        ...saved,
        profile: { ...base.profile, ...saved.profile },
        settings: { ...base.settings, ...saved.settings },
      };
      return memory;
    }
  } catch {
    // Fall through to defaults.
  }
  memory = base;
  return memory;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage unavailable; data lives for this visit only.
  }
}

export function update(fn) {
  fn(load());
  save();
}

export function reset() {
  memory = defaults();
  save();
}

// Consecutive days (ending today or yesterday) with at least one finished session.
export function streak(history, today = new Date()) {
  const key = (x) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
  const days = new Set(history.map((h) => key(new Date(h.date))));
  const d = new Date(today);
  if (!days.has(key(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(key(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
