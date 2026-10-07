// The exercise catalogue. Each exercise builds its steps from the user's profile
// (so notes land in their comfortable range) and turns the step results into a score.

import {
  analyzeExtreme, analyzeSpeaking, analyzeSustain, buildReport, comfortRange,
  generateMelody, scaleNotes,
} from './analysis.js';
import { echoGame, pitchMatchGame, randomTargets } from './games.js';
import { midiToName, percentile } from './pitch.js';

const mid = (range) => Math.round((range.low + range.high) / 2);

// ---- reusable step builders ----

const posture = {
  kind: 'manual',
  title: 'Set up your posture',
  text: `Stand or sit tall with your feet flat and shoulders relaxed. Unclench your jaw.
         Rest one hand on your belly so you can feel it move as you breathe.`,
};

function breathCycle(n, total, { inhale = 4, hold = 4, exhale = 6 } = {}) {
  const tag = total > 1 ? ` (${n}/${total})` : '';
  return [
    { kind: 'timed', title: `Breathe in${tag}`, duration: inhale, visual: 'inhale', say: 'Breathe in',
      text: 'In through your nose. Let your belly expand, not your shoulders.' },
    { kind: 'timed', title: `Hold${tag}`, duration: hold, visual: 'hold', say: 'Hold',
      text: 'Hold gently, without tensing your throat.' },
    { kind: 'timed', title: `Breathe out${tag}`, duration: exhale, visual: 'exhale', say: 'And out',
      text: 'Slowly out through pursed lips, as if cooling soup.' },
  ];
}

const breathCycles = (count, opts) => Array.from({ length: count }, (_, i) => breathCycle(i + 1, count, opts)).flat();

// Without a range (during the assessment, before it is known) there is no reference note.
const sustainStep = (range, capture = 'sustain') => ({
  kind: 'timed',
  title: 'Hold a long "ah"',
  duration: 40,
  ready: 3,
  play: range ? [mid(range)] : undefined,
  target: range ? mid(range) : undefined,
  listen: true,
  capture,
  stopOnSilence: true,
  cue: 'Hold it steady…',
  text: 'Take a full breath and sing "ah" on this note for as long as you comfortably can. Stop when you run out of air — the step ends on its own.',
});

const lipTrills = (secs = 30) => ({
  kind: 'timed', title: 'Lip trills', duration: secs, ready: 3, listen: true,
  text: 'Blow through loose lips to make a "brrr" sound, like a motorboat, and glide up and down. Press lightly on your cheeks if your lips won\'t buzz.',
  cue: 'Brrr… glide up and down',
});

const humming = (range, secs = 30) => ({
  kind: 'timed', title: 'Hum', duration: secs, ready: 2, listen: true,
  play: [mid(range)], target: mid(range),
  text: 'Hum "mmm" on this note with lips closed and teeth apart. Feel the buzz on your lips and nose.',
  cue: 'Mmm… feel the buzz',
});

const sirens = (secs = 30) => ({
  kind: 'timed', title: 'Sirens', duration: secs, ready: 3, listen: true,
  text: 'Sing "ng" (as in "sing") and slide smoothly from low to high and back down, like a siren. Keep it light — no pushing.',
  cue: 'Slide low → high → low',
});

const rest = (secs = 8) => ({
  kind: 'timed', title: 'Rest', duration: secs, visual: 'inhale', say: 'Rest',
  text: 'Relax and take an easy breath.',
});

function longToneSteps(range, count = 3) {
  const notes = [range.low + 3, mid(range), range.high - 3].slice(0, count);
  return notes.flatMap((note, i) => [
    {
      kind: 'timed', title: `Long tone on ${midiToName(note)}`, duration: 12, ready: 2,
      play: [note], target: note, listen: true, capture: `tone${i}`,
      text: 'Sing "ah" and keep the line flat and centred in the band. Steady breath, steady note.',
      cue: 'Steady…',
    },
    ...(i < notes.length - 1 ? [rest(6)] : []),
  ]);
}

