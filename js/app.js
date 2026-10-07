// App shell: hash routing between Home, Exercises, Progress and Settings, plus running sessions.

import { AudioEngine } from './audio.js';
import { SessionRunner } from './runner.js';
import { ASSESSMENT, EXERCISES, findExercise, needsMic } from './exercises.js';
import { comfortRange, VOICE_TYPES } from './analysis.js';
import { midiToName } from './pitch.js';
import { PitchView } from './pitch-view.js';
import * as store from './storage.js';

const engine = new AudioEngine();
const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
let teardown = null; // cleanup for the current screen (e.g. a running session or mic test)

const KIND_LABEL = { timed: '⏱', manual: '👉', game: '🎮' };

function data() {
  return store.load();
}

function html(strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (i < vals.length ? vals[i] ?? '' : ''), '');
}

function setTab(name) {
  tabs.hidden = !name;
  tabs.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
}

// ---- routing ----

function route() {
  teardown?.();
  teardown = null;
  window.scrollTo(0, 0);
  const [, page = 'home', arg] = location.hash.split('/');
  if (page === 'exercises') return renderExercises();
  if (page === 'ex') return renderDetail(arg);
  if (page === 'run') return startSession(arg);
  if (page === 'progress') return renderProgress();
  if (page === 'settings') return renderSettings();
  if (page === 'report') return renderSavedReport(Number(arg));
  return renderHome();
}

window.addEventListener('hashchange', route);

// ---- screens ----

function exerciseCard(ex, reason = '') {
  return html`
    <a class="card ex-card" href="#/ex/${ex.id}">
      <span class="ex-emoji" aria-hidden="true">${ex.emoji}</span>
      <span class="ex-body">
        <span class="ex-name">${ex.name}</span>
        <span class="ex-blurb">${reason || ex.blurb}</span>
      </span>
      <span class="ex-meta">${ex.minutes} min</span>
    </a>`;
}

function renderHome() {
  setTab('home');
  const { profile, history, assessments } = data();
  const last = assessments[assessments.length - 1];
  const days = store.streak(history);

  const recs = (last?.recommendations || [])
    .map((r) => ({ ex: findExercise(r.id), reason: r.reason }))
    .filter((r) => r.ex)
    .slice(0, 3);

  view.innerHTML = html`
    <header class="page-head">
      <h1>Voice Coach</h1>
      <p class="muted">Train your ear, breath and range a few minutes a day.</p>
    </header>

    ${!last ? html`
      <section class="card hero">
        <div class="hero-emoji" aria-hidden="true">🎙️</div>
        <h2>Start with a voice check</h2>
        <p>Four minutes to find your range, voice type, pitch accuracy and breath control. We'll tailor every exercise to your voice.</p>
        <a class="btn btn-primary btn-block" href="#/ex/assessment">Take the assessment</a>
      </section>` : html`
      <section class="card voice-card">
        <div class="voice-row">
          <div>
            <div class="label">Your voice</div>
            <div class="big">${profile.voiceType?.label ?? '—'}</div>
            <div class="muted">${midiToName(profile.range.low)} – ${midiToName(profile.range.high)} · ${profile.range.span} semitones</div>
          </div>
          <div class="score-badge" style="--p:${last.overall}">${last.overall}</div>
        </div>
        <div class="row-actions">
          <a class="btn btn-ghost btn-small" href="#/report/${assessments.length - 1}">See report</a>
          <a class="btn btn-ghost btn-small" href="#/ex/assessment">Re-assess</a>
        </div>
      </section>`}

    <section class="card today">
      <div>
        <div class="label">Today</div>
        <div class="big">${days ? `🔥 ${days}-day streak` : 'Start a streak'}</div>
      </div>
      <a class="btn btn-primary" href="#/ex/daily-workout">Daily Workout</a>
    </section>

    ${recs.length ? html`<h2 class="section-title">Recommended for you</h2>
      <div class="list">${recs.map((r) => exerciseCard(r.ex, r.reason)).join('')}</div>` : ''}

    <h2 class="section-title">Quick games</h2>
    <div class="list">${EXERCISES.filter((e) => e.category === 'Game').map((e) => exerciseCard(e)).join('')}</div>`;
}

function renderExercises() {
  setTab('exercises');
  const groups = [...new Set(EXERCISES.map((e) => e.category))];
  view.innerHTML = html`
    <header class="page-head"><h1>Exercises</h1>
      <p class="muted">Timed steps continue on their own. For the rest, press Next when you're ready.</p></header>
    ${groups.map((g) => html`
      <h2 class="section-title">${g}</h2>
      <div class="list">${EXERCISES.filter((e) => e.category === g).map((e) => exerciseCard(e)).join('')}</div>`).join('')}
    <h2 class="section-title">Assessment</h2>
    <div class="list">${exerciseCard(ASSESSMENT)}</div>`;
}

