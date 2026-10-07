// Guides the user through an exercise one step at a time.
//
// Step kinds:
//   timed  - shows a countdown and moves on automatically when it reaches zero.
//            { duration, ready?: secs of "get ready" count-in, play?: [midi] reference notes first,
//              listen?: show live pitch, target?: midi, capture?: key to store frames under,
//              stopOnSilence?: end early once the user stops, visual?: 'inhale'|'exhale'|'hold' }
//   manual - the user works at their own pace and presses Next. { listen?, capture?, onNext?(ctx) }
//   game   - an interactive game; { game: async (ctx) => result }. Shows a Next button when finished.
// Any step may have onEnd(ctx) to post-process its captured frames.

import { Countdown, formatSeconds } from './timer.js';
import { PitchView } from './pitch-view.js';

const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

export class SessionRunner {
  constructor({ root, exercise, steps, engine, profile, settings, onFinish, onExit }) {
    Object.assign(this, { root, exercise, steps, engine, profile, settings, onFinish, onExit });
    this.index = -1;
    this.results = {};
    this.cleanup = [];
    this.wakeLock = null;
  }

  start() {
    this.root.innerHTML = `
      <div class="runner">
        <header class="runner-head">
          <button class="icon-btn" data-act="exit" aria-label="Exit exercise">✕</button>
          <div class="runner-title">
            <div class="runner-name"></div>
            <div class="runner-count"></div>
          </div>
          <span class="icon-btn-spacer"></span>
        </header>
        <div class="progress"><div class="progress-fill"></div></div>
        <section class="step" aria-live="polite">
          <span class="step-kind"></span>
          <h2 class="step-title"></h2>
          <p class="step-text"></p>
          <div class="stage"></div>
          <div class="status"><div class="status-round"></div><div class="status-main"></div><div class="status-sub"></div></div>
        </section>
        <footer class="controls">
          <button class="btn btn-ghost" data-act="back">Back</button>
          <button class="btn btn-primary" data-act="primary">Next</button>
          <button class="btn btn-ghost" data-act="skip">Skip</button>
        </footer>
      </div>`;
    this.el = (sel) => this.root.querySelector(sel);
    this.el('.runner-name').textContent = this.exercise.name;
    this.root.querySelector('.runner').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'exit') this.exit();
      if (act === 'back') this.goTo(Math.max(0, this.index - 1));
      if (act === 'skip') this.next();
      if (act === 'primary') this.primaryAction?.();
    });
    this.requestWakeLock();
    this.goTo(0);
  }

  async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      // Not supported or not allowed; the session still works.
    }
  }

  // ---- navigation ----

  teardownStep() {
    this.abort?.abort();
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.primaryAction = null;
    window.speechSynthesis?.cancel();
  }

  next() {
    if (this.index + 1 >= this.steps.length) this.finish();
    else this.goTo(this.index + 1);
  }

  exit() {
    this.teardownStep();
    this.wakeLock?.release?.();
    this.onExit?.();
  }

  async finish() {
    this.teardownStep();
    this.wakeLock?.release?.();
    this.onFinish?.(this.results);
  }

  goTo(i) {
    this.teardownStep();
    this.index = i;
    const step = this.steps[i];
    this.abort = new AbortController();
    const signal = this.abort.signal;

    this.el('.runner-count').textContent = `Step ${i + 1} of ${this.steps.length}`;
    this.el('.progress-fill').style.width = `${(i / this.steps.length) * 100}%`;
    this.el('.step-title').textContent = step.title;
    this.el('.step-text').innerHTML = step.text || '';
    this.el('.step-kind').textContent = {
      timed: `⏱ Timed · continues automatically`,
      manual: '👉 Your pace · press Next when done',
      game: '🎮 Game',
    }[step.kind];
    this.el('.step-kind').dataset.kind = step.kind;
    this.el('.stage').replaceChildren();
    this.el('.stage').className = `stage stage-${step.kind}`;
    this.setStatus('', '');
    this.setRound('');
    this.el('[data-act="back"]').disabled = i === 0;
    this.el('[data-act="skip"]').hidden = step.kind === 'manual';
    this.speak(step.say ?? step.title);

    if (step.kind === 'timed') this.runTimed(step, signal);
    else if (step.kind === 'manual') this.runManual(step, signal);
    else this.runGame(step, signal);
  }

  // ---- shared helpers ----

  ctx(signal) {
    return {
      engine: this.engine,
      profile: this.profile,
      results: this.results,
      range: this.profile.comfort,
      stage: this.el('.stage'),
      signal,
      setStatus: (a, b) => this.setStatus(a, b),
      setRound: (t) => this.setRound(t),
      pitchView: () => this.mountPitchView(),
      sleep: (ms) => new Promise((r) => {
        const t = setTimeout(r, ms);
        signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
      }),
    };
  }

  setStatus(main, sub = '') {
    this.el('.status-main').textContent = main;
    this.el('.status-sub').textContent = sub;
  }

  setRound(text) {
    this.el('.status-round').textContent = text;
  }

  setPrimary(label, action, { disabled = false } = {}) {
    const btn = this.el('[data-act="primary"]');
    btn.textContent = label;
    btn.disabled = disabled;
    this.primaryAction = disabled ? null : action;
  }

  mountPitchView(target = null) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pitch-canvas';
    this.el('.stage').prepend(canvas);
    const view = new PitchView(canvas, this.engine, this.profile.comfort);
    if (target != null) view.setTarget(target);
    this.cleanup.push(() => view.destroy());
    return view;
  }

  startCapture(step) {
    if (!step.capture) return;
    const stop = this.engine.record();
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      this.results[step.capture] = stop();
    };
    this.cleanup.push(finish);
    return finish;
  }

  speak(text) {
    if (!this.settings.voiceGuide || !window.speechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  ring(size = 'lg') {
    const wrap = document.createElement('div');
    wrap.className = `ring ring-${size}`;
    wrap.innerHTML = `
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-bg" cx="60" cy="60" r="${RING_R}"></circle>
        <circle class="ring-fg" cx="60" cy="60" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="0"></circle>
      </svg>
      <div class="ring-label"><span class="ring-num"></span><span class="ring-unit"></span></div>`;
    const fg = wrap.querySelector('.ring-fg');
    return {
      el: wrap,
      set(progress, num, unit = '') {
        fg.style.strokeDashoffset = String(RING_C * progress);
        wrap.querySelector('.ring-num').textContent = num;
        wrap.querySelector('.ring-unit').textContent = unit;
      },
    };
  }

  // ---- step kinds ----

  async runTimed(step, signal) {
    const stage = this.el('.stage');
    let view = null;
    if (step.listen) view = this.mountPitchView(step.target ?? null);
    if (step.visual) {
      const orb = document.createElement('div');
      orb.className = `breath-orb breath-${step.visual}`;
      stage.append(orb);
      orb.style.animationDuration = `${step.duration}s`;
    }
    const ring = this.ring(view ? 'sm' : step.visual ? 'md' : 'lg');
    stage.append(ring.el);

    let paused = false;
    const countdown = new Countdown(step.duration, () => this.engine.now());
    this.setPrimary('Pause', null, { disabled: true });

    // 1. Reference notes.
    if (step.play?.length) {
      this.setStatus('Listen…');
      ring.set(0, '♪');
      let t = this.engine.now() + 0.3;
      const schedule = step.play.map((midi) => { const n = { midi, start: t, end: t + 0.8 }; t += 0.85; return n; });
      await this.engine.playSchedule(schedule);
      if (signal.aborted) return;
    }

    // 2. Get-ready count-in.
    for (let n = step.ready || 0; n > 0; n--) {
      this.setStatus('Get ready…');
      ring.set(0, String(n));
      this.engine.beep('tick');
      await this.ctx(signal).sleep(1000);
      if (signal.aborted) return;
    }
    if (step.ready) this.engine.beep('go');

    // 3. The timed activity itself.
    this.setStatus(step.cue || '');
    const stopCapture = this.startCapture(step);
    countdown.start();
    stage.querySelector('.breath-orb')?.classList.add('go');
    const togglePause = () => {
      paused = !paused;
      if (paused) countdown.pause(); else countdown.resume();
      this.el('.runner').classList.toggle('paused', paused);
      this.el('.stage .breath-orb')?.classList.toggle('paused', paused);
      this.setPrimary(paused ? 'Resume' : 'Pause', togglePause);
    };
    this.setPrimary('Pause', togglePause);

    // Optional early finish once the user has sung and then stopped (e.g. "hold as long as you can").
    let silentSince = null;
    let voicedTime = 0;
    let lastT = null;
    let endedEarly = false;
    if (step.stopOnSilence) {
      const unsub = this.engine.subscribe((f) => {
        const dt = lastT == null ? 0 : f.t - lastT;
        lastT = f.t;
        if (f.muted) return;
        if (f.midi != null) { voicedTime += dt; silentSince = null; }
        else if (voicedTime > 1 && silentSince == null) silentSince = f.t;
        if (silentSince != null && f.t - silentSince > 1.2) endedEarly = true;
      });
      this.cleanup.push(unsub);
    }

    let lastWhole = Math.ceil(step.duration);
    await new Promise((resolve) => {
      const tick = () => {
        if (signal.aborted) return resolve();
        const rem = countdown.remaining();
        ring.set(countdown.progress(), formatSeconds(rem), rem >= 60 ? '' : 'sec');
        const whole = Math.ceil(rem);
        if (whole !== lastWhole && whole <= 3 && whole > 0 && !paused) this.engine.beep('tick');
        lastWhole = whole;
        if (countdown.done || endedEarly) return resolve();
        setTimeout(tick, 50);
      };
      tick();
    });
    if (signal.aborted) return;

    stopCapture?.();
    this.engine.beep('done');
    if (step.onEnd) step.onEnd(this.ctx(signal));
    await this.ctx(signal).sleep(400);
    if (!signal.aborted) this.next();
  }

  runManual(step, signal) {
    if (step.listen) this.mountPitchView(step.target ?? null);
    if (step.html) this.el('.stage').insertAdjacentHTML('beforeend', step.html);
    const stopCapture = this.startCapture(step);
    this.setStatus(step.cue || '');
    const proceed = async () => {
      if (step.onNext) {
        this.setPrimary('…', null, { disabled: true });
        try {
          await step.onNext(this.ctx(signal));
        } catch (err) {
          this.setStatus('Something went wrong', err.message);
          this.setPrimary(step.nextLabel || 'Next', proceed);
          return;
        }
      }
      stopCapture?.();
      step.onEnd?.(this.ctx(signal));
      if (!signal.aborted) this.next();
    };
    this.setPrimary(step.nextLabel || (this.index === this.steps.length - 1 ? 'Finish' : 'Next'), proceed);
  }

  async runGame(step, signal) {
    this.setPrimary('Playing…', null, { disabled: true });
    let result;
    try {
      result = await step.game(this.ctx(signal));
    } catch (err) {
      if (signal.aborted) return;
      this.setStatus('Something went wrong', err.message);
      this.setPrimary('Next', () => this.next());
      return;
    }
    if (signal.aborted) return;
    this.results[step.id] = result;
    this.engine.beep('done');
    this.setRound('Finished');
    this.setStatus(result.score != null ? `Score: ${result.score}` : 'Done', result.summary);
    this.setPrimary(this.index === this.steps.length - 1 ? 'Finish' : 'Next', () => this.next());
  }
}
