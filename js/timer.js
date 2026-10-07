// A pausable countdown driven by an injectable clock (seconds), so it can be tested without waiting.

export class Countdown {
  constructor(duration, now = () => performance.now() / 1000) {
    this.duration = duration;
    this.now = now;
    this.startedAt = null;
    this.pausedAt = null;
    this.pausedTotal = 0;
  }

  start() {
    this.startedAt = this.now();
    this.pausedAt = null;
    this.pausedTotal = 0;
  }

  pause() {
    if (this.startedAt != null && this.pausedAt == null) this.pausedAt = this.now();
  }

  resume() {
    if (this.pausedAt != null) {
      this.pausedTotal += this.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  get paused() {
    return this.pausedAt != null;
  }

  elapsed() {
    if (this.startedAt == null) return 0;
    const end = this.pausedAt ?? this.now();
    return Math.min(this.duration, Math.max(0, end - this.startedAt - this.pausedTotal));
  }

  remaining() {
    return this.duration - this.elapsed();
  }

  progress() {
    return this.duration > 0 ? this.elapsed() / this.duration : 1;
  }

  get done() {
    return this.startedAt != null && this.remaining() <= 0;
  }
}

export function formatSeconds(s) {
  const total = Math.ceil(Math.max(0, s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m ? `${m}:${String(sec).padStart(2, '0')}` : String(sec);
}