function stepSummary(step) {
  if (step.kind === 'timed') return `${step.duration}s`;
  if (step.kind === 'game') return 'game';
  return 'your pace';
}

function renderDetail(id) {
  const ex = findExercise(id);
  if (!ex) return (location.hash = '#/exercises');
  setTab(null);
  const { profile } = data();
  const steps = ex.steps(profile);
  view.innerHTML = html`
    <header class="detail-head">
      <a class="icon-btn" href="${id === 'assessment' ? '#/home' : '#/exercises'}" aria-label="Back">←</a>
    </header>
    <section class="detail">
      <div class="detail-emoji" aria-hidden="true">${ex.emoji}</div>
      <h1>${ex.name}</h1>
      <p class="muted">${ex.blurb}</p>
      <p class="pill-row"><span class="pill">${ex.minutes} min</span><span class="pill">${steps.length} ${steps.length === 1 ? 'step' : 'steps'}</span>
        ${!profile.assessedAt && id !== 'assessment' ? '<span class="pill pill-warn">Using a default range — take the assessment to personalise</span>' : ''}</p>
      <ol class="step-list">
        ${steps.map((s) => html`<li><span class="step-icon" title="${s.kind}">${KIND_LABEL[s.kind]}</span><span>${s.title}</span><span class="muted">${stepSummary(s)}</span></li>`).join('')}
      </ol>
      <p class="error" id="start-error" hidden></p>
    </section>
    <div class="sticky-cta">
      <button class="btn btn-primary btn-block" id="start">Start</button>
    </div>`;

  view.querySelector('#start').addEventListener('click', async (e) => {
    const err = view.querySelector('#start-error');
    e.target.disabled = true;
    try {
      await engine.ensureContext();
      engine.setVolume(data().settings.volume);
      engine.noiseFloor = data().profile.noiseFloor;
      if (needsMic(ex, profile)) await engine.startMic();
      location.hash = `#/run/${id}`;
    } catch (ex2) {
      err.hidden = false;
      err.textContent = ex2.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.'
        : ex2.message;
      e.target.disabled = false;
    }
  });
}

function startSession(id) {
  const ex = findExercise(id);
  // A session needs the audio context unlocked by a tap, so after a reload send the user to the start screen.
  if (!ex || !engine.ctx) return (location.hash = `#/ex/${id}`);
  setTab(null);
  const { profile, settings } = data();
  const sessionProfile = structuredClone(profile);
  const runner = new SessionRunner({
    root: view,
    exercise: ex,
    steps: ex.steps(sessionProfile),
    engine,
    profile: sessionProfile,
    settings,
    onExit: () => { location.hash = id === 'assessment' ? '#/home' : `#/ex/${id}`; },
    onFinish: (results) => finishSession(ex, results, sessionProfile),
  });
  runner.start();
  teardown = () => {
    runner.teardownStep();
    engine.stopMic();
  };
}

function finishSession(ex, results, sessionProfile) {
  engine.stopMic();
  teardown = null;
  const outcome = ex.finish(results, sessionProfile, engine);
  let reportIndex = null;
  store.update((d) => {
    d.history.push({ date: new Date().toISOString(), id: ex.id, name: ex.name, score: outcome.score });
    if (outcome.profile) Object.assign(d.profile, outcome.profile);
    if (outcome.report) {
      d.assessments.push(outcome.report);
      reportIndex = d.assessments.length - 1;
    }
  });

  view.innerHTML = html`
    <section class="complete">
      <div class="complete-emoji" aria-hidden="true">🎉</div>
      <h1>${ex.id === 'assessment' ? 'Your voice report' : 'Exercise complete'}</h1>
      ${outcome.score != null ? html`<div class="score-badge score-badge-lg" style="--p:${outcome.score}">${outcome.score}</div>` : ''}
      <div class="complete-body">${outcome.report ? reportHtml(outcome.report) : outcome.html || ''}</div>
      <div class="complete-actions">
        <a class="btn btn-ghost" href="#/ex/${ex.id}">Do it again</a>
        <a class="btn btn-primary" href="#/home">Done</a>
      </div>
    </section>`;
  if (reportIndex != null) history.replaceState(null, '', `#/report/${reportIndex}`);
  setTab(null);
}

// ---- report ----

const SCORE_LABELS = {
  pitch: ['🎯', 'Pitch accuracy'],
  range: ['↕️', 'Range'],
  breath: ['🌬️', 'Breath length'],
  steadiness: ['📏', 'Steadiness'],
  expression: ['🗣️', 'Speaking expression'],
};

