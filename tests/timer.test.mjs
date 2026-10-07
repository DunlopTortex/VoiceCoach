import test from 'node:test';
import assert from 'node:assert/strict';
import { Countdown, formatSeconds } from '../js/timer.js';

test('counts down, pauses and finishes', () => {
  let t = 100;
  const c = new Countdown(10, () => t);
  assert.equal(c.done, false);
  c.start();
  t += 4;
  assert.equal(c.remaining(), 6);
  c.pause();
  t += 30;
  assert.equal(c.remaining(), 6, 'paused time does not count');
  assert.ok(c.paused);
  c.resume();
  t += 5;
  assert.equal(c.remaining(), 1);
  assert.equal(c.done, false);
  t += 2;
  assert.equal(c.remaining(), 0);
  assert.equal(c.progress(), 1);
  assert.ok(c.done);
});

test('formats seconds for display', () => {
  assert.equal(formatSeconds(5.2), '6');
  assert.equal(formatSeconds(65), '1:05');
  assert.equal(formatSeconds(-1), '0');
});
