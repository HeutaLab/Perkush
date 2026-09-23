// The beat bar. It remembers which pads were tapped and when, plays that back around and
// around, and keeps an optional drum beat going to play along to. Both are scheduled a
// fraction ahead on the audio clock, so the timing does not wobble with the frame rate.

import { ctx } from './audio.js';

const LOOKAHEAD = 0.2;   // schedule sounds this far ahead (s)
const TICK = 30;         // how often we look ahead (ms)
const LEAD_IN = 0.12;    // a breath before a loop starts
const MIN_LOOP = 0.5;
const MAX_LOOP = 30;
const TAIL = 0.15;       // the loop never ends right on top of its last hit
export const COUNT = 4;  // beats counted in before recording starts
export const STEPS = 8;  // eighth notes in one bar of the beat

export const SPEEDS = [
  { id: 'slow', name: 'Slow', short: 'Slow', bpm: 72 },
  { id: 'medium', name: 'Medium', short: 'Med', bpm: 96 },
  { id: 'fast', name: 'Fast', short: 'Fast', bpm: 126 },
];

export class Sequencer {
  // onHit(pad, when) plays a pad; onCount(left, when) is one beat of the count-in;
  // onStep(step, when) is one eighth note of the beat;
  // onChange() means the buttons need redrawing; onLoop(loop) means the recorded beat
  // itself changed and the board should keep the new one.
  constructor({ onHit, onCount, onStep, onChange, onLoop }) {
    this.onHit = onHit;
    this.onCount = onCount || (() => {});
    this.onStep = onStep;
    this.onChange = onChange || (() => {});
    this.onLoop = onLoop || (() => {});
    this.state = 'idle';   // idle | counting | recording | playing
    this.loop = null;      // { duration, hits: [{ pad, t }] }
    this.beat = false;
    this.speed = SPEEDS[1];
    this.hits = [];
    this.timer = 0;
    this.recStart = 0;
    this.countFrom = 0;
    this.countNext = 0;
    this.countQuarter = 0.625;
    this.cycleStart = 0;
    this.next = 0;
    this.step = 0;
    this.stepAt = 0;
  }

  get recording() { return this.state === 'recording'; }
  get counting() { return this.state === 'counting'; }
  get playing() { return this.state === 'playing'; }
  get hasLoop() { return !!(this.loop && this.loop.hits.length); }

  // How far through the loop (or the recording) we are, for the line along the bar.
  get position() {
    if (this.state === 'playing') return clamp((ctx.currentTime - this.cycleStart) / this.loop.duration);
    if (this.state === 'recording') return clamp((ctx.currentTime - this.recStart) / MAX_LOOP);
    if (this.state === 'counting') {
      return clamp((ctx.currentTime - this.countFrom) / (COUNT * this.countQuarter));
    }
    return 0;
  }

  // Counts four beats aloud, then records. If the play-along beat is running, the count
  // falls in with it, so the recording starts on a beat rather than between two.
  startRecording() {
    this.stopPlaying();
    this.hits = [];
    this.countQuarter = 60 / this.speed.bpm;
    this.countFrom = this.beat ? this._nextQuarter() : ctx.currentTime + 0.3;
    this.countNext = 0;
    this.recStart = this.countFrom + COUNT * this.countQuarter;
    this.state = 'counting';
    this._run();
    this.onChange();
  }

  // Waiting is for grown-ups: a tap during the count starts the recording there and then.
  recordNow() {
    if (this.state !== 'counting') return;
    this.recStart = ctx.currentTime;
    this.state = 'recording';
    this.onChange();
  }

  // Every pad a child taps while the red button is on goes into the loop.
  note(pad) {
    if (this.state === 'counting') this.recordNow();
    if (this.state !== 'recording') return;
    const t = Math.max(0, ctx.currentTime - this.recStart);
    if (t <= MAX_LOOP) this.hits.push({ pad, t });
  }

  // The next quarter note of the running beat, so the count-in lands on it.
  _nextQuarter() {
    const eighth = 30 / this.speed.bpm;
    let at = this.stepAt;
    let step = this.step;
    while (step % 2) {
      at += eighth;
      step++;
    }
    return at;
  }