function rangeBar(report) {
  const lo = 36, hi = 88; // C2 .. E6
  const pct = (m) => ((Math.max(lo, Math.min(hi, m)) - lo) / (hi - lo)) * 100;
  const typeRow = VOICE_TYPES.map((t) => html`
    <div class="vt-row ${t.id === report.voiceType.id ? 'vt-me' : ''}">
      <span class="vt-label">${t.label}</span>
      <span class="vt-track"><span class="vt-span" style="left:${pct(t.low)}%;width:${pct(t.high) - pct(t.low)}%"></span></span>
    </div>`).join('');
  return html`
    <div class="range-chart">
      <div class="vt-row vt-you">
        <span class="vt-label">You</span>
        <span class="vt-track"><span class="vt-span" style="left:${pct(report.range.low)}%;width:${pct(report.range.high) - pct(report.range.low)}%"></span></span>
      </div>
      ${typeRow}
      <div class="vt-axis"><span>C2</span><span>C3</span><span>C4</span><span>C5</span><span>C6</span></div>
    </div>`;
}

function reportHtml(report) {
  const s = report.sustain;
  return html`
    <div class="report">
      <div class="report-grid">
        <div class="stat"><div class="label">Voice type</div><div class="big">${report.voiceType.label}</div><div class="muted">estimate</div></div>
        <div class="stat"><div class="label">Range</div><div class="big">${report.rangeNames.low}–${report.rangeNames.high}</div><div class="muted">${report.range.span} semitones${report.range.measured ? '' : ' (default)'}</div></div>
        <div class="stat"><div class="label">Speaking pitch</div><div class="big">${report.speakingMidi != null ? midiToName(report.speakingMidi) : '—'}</div><div class="muted">${report.speakingVariability != null ? `±${report.speakingVariability} semitones` : 'not heard'}</div></div>
        <div class="stat"><div class="label">Longest note</div><div class="big">${s?.duration ? `${s.duration.toFixed(1)}s` : '—'}</div><div class="muted">${s?.wobbleCents != null ? `${s.wobbleCents}¢ wobble` : ''}</div></div>
      </div>
      ${rangeBar(report)}
      <h3>Scores</h3>
      <div class="bars">
        ${Object.entries(report.scores).map(([k, v]) => html`
          <div class="bar-row"><span>${SCORE_LABELS[k][0]} ${SCORE_LABELS[k][1]}</span>
            <span class="bar"><span class="bar-fill" style="width:${v}%"></span></span><span class="bar-num">${v}</span></div>`).join('')}
      </div>
      ${report.melody?.notes?.length ? html`<p class="muted">Melody echo: ${report.melody.hits} of ${report.melody.total} notes on pitch${report.melody.avgAbsCents != null ? `, ${report.melody.avgAbsCents} cents off on average` : ''}.</p>` : ''}
      <h3>Recommended exercises</h3>
      <div class="list">${report.recommendations.filter((r) => findExercise(r.id))
        .map((r) => exerciseCard(findExercise(r.id), r.reason)).join('')}</div>
    </div>`;
}

function renderSavedReport(index) {
  const report = data().assessments[index];
  if (!report) return (location.hash = '#/progress');
  setTab(null);
  view.innerHTML = html`
    <header class="detail-head"><a class="icon-btn" href="#/progress" aria-label="Back">←</a></header>
    <section class="complete">
      <h1>Voice report</h1>
      <p class="muted">${new Date(report.date).toLocaleDateString(undefined, { dateStyle: 'long' })}</p>
      <div class="score-badge score-badge-lg" style="--p:${report.overall}">${report.overall}</div>
      <div class="complete-body">${reportHtml(report)}</div>
    </section>`;
}

// ---- progress ----

