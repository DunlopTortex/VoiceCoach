// Interactive games. Each factory returns `async (ctx) => result` for a runner "game" step.
// ctx: { engine, stage, signal, range, results, pitchView(), setStatus(main, sub), setRound(text), sleep(ms) }
// A result is { score: 0-100, summary: string, data }.

import { buildSchedule, scoreNotes } from './analysis.js';
import { foldedCents, midiToName } from './pitch.js';

export function describeCents(avgAbsCents) {
  if (avgAbsCents == null) return 'We could not hear you — sing a little louder or move closer.';
  if (avgAbsCents <= 15) return 'Spot on!';
  if (avgAbsCents <= 30) return 'Very close — nicely in tune.';
  if (avgAbsCents <= 50) return 'Close. Listen carefully and adjust.';
  return 'Keep going — focus on matching each note.';
}

function noteChips(notes) {
  const row = document.createElement('div');
  row.className = 'chips';
  for (const n of notes) {
    const chip = document.createElement('span');
    const good = n.sung && Math.abs(n.cents) <= 50;
    chip.className = `chip ${good ? 'chip-good' : 'chip-bad'}`;
    chip.textContent = `${midiToName(n.midi)} ${!n.sung ? '—' : good ? '✓' : n.cents > 0 ? '↑' : '↓'}`;
    chip.title = n.sung ? `${n.cents > 0 ? '+' : ''}${Math.round(n.cents)} cents` : 'not heard';
    row.append(chip);
  }
  return row;
}

/**
 * Listen-then-sing game: the app plays a phrase, then the user sings it back
 * while the notes scroll past a "now" line.
 */
export function echoGame({ makeRounds, noteDur = 0.6, singDur = 0.9 }) {
  return async (ctx) => {
    const { engine, signal } = ctx;
    const rounds = makeRounds(ctx);
    const view = ctx.pitchView();
    const chipsBox = document.createElement('div');
    ctx.stage.append(chipsBox);
    const scores = [];

    for (let r = 0; r < rounds.length && !signal.aborted; r++) {
      const notes = rounds[r];
      ctx.setRound(`Round ${r + 1} of ${rounds.length}`);
      chipsBox.replaceChildren();

      ctx.setStatus('Listen…', `${notes.length} notes`);
      const listen = buildSchedule(notes, engine.now() + 0.5, noteDur, 0.05);
      view.setSchedule(listen, { sung: false });
      await engine.playSchedule(listen);
      if (signal.aborted) break;

      ctx.setStatus('Get ready…', 'Sing each note as its bar crosses the line.');
      const singStart = engine.now() + 2.4;
      const sing = buildSchedule(notes, singStart, singDur, 0.1);
      view.setSchedule(sing);
      // Count-in: three ticks leading up to the first note.
      for (const ahead of [1.8, 1.2, 0.6]) {
        await engine.waitUntil(singStart - ahead, signal);
        if (!signal.aborted) engine.beep('tick');
      }
      // Record only after the count-in ticks, so the beeps are not mistaken for singing.
      const stop = engine.record();
      await engine.waitUntil(singStart, signal);
      ctx.setStatus('Sing!', 'Follow the bars');
      await engine.waitUntil(sing[sing.length - 1].end + 0.3, signal);
      const frames = stop();
      if (signal.aborted) break;

      const score = scoreNotes(frames, sing);
      scores.push(score);
      ctx.setStatus(`${score.hits} of ${notes.length} notes on pitch`, describeCents(score.avgAbsCents));
      chipsBox.append(noteChips(score.notes));
      engine.beep(score.hits >= notes.length * 0.6 ? 'hit' : 'miss');
      await ctx.sleep(2200);
    }

    view.setSchedule([]);
    const total = scores.reduce((a, s) => a + s.notes.length, 0);
    const hits = scores.reduce((a, s) => a + s.hits, 0);
    const accuracy = scores.length ? Math.round(scores.reduce((a, s) => a + s.accuracy, 0) / scores.length) : 0;
    const sungCents = scores.filter((s) => s.avgAbsCents != null);
    const avgAbsCents = sungCents.length ? Math.round(sungCents.reduce((a, s) => a + s.avgAbsCents, 0) / sungCents.length) : null;
    return {
      score: accuracy,
      summary: `${hits} of ${total} notes on pitch · ${accuracy}% accuracy`,
      data: { accuracy, hits, total, avgAbsCents, notes: scores.flatMap((s) => s.notes) },
    };
  };
}