  // Stops recording and starts playing what was just tapped.
  stopRecording() {
    if (this.state === 'counting') {  // stopped before it even began
      this.state = 'idle';
      this._idle();
      this.onChange();
      return null;
    }
    if (this.state !== 'recording') return null;
    const hits = this.hits;
    const last = hits.length ? hits[hits.length - 1].t : 0;
    const played = ctx.currentTime - this.recStart;
    this.state = 'idle';
    this.hits = [];
    if (!hits.length) {
      this.loop = null;
      this._idle();
      this.onLoop(null);
      this.onChange();
      return null;
    }
    const duration = Math.min(MAX_LOOP, Math.max(MIN_LOOP, played, last + TAIL));
    this.loop = { duration, hits: hits.filter((h) => h.t < duration) };
    this.onLoop(this.loop);
    this.play();
    return this.loop;
  }

  play() {
    if (this.state === 'recording' || this.state === 'counting' || !this.hasLoop) return;
    this.cycleStart = ctx.currentTime + LEAD_IN;
    this.next = 0;
    this.state = 'playing';
    this._run();
    this.onChange();
  }

  stopPlaying() {
    if (this.state !== 'playing') return;
    this.state = 'idle';
    this._idle();
    this.onChange();
  }

  clear() {
    this.stopPlaying();
    this.loop = null;
    this.onLoop(null);
    this.onChange();
  }

  // A loop read back from storage or a board file.
  setLoop(loop) {
    if (this.state !== 'idle') return;
    this.loop = normaliseLoop(loop);
    this.onChange();
  }

  setBeat(on) {
    if (this.beat === on) return;
    this.beat = on;
    if (on) {
      this.step = 0;
      this.stepAt = ctx.currentTime + LEAD_IN;
      this._run();
    } else {
      this._idle();
    }
    this.onChange();
  }

  setSpeed(id) {
    const speed = SPEEDS.find((s) => s.id === id);
    if (!speed || speed === this.speed) return;
    this.speed = speed;
    this.onChange();
  }

  nextSpeed() {
    const i = SPEEDS.indexOf(this.speed);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length].id);
    return this.speed;
  }

  // Everything stops: a recording in progress is thrown away, the loop is kept.
  stopEverything() {
    this.hits = [];
    this.state = 'idle';
    this.beat = false;
    this._idle();
    this.onChange();
  }

  _run() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), TICK);
    this._tick();
  }

  _idle() {
    if (this.timer && this.state === 'idle' && !this.beat) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  _tick() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    if (this.state === 'counting') {
      while (this.countNext < COUNT) {
        const when = this.countFrom + this.countNext * this.countQuarter;
        if (when >= horizon) break;
        this.countNext++;
        this.onCount(COUNT - this.countNext + 1, Math.max(when, ctx.currentTime));
      }
      if (ctx.currentTime >= this.recStart) {
        this.state = 'recording';
        this.onChange();
      }
    }
    // Nobody wants a half-hour beat: a long recording stops itself.
    if (this.state === 'recording' && ctx.currentTime - this.recStart >= MAX_LOOP) {
      this.stopRecording();
    }
    if (this.state === 'playing' && this.hasLoop) {
      const { hits, duration } = this.loop;
      for (let guard = 0; guard < 500; guard++) {
        if (this.next < hits.length) {
          const hit = hits[this.next];
          const when = this.cycleStart + hit.t;
          if (when >= horizon) break;
          this.next++;
          this.onHit(hit.pad, Math.max(when, ctx.currentTime));
          continue;
        }
        const end = this.cycleStart + duration;
        if (end >= horizon) break;
        this.cycleStart = end;
        this.next = 0;
      }
    }
    if (this.beat) {
      const eighth = 30 / this.speed.bpm;
      for (let guard = 0; guard < 200 && this.stepAt < horizon; guard++) {
        this.onStep(this.step % STEPS, Math.max(this.stepAt, ctx.currentTime));
        this.step++;
        this.stepAt += eighth;
      }
    }
  }
}

// Keeps a stored or shared loop sane: real numbers, in order, inside the loop.
export function normaliseLoop(loop) {
  if (!loop || !Array.isArray(loop.hits)) return null;
  const duration = Math.min(MAX_LOOP, Math.max(MIN_LOOP, Number(loop.duration) || 0));
  const hits = loop.hits
    .map((h) => ({ pad: Math.trunc(Number(h && h.pad)), t: Number(h && h.t) }))
    .filter((h) => Number.isFinite(h.t) && h.t >= 0 && h.t < duration && Number.isInteger(h.pad) && h.pad >= 0 && h.pad < 64)
    .sort((a, b) => a.t - b.t)
    .slice(0, 2000);
  return hits.length ? { duration, hits } : null;
}

function clamp(x) {
  return Math.max(0, Math.min(1, x || 0));
}
