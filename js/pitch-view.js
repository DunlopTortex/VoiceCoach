// Scrolling piano-roll: the user's pitch as a trail, target notes as bars, "now" as a vertical line.

import { midiToName, NOTE_NAMES } from './pitch.js';

const PAST = 4; // seconds of history shown left of "now"

export class PitchView {
  constructor(canvas, engine, { low = 48, high = 67 } = {}) {
    this.canvas = canvas;
    this.engine = engine;
    this.low = low - 3;
    this.high = high + 3;
    this.future = 0;
    this.trail = [];
    this.target = null;
    this.schedule = [];
    this.live = null;
    this.raf = 0;
    this.unsub = engine.subscribe((f) => this.onFrame(f));
    this.draw = this.draw.bind(this);
    this.raf = requestAnimationFrame(this.draw);
  }

  // A single note to aim for (horizontal band across the view).
  setTarget(midi) {
    this.target = midi;
    this.fitTo(midi);
  }

  // Notes on a timeline; the view looks ahead so upcoming notes scroll in from the right.
  setSchedule(schedule, { sung = true } = {}) {
    this.schedule = schedule.map((n) => ({ ...n, sung }));
    this.future = schedule.length ? 3 : 0;
    schedule.forEach((n) => this.fitTo(n.midi));
  }

  fitTo(midi) {
    if (midi == null) return;
    this.low = Math.min(this.low, midi - 3);
    this.high = Math.max(this.high, midi + 3);
  }

  onFrame(f) {
    if (f.midi != null && f.clarity > 0.6) {
      // Light smoothing: median of the last three detections, if they are close in time.
      const recent = this.trail.filter((p) => f.t - p.t < 0.1).map((p) => p.raw);
      const vals = [...recent.slice(-2), f.midi].sort((a, b) => a - b);
      const midi = vals[Math.floor(vals.length / 2)];
      this.trail.push({ t: f.t, midi, raw: f.midi });
      // Grow the view to follow a voice that goes outside it (e.g. speaking low, or a range slide).
      if (midi > 30 && midi < 96) this.fitTo(midi);
      this.live = midi;
    } else {
      this.live = null;
    }
    const cutoff = f.t - PAST - 1;
    while (this.trail.length && this.trail[0].t < cutoff) this.trail.shift();
  }

  destroy() {
    this.unsub();
    cancelAnimationFrame(this.raf);
  }

  draw() {
    this.raf = requestAnimationFrame(this.draw);
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const css = getComputedStyle(c);
    const color = (name) => css.getPropertyValue(name).trim();
    const now = this.engine.now();
    const span = PAST + this.future;
    const nowX = w * (PAST / span);
    const x = (t) => nowX + ((t - now) / span) * w;
    const y = (m) => h - ((m - this.low) / (this.high - this.low)) * h;
    const rowH = h / (this.high - this.low);

    // Semitone grid, with note names on the naturals.
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let m = Math.ceil(this.low); m <= this.high; m++) {
      const isC = ((m % 12) + 12) % 12 === 0;
      g.fillStyle = color(isC ? '--grid-strong' : '--grid');
      g.fillRect(0, Math.round(y(m)), w, 1);
      // Label every natural note when there is room, otherwise just C, E and G so labels never overlap.
      const pc = ((m % 12) + 12) % 12;
      if (rowH >= 16 ? !NOTE_NAMES[pc].includes('#') : rowH > 5 && [0, 4, 7].includes(pc)) {
        g.fillStyle = color('--muted');
        g.fillText(midiToName(m), 4, y(m));
      }
    }

    // Target band.
    if (this.target != null) {
      g.fillStyle = color('--target-band');
      g.fillRect(0, y(this.target + 0.5), w, rowH);
      g.fillStyle = color('--target');
      g.fillRect(0, y(this.target) - 1, w, 2);
      g.font = 'bold 12px system-ui, sans-serif';
      g.fillText(midiToName(this.target), w - 34, y(this.target) - 10);
    }

    // Scheduled notes.
    for (const n of this.schedule) {
      const x0 = x(n.start), x1 = x(n.end);
      if (x1 < 0 || x0 > w) continue;
      const active = now >= n.start && now <= n.end;
      g.fillStyle = color(!n.sung ? '--note-listen' : active ? '--note-active' : '--note');
      roundRect(g, x0 + 1, y(n.midi + 0.4), Math.max(2, x1 - x0 - 2), rowH * 0.8, 4);
      g.fill();
    }

    // Now line.
    if (this.future) {
      g.fillStyle = color('--muted');
      g.fillRect(nowX, 0, 1, h);
    }

    // Pitch trail: break the line where the voice stopped.
    g.strokeStyle = color('--voice');
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    let prev = null;
    for (const p of this.trail) {
      const px = x(p.t), py = y(p.midi);
      if (prev && p.t - prev.t < 0.12 && Math.abs(p.midi - prev.midi) < 2) g.lineTo(px, py);
      else g.moveTo(px, py);
      prev = p;
    }
    g.stroke();

    if (this.live != null && prev && now - prev.t < 0.15) {
      g.fillStyle = color('--voice');
      g.beginPath();
      g.arc(x(prev.t), y(prev.midi), 6, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