/**
 * Hear a note, then find it and hold it. A tuner needle shows whether you are sharp or flat.
 */
export function pitchMatchGame({ makeTargets, holdSecs = 1.0, timeout = 10, tolerance = 40 }) {
  return async (ctx) => {
    const { engine, signal } = ctx;
    const targets = makeTargets(ctx);
    const view = ctx.pitchView();

    const tuner = document.createElement('div');
    tuner.className = 'tuner';
    tuner.innerHTML = `
      <div class="tuner-scale"><span>flat</span><span>in tune</span><span>sharp</span></div>
      <div class="tuner-track"><div class="tuner-zone"></div><div class="tuner-needle"></div></div>
      <div class="hold"><div class="hold-fill"></div></div>
      <button class="btn btn-ghost btn-small" type="button">🔊 Hear it again</button>`;
    ctx.stage.append(tuner);
    const needle = tuner.querySelector('.tuner-needle');
    const holdFill = tuner.querySelector('.hold-fill');
    tuner.querySelector('.tuner-zone').style.width = `${tolerance}%`;
    let current = null;
    tuner.querySelector('button').addEventListener('click', () => {
      if (current != null) engine.playNote(current, 1.0);
    });

    let hits = 0;
    const times = [];
    for (let i = 0; i < targets.length && !signal.aborted; i++) {
      const target = targets[i];
      current = target;
      ctx.setRound(`Note ${i + 1} of ${targets.length}`);
      view.setTarget(target);
      holdFill.style.width = '0%';
      needle.style.left = '50%';
      needle.classList.remove('on');
      ctx.setStatus(`Listen: ${midiToName(target)}`, '');
      engine.playNote(target, 1.2);
      await engine.waitUntil(engine.now() + 1.45, signal);
      if (signal.aborted) break;
      ctx.setStatus(`Match ${midiToName(target)}`, 'Sing "ah" and hold it in the band');

      const hit = await new Promise((resolve) => {
        const start = engine.now();
        let held = 0;
        let last = null;
        signal.addEventListener('abort', () => { unsub(); resolve(false); }, { once: true });
        const unsub = engine.subscribe((f) => {
          if (f.muted) return;
          const dt = last == null ? 0 : Math.min(0.1, f.t - last);
          last = f.t;
          if (f.midi != null && f.clarity > 0.6) {
            const cents = foldedCents((f.midi - target) * 100);
            needle.style.left = `${50 + Math.max(-50, Math.min(50, cents / 2))}%`;
            const on = Math.abs(cents) <= tolerance;
            needle.classList.toggle('on', on);
            held = on ? held + dt : Math.max(0, held - dt * 0.5);
          } else {
            held = Math.max(0, held - dt * 0.25);
          }
          holdFill.style.width = `${Math.min(100, (held / holdSecs) * 100)}%`;
          const finished = held >= holdSecs ? true : f.t - start > timeout || signal.aborted ? false : null;
          if (finished != null) {
            unsub();
            if (finished) times.push(f.t - start);
            resolve(finished);
          }
        });
      });
      if (signal.aborted) break;
      if (hit) hits++;
      engine.beep(hit ? 'hit' : 'miss');
      ctx.setStatus(hit ? 'Got it! 🎯' : 'Missed that one', hit ? '' : `It was ${midiToName(target)}. Next one!`);
      await ctx.sleep(1100);
    }

    view.setTarget(null);
    const score = targets.length ? Math.round((hits / targets.length) * 100) : 0;
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    return {
      score,
      summary: `${hits} of ${targets.length} notes matched${avg ? ` · ${avg.toFixed(1)} s on average` : ''}`,
      data: { hits, total: targets.length, avgSeconds: avg },
    };
  };
}

// Random targets spread across the comfortable range, avoiding repeats.
export function randomTargets(range, count, random = Math.random) {
  const out = [];
  while (out.length < count) {
    const m = range.low + Math.floor(random() * (range.high - range.low + 1));
    if (m !== out[out.length - 1]) out.push(m);
  }
  return out;
}