const pitchMatchStep = (count) => ({
  kind: 'game', id: 'pitchMatch', title: 'Match the note',
  text: 'Listen to each note, then sing it back on "ah". Hold it in the band until the bar fills up. The needle shows whether you are flat (left) or sharp (right).',
  game: pitchMatchGame({ makeTargets: (ctx) => randomTargets(ctx.range, count) }),
});

const scaleLadderStep = (rounds) => ({
  kind: 'game', id: 'scale', title: 'Scale ladder',
  text: 'Listen to the 5-note scale, then sing it back on "ah" as the bars reach the line. Each round starts a half step higher.',
  game: echoGame({
    noteDur: 0.45,
    singDur: 0.6,
    makeRounds: (ctx) => {
      const top = ctx.range.high - 7;
      const start = Math.min(ctx.range.low + 1, top);
      return Array.from({ length: rounds }, (_, i) => scaleNotes(Math.min(start + i, top)));
    },
  }),
});

const melodyEchoStep = (lengths, id = 'melody') => ({
  kind: 'game', id, title: 'Melody echo',
  text: 'Listen to the short melody, then sing it back on "la" as the bars reach the line. Melodies get longer as you go.',
  game: echoGame({ makeRounds: (ctx) => lengths.map((n) => generateMelody(ctx.range, n)) }),
});

const gameScore = (results, ids) => {
  const scores = ids.map((id) => results[id]?.score).filter((s) => s != null);
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
};

function sustainSummary(frames) {
  const s = analyzeSustain(frames || []);
  if (!s.duration) return { score: null, html: '<p>We didn\'t hear a long tone this time. Check your microphone and try again.</p>' };
  return {
    score: Math.round(Math.min(100, (s.duration / 20) * 100)),
    html: `<p>You held your note for <strong>${s.duration.toFixed(1)} seconds</strong>${s.wobbleCents != null ? ` with a steadiness of <strong>${s.steadiness}%</strong>` : ''}.</p>
           <p class="muted">20 seconds is a great target. Breath exercises every day will lengthen it.</p>`,
    sustain: s,
  };
}

// ---- the catalogue ----

