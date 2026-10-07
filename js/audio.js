// Microphone capture, live pitch tracking and a small synth for reference tones and cues.

import { detectPitch, freqToMidi, midiToFreq, rms } from './pitch.js';

const FRAME_MS = 33;
const BUFFER_SIZE = 2048;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.timer = null;
    this.listeners = new Set();
    this.noiseFloor = 0.004;
    this.volume = 0.6;
    // While the app is playing a reference tone, the mic hears the speaker; frames are muted until then.
    this.mutedUntil = 0;
    this.buf = new Float32Array(BUFFER_SIZE);
  }

  get micActive() {
    return !!this.stream;
  }

  // Must be called from a user gesture the first time (browser autoplay rules).
  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  async startMic() {
    await this.ensureContext();
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot access the microphone. Open the app over https or on localhost.');
    }
    // Voice processing (echo cancellation, AGC, noise suppression) distorts pitch, so turn it off.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = BUFFER_SIZE;
    source.connect(this.analyser);
    this.timer = setInterval(() => this.tick(), FRAME_MS);
  }

  stopMic() {
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
  }

  // Listen to pitch frames: { t, midi|null, freq|null, rms, clarity, muted }.
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  tick() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const t = this.now();
    const level = rms(this.buf);
    const frame = { t, midi: null, freq: null, rms: level, clarity: 0, muted: t < this.mutedUntil };
    if (!frame.muted && level > Math.max(0.006, this.noiseFloor * 2.5)) {
      const p = detectPitch(this.buf, this.ctx.sampleRate);
      if (p) {
        frame.freq = p.freq;
        frame.midi = freqToMidi(p.freq);
        frame.clarity = p.clarity;
      }
    }
    this.listeners.forEach((fn) => fn(frame));
  }

  // Collects frames until the returned stop() is called.
  record() {
    const frames = [];
    const unsub = this.subscribe((f) => { if (!f.muted) frames.push(f); });
    return () => { unsub(); return frames; };
  }

  // ---- sound output ----

  playNote(midi, duration = 0.8, when = this.now(), gain = 0.5) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    const f = midiToFreq(midi);
    osc.type = 'triangle';
    osc.frequency.value = f;
    osc2.type = 'sine';
    osc2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(4000, f * 6);
    osc.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(env).connect(this.master);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.02);
    env.gain.setTargetAtTime(gain * 0.7, when + 0.05, 0.1);
    env.gain.setTargetAtTime(0, when + duration - 0.05, 0.04);
    osc.start(when);
    osc2.start(when);
    osc.stop(when + duration + 0.3);
    osc2.stop(when + duration + 0.3);
    this.mutedUntil = Math.max(this.mutedUntil, when + duration + 0.25);
  }

  // schedule: [{ midi, start, end }] in engine time. Resolves when the last note has finished.
  playSchedule(schedule) {
    for (const n of schedule) this.playNote(n.midi, n.end - n.start, n.start);
    const end = schedule.length ? schedule[schedule.length - 1].end + 0.25 : this.now();
    return this.waitUntil(end);
  }

  waitUntil(time, signal) {
    return new Promise((resolve) => {
      const check = () => {
        if (signal?.aborted || this.now() >= time) return resolve();
        setTimeout(check, 20);
      };
      check();
    });
  }

  beep(kind = 'tick') {
    if (!this.ctx) return;
    const tones = { tick: [880, 0.06, 0.15], go: [1320, 0.15, 0.25], done: [660, 0.25, 0.25], hit: [1046, 0.12, 0.2], miss: [220, 0.2, 0.2] };
    const [freq, dur, gain] = tones[kind] || tones.tick;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.frequency.value = freq;
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    if (kind === 'done') {
      // A second, higher tone makes "step finished" distinct from a tick.
      const o2 = this.ctx.createOscillator();
      const e2 = this.ctx.createGain();
      o2.frequency.value = 990;
      e2.gain.setValueAtTime(0.0001, t);
      e2.gain.setValueAtTime(gain, t + 0.15);
      e2.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o2.connect(e2).connect(this.master);
      o2.start(t);
      o2.stop(t + 0.5);
    }
    this.mutedUntil = Math.max(this.mutedUntil, t + dur + 0.15);
  }
}
