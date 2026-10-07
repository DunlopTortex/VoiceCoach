// End-to-end check in a real browser. The microphone is replaced by a "virtual singer":
// an oscillator the test controls, so every part of the audio pipeline runs for real.
//
//   npm start            (serves the app on :8080, in another terminal)
//   node tests/e2e.mjs   (needs Playwright; SCREENSHOTS=dir to save screenshots)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SCREENSHOTS;
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const noteToMidi = (name) => { const m = name.match(/^([A-G]#?)(-?\d)$/); return NOTE[m[1]] + (Number(m[2]) + 1) * 12; };

const fakeMic = () => {
  let ctx, osc, gain;
  const played = [];
  window.__played = played;
  // Log the app's reference notes so the singer can echo them.
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    if (this.type === 'triangle' && this.context !== ctx) played.push(this.frequency.value);
    return start.call(this, when);
  };
  const f = (midi) => 440 * 2 ** ((midi - 69) / 12);
  window.__voice = {
    // Sing a note now (null = silence).
    set(midi) {
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(midi == null ? 0 : 0.3, t);
      if (midi != null) osc.frequency.setValueAtTime(f(midi), t);
    },
    // Sing a sequence: [{ midi, at: seconds from now, dur }].
    sing(notes) {
      const t0 = ctx.currentTime;
      for (const n of notes) {
        osc.frequency.setValueAtTime(f(n.midi), t0 + n.at);
        gain.gain.setValueAtTime(0.3, t0 + n.at);
        gain.gain.setValueAtTime(0, t0 + n.at + n.dur);
      }
    },
    // Glide between two notes.
    glide(from, to, secs) {
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.3, t);
      osc.frequency.setValueAtTime(f(from), t);
      osc.frequency.exponentialRampToValueAtTime(f(to), t + secs);
    },
  };
  navigator.mediaDevices.getUserMedia = async () => {
    ctx = new AudioContext();
    osc = ctx.createOscillator();
    const real = new Float32Array([0, 1, 0.5, 0.3, 0.15]);
    osc.setPeriodicWave(ctx.createPeriodicWave(real, new Float32Array(real.length)));
    gain = ctx.createGain();
    gain.gain.value = 0;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    return dest.stream;
  };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(fakeMic);
const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const text = async (sel) => (await page.locator(sel).first().textContent()).trim();
const title = () => text('.step-title');
const status = () => text('.status-main');

async function waitFor(fn, timeout = 20000, label = 'condition') {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function start(id) {
  await page.goto(`${BASE}#/ex/${id}`);
  await page.click('#start');
  await page.waitForSelector('.runner');
}

// ---- home ----
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();
check(await page.locator('text=Take the assessment').isVisible(), 'home invites a first-time user to the assessment');
await shot('01-home');

// ---- timed steps continue automatically; manual steps wait for Next ----
await start('breath');
check((await title()) === 'Set up your posture', 'breath exercise opens on a manual step');
check((await text('[data-act="primary"]')) === 'Next', 'manual step shows a Next button');
await sleep(1500);
check((await title()) === 'Set up your posture', 'manual step waits for the user');
await page.click('[data-act="primary"]');
check((await title()) === 'Breathe in (1/4)', 'Next moves to the first timed step');
check((await text('.step-kind')).includes('continues automatically'), 'timed step is labelled as auto-continuing');
await sleep(2000);
await shot('02-breathing-timer');
await waitFor(async () => (await title()) === 'Hold (1/4)', 6000, 'auto-advance to Hold');
check(true, 'timed step advanced on its own when the timer ran out');
// Pause holds the timer.
await page.click('[data-act="primary"]');
const pausedAt = await text('.ring-num');
await sleep(2000);
check((await title()) === 'Hold (1/4)' && (await text('.ring-num')) === pausedAt, `pause freezes the countdown (at ${pausedAt})`);
await page.click('[data-act="primary"]');
await waitFor(async () => (await title()) === 'Breathe out (1/4)', 6000, 'resume and advance');
check(true, 'resume continues to the next step');
await page.click('[data-act="exit"]');

// ---- pitch match game with a singer who listens to the target ----
await start('pitch-match');
await shot('03-pitch-match');
let matched = 0;
await waitFor(async () => {
  const s = await status();
  const m = s.match(/^Match ([A-G]#?-?\d)/);
  if (m) {
    await page.evaluate((midi) => window.__voice.set(midi + 0.1), noteToMidi(m[1]));
    await sleep(500);
    if (matched === 2) await shot('04-pitch-match-singing');
    await waitFor(async () => !(await status()).startsWith('Match'), 12000, 'note matched');
    await page.evaluate(() => window.__voice.set(null));
    matched++;
  }
  return (await text('.status-round')) === 'Finished';
}, 120000, 'pitch match to finish');
const pmResult = await text('.status-sub');
check(pmResult.startsWith('8 of 8'), `pitch match scores a perfect singer: "${pmResult}"`);
check((await text('[data-act="primary"]')) === 'Finish', 'game ends with a Finish button');
await page.click('[data-act="primary"]');
await page.waitForSelector('.complete');
check(await page.locator('.complete .score-badge').innerText() === '100', 'completion screen shows score 100');
await shot('05-complete');

// ---- full assessment with a virtual singer ----
await start('assessment');
await page.click('[data-act="primary"]'); // Start
await waitFor(async () => (await title()) === 'Speak naturally', 8000, 'speaking step');
// "Speech": wander between notes around A2.
await waitFor(async () => (await status()) !== 'Get ready…', 6000, 'count-in');
await page.evaluate(() => window.__voice.sing(Array.from({ length: 22 }, (_, i) => ({ midi: 45 + 3 * Math.sin(i / 2), at: i * 0.5, dur: 0.48 }))));
await shot('06-assess-speaking');
await waitFor(async () => (await title()) === 'Find your lowest note', 15000, 'low step');
await waitFor(async () => (await status()) !== 'Get ready…', 6000, 'count-in');
await page.evaluate(() => window.__voice.glide(52, 41, 4));
await waitFor(async () => (await title()) === 'Find your highest note', 15000, 'high step');
await page.evaluate(() => window.__voice.set(null));
await waitFor(async () => (await status()) !== 'Get ready…', 6000, 'count-in');
await page.evaluate(() => { window.__voice.glide(52, 65, 4); window.__played.splice(0); });
await sleep(5000);
await shot('07-assess-range');
await waitFor(async () => (await title()) === 'Echo the melody', 15000, 'melody step');
await page.evaluate(() => window.__voice.set(null));
// Echo each melody: remember what the app played, sing it back on the beat.
let rounds = 0;
await waitFor(async () => {
  const s = await status();
  if (s === 'Get ready…') {
    const notes = await page.evaluate(() => window.__played.splice(0).map((f) => 69 + 12 * Math.log2(f / 440)));
    await page.evaluate((ns) => window.__voice.sing(ns.map((midi, i) => ({ midi, at: 2.35 + i * 1.0, dur: 0.9 }))), notes);
    rounds++;
    if (process.env.DEBUG) console.log('  singing', notes.map((n) => n.toFixed(2)).join(' '));
    if (rounds === 2) { await sleep(4200); await shot('08-assess-melody'); }
    await waitFor(async () => (await status()) !== 'Get ready…', 8000, 'sing phase');
  }
  return (await text('.status-round')) === 'Finished';
}, 90000, 'melody game');
check(rounds === 3, 'assessment plays 3 melody rounds');
const mel = await text('.status-sub');
if (process.env.DEBUG) console.log('  chips', await page.locator('.chip').evaluateAll((els) => els.map((e) => `${e.textContent} ${e.title}`).join(' | ')));
check(/^1[12] of 12 notes on pitch/.test(mel), `melody echo scores an accurate singer: "${mel}"`);
await page.click('[data-act="primary"]');
await waitFor(async () => (await title()) === 'Hold a long "ah"', 5000, 'sustain step');
await waitFor(async () => (await status()) !== 'Get ready…', 6000, 'count-in');
await page.evaluate(() => window.__voice.sing([{ midi: 48, at: 0, dur: 8 }]));
const t0 = Date.now();
await page.waitForSelector('.complete', { timeout: 30000 });
const held = (Date.now() - t0) / 1000;
check(held < 14, `40-second "hold" step ended early once the singer stopped (${held.toFixed(1)}s)`);
await shot('09-report');
const report = await page.locator('.complete-body').innerText();
check(report.includes('F2–F4') || report.includes('F2–E4') || report.includes('F#2–F4'), 'report shows the measured range (~F2–F4)');
check(/Bass|Baritone/.test(report), 'report classifies a low voice as bass/baritone');
check(/8\.\ds/.test(report) || /7\.\ds/.test(report), 'report shows the ~8 second sustain');
await page.locator('.complete-body h3').last().scrollIntoViewIfNeeded();
await shot('10-report-recs');

// ---- the profile now drives the home screen and exercises ----
await page.goto(`${BASE}#/home`);
check(await page.locator('.voice-card').isVisible(), 'home shows the voice summary after assessment');
await shot('11-home-after');
await page.goto(`${BASE}#/progress`);
check((await page.locator('.history li').count()) === 2, 'progress lists finished sessions');
await shot('12-progress');
await page.goto(`${BASE}#/exercises`);
await shot('13-exercises');
await page.goto(`${BASE}#/ex/scale-ladder`);
await shot('14-detail');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