export const EXERCISES = [
  {
    id: 'daily-workout',
    name: 'Daily Workout',
    emoji: '🌟',
    category: 'Routine',
    minutes: 10,
    blurb: 'A balanced routine: breathing, warm-up, pitch games, scales and a long tone.',
    steps: (p) => [
      posture,
      ...breathCycles(2),
      lipTrills(20),
      humming(p.comfort, 20),
      pitchMatchStep(5),
      scaleLadderStep(3),
      ...longToneSteps(p.comfort, 1),
      { kind: 'timed', title: 'Cool down', duration: 20, ready: 0, listen: true,
        text: 'Hum gently and slide down from the middle of your voice to the bottom, a few times. Let everything relax.' },
      { kind: 'manual', title: 'Well done!', text: 'Have a sip of water. Doing this every day is the fastest way to improve.' },
    ],
    finish: (r) => {
      const score = gameScore(r, ['pitchMatch', 'scale']);
      const tone = analyzeSustain(r.tone0 || []);
      return {
        score,
        html: `<ul class="result-list">
          ${r.pitchMatch ? `<li>🎯 Pitch match: ${r.pitchMatch.summary}</li>` : ''}
          ${r.scale ? `<li>🪜 Scale ladder: ${r.scale.summary}</li>` : ''}
          ${tone.wobbleCents != null ? `<li>📏 Long tone steadiness: ${tone.steadiness}%</li>` : ''}
        </ul>`,
      };
    },
  },
  {
    id: 'breath',
    name: 'Breath Foundation',
    emoji: '🌬️',
    category: 'Breathing',
    minutes: 4,
    blurb: 'Paced belly breathing, a controlled hiss, and a long tone to build breath support.',
    steps: (p) => [
      posture,
      ...breathCycles(4),
      { kind: 'timed', title: 'Steady hiss', duration: 25, ready: 3, say: 'Hiss',
        text: 'Breathe in, then let the air out on a long, even "sss". Keep the sound the same strength the whole time. Breathe again if you run out.',
        cue: 'Sss… keep it even' },
      sustainStep(p.comfort),
    ],
    finish: (r) => sustainSummary(r.sustain),
  },
  {
    id: 'warmup',
    name: 'Vocal Warm-Up',
    emoji: '🔥',
    category: 'Warm-up',
    minutes: 4,
    blurb: 'Release tension, then wake up the voice with lip trills, humming and sirens.',
    steps: (p) => [
      { kind: 'manual', title: 'Warm up gently', text: 'A warm-up prepares your voice the way stretching prepares your muscles. Nothing here should hurt or strain.' },
      { kind: 'timed', title: 'Shoulder and neck rolls', duration: 30, ready: 0,
        text: 'Roll your shoulders back slowly five times, then forward. Then gently tilt your head side to side.' },
      { kind: 'timed', title: 'Jaw release', duration: 20, ready: 0,
        text: 'Massage the hinge of your jaw in small circles. Let your mouth hang open, then do a big yawn-sigh.' },
      lipTrills(30),
      humming(p.comfort, 30),
      sirens(30),
      { kind: 'manual', title: 'You\'re warmed up', text: 'Your voice is ready. Try a game or the Daily Workout next.' },
    ],
    finish: () => ({ score: null, html: '<p>Nice work — your voice is warmed up and ready to sing.</p>' }),
  },
  {
    id: 'pitch-match',
    name: 'Pitch Match',
    emoji: '🎯',
    category: 'Game',
    minutes: 3,
    blurb: 'Hear a note, find it with your voice and hold it in the target band.',
    steps: () => [pitchMatchStep(8)],
    finish: (r) => ({ score: r.pitchMatch?.score ?? null, html: `<p>${r.pitchMatch?.summary ?? 'Skipped.'}</p>` }),
  },
  {
    id: 'melody-echo',
    name: 'Melody Echo',
    emoji: '🎵',
    category: 'Game',
    minutes: 4,
    blurb: 'Listen to a short tune and sing it back. Melodies grow as you go.',
    steps: () => [melodyEchoStep([3, 4, 4, 5, 6])],
    finish: (r) => ({ score: r.melody?.score ?? null, html: `<p>${r.melody?.summary ?? 'Skipped.'}</p>` }),
  },
  {
    id: 'scale-ladder',
    name: 'Scale Ladder',
    emoji: '🪜',
    category: 'Game',
    minutes: 4,
    blurb: 'Sing do-re-mi-fa-so-fa-mi-re-do, climbing a half step each round.',
    steps: () => [scaleLadderStep(5)],
    finish: (r) => ({ score: r.scale?.score ?? null, html: `<p>${r.scale?.summary ?? 'Skipped.'}</p>` }),
  },
  {
    id: 'long-tones',
    name: 'Long Tones',
    emoji: '📏',
    category: 'Control',
    minutes: 2,
    blurb: 'Hold notes steady at the bottom, middle and top of your range.',
    steps: (p) => [
      { kind: 'manual', title: 'Steady as she goes', text: 'You will hold three notes for 12 seconds each. Aim for a flat, straight line on the screen.' },
      ...longToneSteps(p.comfort, 3),
    ],
    finish: (r) => {
      const tones = [0, 1, 2].map((i) => analyzeSustain(r[`tone${i}`] || [])).filter((t) => t.wobbleCents != null);
      if (!tones.length) return { score: null, html: '<p>We didn\'t hear enough singing to score this one.</p>' };
      const score = Math.round(tones.reduce((a, t) => a + t.steadiness, 0) / tones.length);
      return {
        score,
        html: `<p>Average steadiness: <strong>${score}%</strong></p>
               <p class="muted">${score >= 80 ? 'Rock solid!' : 'Keep the breath flowing evenly and relax your throat to steady the note.'}</p>`,
      };
    },
  },
  {
    id: 'range-stretch',
    name: 'Range Stretch',
    emoji: '↕️',
    category: 'Range',
    minutes: 3,
    blurb: 'Gentle sirens to explore and widen the top and bottom of your voice.',
    steps: () => [
      { kind: 'manual', title: 'Stretch, don\'t strain', text: 'Explore the edges of your voice gently. A light, airy sound at the top is fine. Stop if anything hurts.' },
      lipTrills(20),
      ...[1, 2].flatMap((n) => [
        { kind: 'timed', title: `Slide to the bottom (${n}/2)`, duration: 12, ready: 3, listen: true, capture: `low${n}`,
          text: 'Sing "ah" and slide slowly down to your lowest note. Hold it there.' },
        { kind: 'timed', title: `Slide to the top (${n}/2)`, duration: 12, ready: 3, listen: true, capture: `high${n}`,
          text: 'Sing "whee" and slide slowly up to your highest note. Hold it lightly.' },
        rest(8),
      ]),
    ],
    finish: (r, profile) => {
      const lows = [r.low1, r.low2].map((f) => analyzeExtreme(f || [], 'low')).filter((v) => v != null);
      const highs = [r.high1, r.high2].map((f) => analyzeExtreme(f || [], 'high')).filter((v) => v != null);
      if (!lows.length || !highs.length) return { score: null, html: '<p>We couldn\'t hear the top and bottom of your range this time.</p>' };
      const low = Math.round(Math.min(...lows));
      const high = Math.round(Math.max(...highs));
      const span = high - low;
      const prev = profile.range;
      const records = [];
      const update = {};
      if (prev?.measured && low < prev.low) records.push(`new lowest note ${midiToName(low)}`);
      if (prev?.measured && high > prev.high) records.push(`new highest note ${midiToName(high)}`);
      if (records.length) {
        const range = { ...prev, low: Math.min(prev.low, low), high: Math.max(prev.high, high) };
        range.span = range.high - range.low;
        Object.assign(update, { range, comfort: comfortRange(range.low, range.high) });
      }
      return {
        score: Math.round(Math.min(100, (span / 24) * 100)),
        html: `<p>Today you sang from <strong>${midiToName(low)}</strong> to <strong>${midiToName(high)}</strong> — ${span} semitones.</p>
               ${records.length ? `<p class="highlight">🏆 Personal best: ${records.join(' and ')}!</p>` : ''}`,
        profile: records.length ? update : undefined,
      };
    },
  },
  {
    id: 'expressive-speaking',
    name: 'Expressive Speaking',
    emoji: '🗣️',
    category: 'Speaking',
    minutes: 3,
    blurb: 'Bring melody into your speaking voice so you sound engaged and confident.',
    steps: () => {
      const line = '“I can\'t believe it — we actually won the whole thing!”';
      return [
        { kind: 'manual', title: 'Your speaking melody', text: 'Engaging speakers move their pitch up and down. Let\'s hear the difference.' },
        { kind: 'manual', title: 'Read it like a robot', listen: true, capture: 'flat',
          text: `Read this aloud in a flat, bored voice. Press Next when you're done.<br><span class="quote">${line}</span>` },
        { kind: 'manual', title: 'Now read it with feeling', listen: true, capture: 'lively',
          text: `Read it again like you're telling a friend amazing news. Let your voice rise and fall.<br><span class="quote">${line}</span>` },
        { kind: 'timed', title: 'Tell a short story', duration: 30, ready: 3, listen: true, capture: 'story',
          text: 'Describe your favourite meal as if you were selling it. Vary your pitch, pace and volume.' },
      ];
    },
    finish: (r) => {
      const [flat, lively, story] = [r.flat, r.lively, r.story].map((f) => analyzeSpeaking(f || []));
      const best = Math.max(lively?.variability ?? 0, story?.variability ?? 0);
      if (!best) return { score: null, html: '<p>We didn\'t hear enough speech to measure your intonation.</p>' };
      const fmt = (v) => (v ? `${v.variability.toFixed(1)} semitones` : '—');
      return {
        score: Math.round(Math.min(100, (best / 3) * 100)),
        html: `<p>Pitch movement in your voice:</p>
               <ul class="result-list"><li>🤖 Robot: ${fmt(flat)}</li><li>🎉 With feeling: ${fmt(lively)}</li><li>🍝 Story: ${fmt(story)}</li></ul>
               <p class="muted">Lively, engaging speech usually moves around 2–4 semitones.</p>`,
      };
    },
  },
];