function renderProgress() {
  setTab('progress');
  const { history, assessments } = data();
  const days = store.streak(history);
  const scored = assessments.map((a, i) => ({ i, a }));
  const chart = scored.length ? html`
    <div class="chart" role="img" aria-label="Assessment scores over time">
      ${scored.slice(-8).map(({ a, i }) => html`
        <a class="chart-col" href="#/report/${i}">
          <span class="chart-val">${a.overall}</span>
          <span class="chart-bar" style="height:${Math.max(4, a.overall)}%"></span>
          <span class="chart-label">${new Date(a.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </a>`).join('')}
    </div>` : '<p class="muted">Take the assessment to start tracking your progress.</p>';

  view.innerHTML = html`
    <header class="page-head"><h1>Progress</h1></header>
    <section class="stats-row">
      <div class="card stat"><div class="big">${history.length}</div><div class="label">sessions</div></div>
      <div class="card stat"><div class="big">${days}</div><div class="label">day streak</div></div>
      <div class="card stat"><div class="big">${assessments.length}</div><div class="label">assessments</div></div>
    </section>
    <h2 class="section-title">Voice score</h2>
    <section class="card">${chart}</section>
    <h2 class="section-title">Recent sessions</h2>
    <section class="card">
      ${history.length ? html`<ul class="history">${history.slice(-15).reverse().map((h) => html`
        <li><span>${findExercise(h.id)?.emoji ?? '•'} ${h.name}</span>
            <span class="muted">${new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span class="history-score">${h.score ?? '✓'}</span></li>`).join('')}</ul>`
        : '<p class="muted">No sessions yet. Your finished exercises will appear here.</p>'}
    </section>`;
}

// ---- settings ----

function renderSettings() {
  setTab('settings');
  const { settings, profile } = data();
  const noteOptions = (sel) => Array.from({ length: 49 }, (_, i) => 36 + i)
    .map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${midiToName(m)}</option>`).join('');

  view.innerHTML = html`
    <header class="page-head"><h1>Settings</h1></header>
    <section class="card form">
      <label class="toggle"><span><strong>Spoken guidance</strong><br><span class="muted">Read each step's title aloud. Best with headphones.</span></span>
        <input type="checkbox" id="voiceGuide" ${settings.voiceGuide ? 'checked' : ''}></label>
      <label class="field"><span><strong>Reference tone volume</strong></span>
        <input type="range" id="volume" min="0.1" max="1" step="0.05" value="${settings.volume}"></label>
      <button class="btn btn-ghost btn-small" id="testTone">🔊 Play a test note</button>
    </section>

    <h2 class="section-title">Microphone check</h2>
    <section class="card">
      <p class="muted">Sing or hum and watch your pitch appear.</p>
      <div class="mic-test" id="micStage" hidden><canvas class="pitch-canvas"></canvas><div class="big center" id="micNote">—</div></div>
      <button class="btn btn-ghost btn-small" id="micBtn">🎙️ Start microphone</button>
      <p class="error" id="micErr" hidden></p>
    </section>

    <h2 class="section-title">Your range</h2>
    <section class="card form">
      <p class="muted">Set by the assessment. You can adjust it by hand; exercises use the comfortable middle of this range.</p>
      <div class="range-pick">
        <label class="field"><span>Lowest</span><select id="low">${noteOptions(profile.range.low)}</select></label>
        <label class="field"><span>Highest</span><select id="high">${noteOptions(profile.range.high)}</select></label>
      </div>
      <button class="btn btn-ghost btn-small" id="saveRange">Save range</button>
      <span class="muted" id="rangeSaved"></span>
    </section>

    <h2 class="section-title">Data</h2>
    <section class="card">
      <p class="muted">Everything stays on this device. Nothing is uploaded.</p>
      <button class="btn btn-danger btn-small" id="reset">Reset all data</button>
    </section>`;

  const $ = (id) => view.querySelector(`#${id}`);
  $('voiceGuide').addEventListener('change', (e) => store.update((d) => { d.settings.voiceGuide = e.target.checked; }));
  $('volume').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    engine.setVolume(v);
    store.update((d) => { d.settings.volume = v; });
  });
  $('testTone').addEventListener('click', async () => {
    await engine.ensureContext();
    engine.setVolume(data().settings.volume);
    engine.playNote(Math.round((profile.comfort.low + profile.comfort.high) / 2), 1);
  });

  let micView = null;
  let unsub = null;
  const stopMicTest = () => {
    micView?.destroy();
    unsub?.();
    micView = null;
    engine.stopMic();
  };
  teardown = stopMicTest;
  $('micBtn').addEventListener('click', async () => {
    if (micView) {
      stopMicTest();
      $('micStage').hidden = true;
      $('micBtn').textContent = '🎙️ Start microphone';
      return;
    }
    try {
      await engine.startMic();
    } catch (err) {
      $('micErr').hidden = false;
      $('micErr').textContent = err.message;
      return;
    }
    $('micStage').hidden = false;
    $('micBtn').textContent = 'Stop microphone';
    micView = new PitchView(view.querySelector('#micStage canvas'), engine, profile.comfort);
    unsub = engine.subscribe((f) => {
      if (f.midi != null && f.clarity > 0.6) {
        const cents = Math.round((f.midi - Math.round(f.midi)) * 100);
        $('micNote').textContent = `${midiToName(f.midi)} ${cents >= 0 ? '+' : ''}${cents}¢`;
      }
    });
  });

  $('saveRange').addEventListener('click', () => {
    const low = Number($('low').value);
    const high = Number($('high').value);
    if (high - low < 5) {
      $('rangeSaved').textContent = 'Pick a range of at least 5 semitones.';
      return;
    }
    store.update((d) => {
      d.profile.range = { low, high, span: high - low, measured: d.profile.range.measured };
      d.profile.comfort = comfortRange(low, high);
    });
    $('rangeSaved').textContent = 'Saved.';
  });

  $('reset').addEventListener('click', () => {
    if (confirm('Delete your assessments, history and settings from this device?')) {
      store.reset();
      location.hash = '#/home';
    }
  });
}

route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
