# Voice Coach

A voice-training app that listens to you sing, measures your voice, then coaches you through
exercises and games to improve it. It runs in the browser on a phone, tablet or computer, can be
installed to the home screen, and works offline. Everything stays on the device.

## What it does

**1. Voice assessment (about 4 minutes).** The app listens while you:

| Step | What you do | What it measures |
|---|---|---|
| Quiet please | Stay silent for 3 s | Background noise, so the microphone gate suits your room |
| Speak naturally | Read a short passage | Speaking pitch and how much your intonation moves |
| Lowest / highest note | Slide down, then up, and hold | Your range, which gives a voice type estimate (bass … soprano) |
| Echo the melody | The app plays 3 short melodies in *your* range; sing each back | Pitch accuracy, note by note, in cents |
| Hold a long "ah" | Hold a note as long as you can | Breath length and steadiness (the step ends when you stop) |

The report scores pitch, range, breath, steadiness and speaking expression, shows your range against
the standard voice types, and recommends exercises for your weakest areas. Exercises are then pitched
in your comfortable range.

**2. Exercises and games.**

| Exercise | Type | Focus |
|---|---|---|
| 🌟 Daily Workout | Routine | Breathing, warm-up, pitch match, scales, a long tone, cool-down (10 min) |
| 🌬️ Breath Foundation | Timed | Paced belly breathing with an animated guide, steady hiss, long tone |
| 🔥 Vocal Warm-Up | Timed | Neck/jaw release, lip trills, humming, sirens |
| 🎯 Pitch Match | Game | Hear a note, find it, hold it in the band. A tuner needle shows flat or sharp |
| 🎵 Melody Echo | Game | Sing back melodies that get longer each round, with per-note feedback |
| 🪜 Scale Ladder | Game | do-re-mi-fa-so-fa-mi-re-do, a half step higher each round |
| 📏 Long Tones | Timed | Hold low, middle and high notes steady |
| ↕️ Range Stretch | Timed | Sirens to the top and bottom. Records new personal bests |
| 🗣️ Expressive Speaking | Mixed | Compare "robot" and lively reading; measures pitch movement |

**3. Guided sessions.** Every exercise is a sequence of steps:

- **Timed steps** (⏱) show a countdown ring and **continue automatically** when it reaches zero. They
  can play a reference note first, count you in ("3, 2, 1, go"), tick for the last 3 seconds and chime at
  the end. You can pause them. "Hold as long as you can" steps finish early once you stop.
- **Your-pace steps** (👉) wait until you press **Next**.
- **Games** (🎮) run their rounds and then show your score with a **Next** button.

Back and Skip work on any step. A live piano-roll shows your pitch as a line, the target note as a
band, and melodies as bars scrolling toward a "now" line. The screen stays awake during a session, and
optional spoken guidance reads each step aloud.

**4. Progress.** Session history, day streak, and a chart of your assessment scores over time.
Re-assess every week or two to see your range and accuracy grow.

## Running it

The app is plain HTML, CSS and JavaScript modules, with no build step and no dependencies.
Browsers only allow the microphone on `https://` or `localhost`, so serve the folder:

```bash
cd voice-coach
npm start                 # same as: python3 -m http.server 8080
# open http://localhost:8080
```

To use it on a phone, host the folder on any static HTTPS host (GitHub Pages, Netlify, …), open it,
and choose **Add to Home Screen**. **Headphones are recommended** so the app's reference notes don't
reach the microphone. The app also mutes the microphone while it plays them.

## How it works

| File | Role |
|---|---|
| `js/pitch.js` | YIN pitch detector (with parabolic interpolation) and note/cents helpers |
| `js/audio.js` | Microphone capture at about 30 frames/s with echo cancellation and AGC turned off; reference-tone synth and cue beeps |
| `js/analysis.js` | Range, speaking, sustain and per-note melody scoring; voice-type classification; the report and recommendations |
| `js/runner.js` | The guided session engine: timed, manual and game steps; count-ins, pause, auto-advance |
| `js/games.js` | Pitch Match and the listen-then-sing echo game used by Melody Echo, Scale Ladder and the assessment |
| `js/exercises.js` | The exercise catalogue and the assessment, built from the user's range |
| `js/pitch-view.js` | The scrolling pitch canvas |
| `js/app.js`, `js/storage.js` | Screens, routing, and localStorage persistence |

Scoring: a note counts as on pitch within ±50 cents (half a semitone). The first 30% of each note is
ignored so a late or scooped entry isn't penalised. Singing the right note in another octave counts.

## Tests

```bash
npm test                  # unit tests: pitch detection, scoring, timers, exercise catalogue
npm start & node tests/e2e.mjs   # browser test (needs Playwright)
```

The browser test replaces the microphone with a **virtual singer**, an oscillator the test controls.
It drives the whole app through the real audio pipeline. It checks that timed steps advance on their
own and that pause works. It checks that manual steps wait for Next, and that Pitch Match and Melody
Echo score a perfect singer at 100%. It also runs a full assessment, checking the range, voice type and
sustain in the report.