// ---- the voice assessment ----

export const ASSESSMENT = {
  id: 'assessment',
  name: 'Voice Assessment',
  emoji: '🎙️',
  category: 'Assessment',
  minutes: 4,
  blurb: 'Find your range, voice type, pitch accuracy and breath control.',
  steps: () => [
    { kind: 'manual', title: 'Let\'s find out about your voice', nextLabel: 'Start',
      text: `We'll listen as you speak, slide to the top and bottom of your voice, echo a few short melodies and hold a long note.
             <br><br>Find a quiet spot. <strong>Headphones help</strong> so the app's notes don't get picked up by the microphone.` },
    { kind: 'timed', title: 'Quiet please', duration: 3, capture: 'noise', say: 'Quiet please',
      text: 'Stay silent for a moment while we measure the background noise in your room.',
      onEnd: (ctx) => {
        const levels = (ctx.results.noise || []).map((f) => f.rms);
        if (levels.length) ctx.engine.noiseFloor = Math.min(0.03, percentile(levels, 90));
      } },
    { kind: 'timed', title: 'Speak naturally', duration: 12, ready: 3, listen: true, capture: 'speaking',
      text: `Read this aloud in your normal speaking voice:<br>
             <span class="quote">When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colours.</span>` },
    { kind: 'timed', title: 'Find your lowest note', duration: 10, ready: 3, listen: true, capture: 'low',
      text: 'Sing "ah" on a comfortable note, then slide down slowly to the lowest note you can hold without straining. Stay there.' },
    { kind: 'timed', title: 'Find your highest note', duration: 10, ready: 3, listen: true, capture: 'high',
      text: 'Sing "whee" and slide up slowly to the highest note you can hold. A light, airy sound is fine.' },
    {
      kind: 'game', id: 'melody', title: 'Echo the melody',
      text: 'Listen to each short melody, then sing it back on "la" as the bars reach the line.',
      game: (ctx) => {
        // Use the range just measured so the melodies suit this voice.
        const low = analyzeExtreme(ctx.results.low || [], 'low');
        const high = analyzeExtreme(ctx.results.high || [], 'high');
        if (low != null && high != null && high > low) ctx.profile.comfort = comfortRange(low, high);
        ctx.range = ctx.profile.comfort;
        return echoGame({ makeRounds: (c) => [3, 4, 5].map((n) => generateMelody(c.range, n)) })(ctx);
      },
    },
    { ...sustainStep(null),
      text: 'Take a full breath and sing "ah" on any comfortable note for as long as you can. The step ends when you stop.' },
  ],
  finish: (r, profile, engine) => {
    const speaking = analyzeSpeaking(r.speaking || []);
    const low = analyzeExtreme(r.low || [], 'low');
    const high = analyzeExtreme(r.high || [], 'high');
    const validRange = low != null && high != null && high - low >= 3;
    const report = buildReport({
      speaking,
      low: validRange ? low : null,
      high: validRange ? high : null,
      melody: r.melody?.data ?? null,
      sustain: r.sustain ? analyzeSustain(r.sustain) : null,
    });
    return {
      score: report.overall,
      report,
      profile: {
        range: report.range,
        comfort: report.comfort,
        voiceType: report.voiceType,
        speakingMidi: report.speakingMidi,
        noiseFloor: engine.noiseFloor,
        assessedAt: report.date,
      },
    };
  },
};

export const ALL = [ASSESSMENT, ...EXERCISES];

export function findExercise(id) {
  return ALL.find((e) => e.id === id);
}

export function needsMic(exercise, profile) {
  return exercise.steps(profile).some((s) => s.listen || s.capture || s.kind === 'game');
}
