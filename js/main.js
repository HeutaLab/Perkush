// The board: 12 pads belonging to one of several named boards. Tap an empty pad to add a
// sound (record your own with the camera, or pick a cartoon instrument), tap a filled pad
// to play it, and use Edit to change or clear pads. The beat bar records what you play and
// loops it back, and can keep a drum beat going to play along to. The render loop keeps
// each recorded pad's picture on the audio clock.

import * as audio from './audio.js';
import { CaptureSession, captureErrorMessage, countCameras, EFFECTS, effectById } from './capture.js';
import { clipFromCapture, clipFromRecord, releaseClip } from './clip.js';
import { INSTRUMENTS, instrumentById, instrumentSvg, loadInstruments, tileHtml, animateInstrument } from './instruments.js';
import { COUNT, Sequencer } from './sequencer.js';
import { boardFilename, boardToBlob, cleanName, readBoardFile, saveFile } from './share.js';
import * as store from './store.js';

const PAD_COUNT = 12;
const FRAME_SIZE = 256;      // longest side of a stored video frame (px)
const DISPLAY_LEAD = 0.02;   // a frame drawn now reaches the screen about a refresh later
const BLOCK_DEPTH = 6;       // px; matches --d in board.css
const FACING_KEY = 'video-drum-board.facing';
const EFFECT_KEY = 'perkush.effect';
const SPEED_KEY = 'perkush.speed';
const RECORDED_KEY = 'perkush.recorded';   // set once a child has made a beat here
const NEW_NAMES = ['Kitchen', 'Animals', 'Playground', 'Garden', 'Space', 'Monsters', 'Band', 'Jungle'];

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const ICON_FLIP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4.5 10a7.5 7.5 0 0 1 13.4-3.6M19.5 14a7.5 7.5 0 0 1-13.4 3.6"/><path d="M18.5 3v4h-4M5.5 21v-4h4"/></svg>';
const ICON_SWAP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5"/></svg>';
const ICON_SPARK =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' +
  '<path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1L5 9.5l5.1-1.9z"/>' +
  '<path d="M18.5 15l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9zM5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
const ICON_PENCIL =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 20l4.5-1 9-9a2.5 2.5 0 0 0-3.5-3.5l-9 9z"/><path d="M13.5 7.5l3 3"/></svg>';
const ICON_SAVE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3.5v10M8 10l4 4 4-4"/><path d="M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const ICON_OPEN =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3.5 19V6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h6a1.5 1.5 0 0 1 1.5 1.5v1"/><path d="M3.5 19l2.8-7.5h15L18.5 19z"/></svg>';
const ICON_CAMERA =
  '<svg viewBox="0 0 48 48" aria-hidden="true">' +
  '<path d="M15 14l3-6h12l3 6" fill="#fff" stroke="#1e2a4a" stroke-width="3" stroke-linejoin="round"/>' +
  '<rect x="4" y="13" width="40" height="28" rx="7" fill="#fff" stroke="#1e2a4a" stroke-width="3"/>' +
  '<circle cx="24" cy="27" r="8.5" fill="#45bcff" stroke="#1e2a4a" stroke-width="3"/>' +
  '<circle cx="21.5" cy="24.5" r="2.5" fill="#fff"/><circle cx="37" cy="19.5" r="2.3" fill="#ff5a5a"/></svg>';

const stage = document.getElementById('stage');
const board = document.getElementById('board');
const editButton = document.getElementById('edit');
const boardsButton = document.getElementById('boards');
const boardNameEl = document.getElementById('board-name');
const bar = {
  root: document.getElementById('beatbar'),
  rec: document.getElementById('rec'),
  recText: document.querySelector('#rec .bb-text'),
  loop: document.getElementById('loopbtn'),
  loopText: document.querySelector('#loopbtn .bb-text'),
  wipe: document.getElementById('wipe'),
  wipeText: document.querySelector('#wipe .bb-text'),
  beat: document.getElementById('beat'),
  dots: document.getElementById('dots'),
  speed: document.getElementById('speed'),
  speedLong: document.querySelector('#speed .s-long'),
  speedShort: document.querySelector('#speed .s-short'),
  hint: document.getElementById('bb-hint'),
  coach: document.getElementById('coach'),
  fill: document.getElementById('bb-fill'),
};
const hint = document.getElementById('hint');
const toastEl = document.getElementById('toast');
const mascot = document.querySelector('.mascot');
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const pads = [];
let boards = [];             // every board on this device
let current = null;          // the one on screen
let boardReady = false;      // false while a board's pads are still coming out of storage
let boardIo = Promise.resolve();
let editing = false;
let capture = null;          // the recording in progress: { pad, session, ui, phase, ... }
let chooser = null;          // the "add a sound" picker, built on first use
let sheet = null;            // the boards panel, built on first use
let facing = readSetting(FACING_KEY) === 'environment' ? 'environment' : 'user';
let effect = effectById(readSetting(EFFECT_KEY)).id;
let cameraCount = 2;         // assume a camera switch is possible until we know better
let beatBuffers = null;      // instrument sounds used by the play-along beat
let beatLoading = false;
let recorded = readSetting(RECORDED_KEY) === 'yes';
let coached = false;        // the spoken-out-loud nudge, once per visit
let coachOff = false;       // the bubble has been seen or tapped past
let coachTimer = 0;
let wipeTimer = 0;
let raf = 0;
let toastTimer = 0;

const seq = new Sequencer({
  onHit: (index, when) => {
    const pad = pads[index];
    if (pad && pad.clip) playPad(pad, when);
  },
  onCount: countIn,
  onStep: playBeatStep,
  onChange: renderBar,
  onLoop: (loop) => {
    if (!current) return;
    current.loop = loop;
    saveBoardRecord(current);
    if (loop && !recorded) {
      recorded = true;
      writeSetting(RECORDED_KEY, 'yes');
      toast('That is your beat, playing over and over. Tap the pads to join in!', 8000);
    }
  },
});

// ---- pads ----

function createPad(index) {
  const n = index + 1;
  const el = document.createElement('div');
  el.className = 'pad';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.innerHTML =
    '<canvas class="face"></canvas>' +
    '<div class="flash"></div>' +
    '<div class="inst-face" aria-hidden="true"><span class="inst-art"></span><span class="inst-label"></span><span class="pow"></span></div>' +
    '<div class="empty-face" aria-hidden="true"><span class="add-dot"></span><span>Add a sound</span></div>' +
    `<span class="num" aria-hidden="true">${n}</span>` +
    '<div class="edit-face">' +
    `<button type="button" class="btn change" aria-label="Change pad ${n}">${ICON_SWAP}<span>Change</span></button>` +
    `<button type="button" class="btn clear" aria-label="Clear pad ${n}">${ICON_TRASH}<span class="clear-label">Clear</span></button>` +
    '</div>';
  const canvas = el.querySelector('canvas');
  const pad = {
    index,
    el,
    canvas,
    g: canvas.getContext('2d'),
    flash: el.querySelector('.flash'),
    instArt: el.querySelector('.inst-art'),
    instLabel: el.querySelector('.inst-label'),
    pow: el.querySelector('.pow'),
    clearButton: el.querySelector('.clear'),
    clearLabel: el.querySelector('.clear-label'),
    clip: null,
    voice: null,
    shown: -1,
    w: 0,
    h: 0,
    confirmTimer: 0,
    pressTimer: 0,
    io: Promise.resolve(), // this pad's storage writes, applied in order
  };
  el.addEventListener('pointerdown', (e) => onPadDown(pad, e));
  el.addEventListener('click', (e) => onPadClick(pad, e));
  el.addEventListener('keydown', (e) => onPadKey(pad, e));
  setState(pad, 'loading');
  return pad;
}

function setState(pad, state) {
  pad.el.dataset.state = state;
  const n = pad.index + 1;
  const what = pad.clip && pad.clip.kind === 'inst' ? pad.clip.inst.name : 'your sound';
  const label =
    state === 'filled' ? `Pad ${n}, ${what}, play` :
    state === 'empty' ? `Pad ${n}, empty, add a sound` :
    `Pad ${n}, recording`;
  pad.el.setAttribute('aria-label', label);
}

// Playing happens on pointerdown for the lowest latency; adding sounds and edit actions use
// click, which also counts as the gesture iOS needs to start audio and the camera.
function onPadDown(pad, e) {
  if (e.button > 0) return;
  if (capture) {
    if (capture.phase !== 'capturing') return;
    if (pad !== capture.pad) cancelCapture();
    else if (!e.target.closest('button') && capture.session) capture.session.recordNow();
    return;
  }
  if (e.target.closest('button')) return;
  if (pad.clip) {
    e.preventDefault();
    hit(pad);
  } else if (pad.el.dataset.state === 'empty') {
    press(pad);
  }
}

function onPadClick(pad, e) {
  const button = e.target.closest('button');
  if (capture) {
    if (pad !== capture.pad || !button) return;
    if (button.classList.contains('cancel')) cancelCapture();
    else if (button.classList.contains('flip')) flipCamera();
    else if (button.classList.contains('fx')) cycleEffect(capture);
    return;
  }
  if (button && button.classList.contains('change')) openChooser(pad);
  else if (button && button.classList.contains('clear')) onClear(pad);
  else if (!pad.clip && pad.el.dataset.state === 'empty') openChooser(pad);
}

function onPadKey(pad, e) {
  if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== pad.el) return;
  e.preventDefault();
  if (e.repeat) return;
  if (capture) {
    if (pad === capture.pad && capture.phase === 'capturing' && capture.session) capture.session.recordNow();
  } else if (pad.clip) {
    hit(pad);
  } else if (pad.el.dataset.state === 'empty') {
    openChooser(pad);
  }
}

// A child's own tap: play it, and remember it if the red button is on.
function hit(pad) {
  playPad(pad);
  seq.note(pad.index);
}

// Starts a pad. `when` is a time on the audio clock, so the loop can line hits up ahead of
// time; the pad's picture and bounce wait until that moment arrives.
function playPad(pad, when = 0) {
  const clip = pad.clip;
  if (!clip) return;
  const start = audio.play(pad.index, clip.buffer, when);
  const voice = { start, clip, fired: false };
  pad.voice = voice;
  if (clip.kind !== 'inst' && pad.shown !== 0) drawFrame(pad, 0);
  if (start <= audio.ctx.currentTime + 0.01) {
    voice.fired = true;
    showHit(pad, clip);
  }
  kick();
}

function showHit(pad, clip) {
  pad.el.classList.add('playing');
  press(pad);
  if (clip.kind === 'inst') {
    animateInstrument(pad.instArt, pad.pow, clip.inst, reducedMotion);
  } else if (pad.flash.animate) {
    pad.flash.animate([{ opacity: 0.35 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' });
  }
  hop();
}

// The block sinks for a moment, like a real button being pushed.
function press(pad) {
  pad.el.classList.add('pressed');
  clearTimeout(pad.pressTimer);
  pad.pressTimer = setTimeout(() => pad.el.classList.remove('pressed'), 90);
}

// The drum in the title bounces along with every hit.
function hop() {
  if (reducedMotion || !mascot || !mascot.animate) return;
  mascot.animate(
    [{ transform: 'none' }, { transform: 'translateY(-18%) rotate(-8deg)' }, { transform: 'none' }],
    { duration: 240, easing: 'ease-out' },
  );
}

// A freshly filled pad pops into place.
function celebrate(pad) {
  if (reducedMotion || !pad.el.animate) return;
  pad.el.animate(
    [{ transform: 'scale(0.9)' }, { transform: 'scale(1.06)' }, { transform: 'none' }],
    { duration: 380, easing: 'ease-out' },
  );
}

function installClip(pad, clip) {
  audio.stop(pad.index);
  pad.voice = null;
  pad.el.classList.remove('playing');
  const old = pad.clip;
  pad.clip = clip;
  if (old) releaseClip(old);
  pad.el.dataset.kind = clip.kind === 'inst' ? 'inst' : 'video';
  if (clip.kind === 'inst') {
    pad.instArt.innerHTML = instrumentSvg(clip.inst);
    pad.instLabel.textContent = clip.inst.name;
    pad.pow.textContent = clip.inst.word;
  } else {
    pad.instArt.innerHTML = '';
    pad.shown = -1;
    drawFrame(pad, 0);
  }
}

// Empties a pad on screen. Storage is left alone: switching boards uses this too.
function emptyPad(pad, state) {
  audio.stop(pad.index);
  pad.voice = null;
  pad.el.classList.remove('playing');
  releaseClip(pad.clip);
  pad.clip = null;
  pad.shown = -1;
  pad.g.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  pad.instArt.innerHTML = '';
  pad.instLabel.textContent = '';
  delete pad.el.dataset.kind;
  cancelConfirm(pad);
  setState(pad, state);
}

function silencePads() {
  for (const pad of pads) {
    audio.stop(pad.index);
    pad.voice = null;
    pad.el.classList.remove('playing');
    if (pad.clip && pad.clip.kind !== 'inst') drawFrame(pad, 0);
  }
}

// ---- built-in instruments ----

async function instrumentClip(inst) {
  const buffers = await loadInstruments();
  const buffer = buffers.get(inst.id);
  return { kind: 'inst', inst, buffer, duration: buffer.duration };
}

async function assignInstrument(pad, inst) {
  let clip;
  try {
    clip = await instrumentClip(inst);
  } catch (err) {
    toast(`The ${inst.name} could not be made (${errorText(err)}).`);
    return;
  }
  if (capture && capture.pad === pad) return;
  installClip(pad, clip);
  setState(pad, 'filled');
  updateChrome();
  celebrate(pad);
  maybeCoach();
  const board = current;
  persist(pad, async () => {
    await store.savePad(board.id, { pad: pad.index, v: 1, kind: 'inst', inst: inst.id, created: Date.now() });
    store.requestPersistence();
  }, `Pad ${pad.index + 1} could not be saved`, 'It will be gone after a reload.');
}

// ---- the "add a sound" picker ----

function buildChooser() {
  const root = document.createElement('div');
  root.className = 'chooser';
  root.hidden = true;
  root.innerHTML =
    '<div class="chooser-card" role="dialog" aria-modal="true" aria-labelledby="chooser-title">' +
    '<div class="chooser-head">' +
    '<h2 id="chooser-title">Pick a sound for pad <span class="chooser-num"></span></h2>' +
    `<button type="button" class="round chooser-close" aria-label="Close">${ICON_CLOSE}</button>` +
    '</div>' +
    `<button type="button" class="choice-record">${ICON_CAMERA}<span><b>Record your own</b><small>Use the camera and make a noise</small></span></button>` +
    '<p class="chooser-or">or tap an instrument to hear it</p>' +
    `<div class="inst-grid">${INSTRUMENTS.map(tileHtml).join('')}</div>` +
    '<button type="button" class="btn use-btn" disabled></button>' +
    '</div>';
  document.body.appendChild(root);

  const c = {
    root,
    pad: null,
    selected: null,
    num: root.querySelector('.chooser-num'),
    record: root.querySelector('.choice-record'),
    grid: root.querySelector('.inst-grid'),
    use: root.querySelector('.use-btn'),
  };

  root.addEventListener('click', (e) => {
    if (e.target === root || e.target.closest('.chooser-close')) closeChooser();
  });
  c.record.addEventListener('click', () => {
    const pad = c.pad;
    closeChooser();
    if (pad) startCapture(pad);
  });
  // Hear an instrument the moment it's touched; the click that follows selects it, and
  // tapping the selected one again puts it on the pad.
  c.grid.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.inst-tile');
    if (tile && e.button <= 0) preview(tile);
  });
  c.grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.inst-tile');
    if (!tile) return;
    const inst = instrumentById(tile.dataset.id);
    if (e.detail === 0) preview(tile); // keyboard: no pointerdown came first
    if (c.selected === inst) useSelected();
    else select(inst);
  });
  c.use.addEventListener('click', useSelected);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) closeChooser();
  });
  return c;
}

function openChooser(pad) {
  if (capture) return;
  if (!chooser) chooser = buildChooser();
  audio.unlock(); // this runs inside the tap, which is when iOS allows sound to start
  cancelConfirm(pad);
  chooser.pad = pad;
  chooser.num.textContent = String(pad.index + 1);
  select(null);
  chooser.root.hidden = false;
  chooser.record.focus({ preventScroll: true });
  loadInstruments().catch(() => {}); // warm up, so the first tap on an instrument plays at once
}

function closeChooser() {
  if (!chooser || chooser.root.hidden) return;
  audio.stop('preview');
  chooser.root.hidden = true;
  const pad = chooser.pad;
  chooser.pad = null;
  if (pad) pad.el.focus({ preventScroll: true });
}

function select(inst) {
  chooser.selected = inst;
  for (const tile of chooser.grid.children) {
    tile.setAttribute('aria-pressed', String(!!inst && tile.dataset.id === inst.id));
  }
  chooser.use.disabled = !inst;
  chooser.use.textContent = inst ? `Use the ${inst.name}!` : 'Tap an instrument to hear it';
}

function preview(tile) {
  const inst = instrumentById(tile.dataset.id);
  animateInstrument(tile.querySelector('.inst-art'), tile.querySelector('.pow'), inst, reducedMotion);
  loadInstruments().then((buffers) => audio.play('preview', buffers.get(inst.id)), () => {});
}

function useSelected() {
  if (!chooser || !chooser.selected || !chooser.pad) return;
  const pad = chooser.pad;
  const inst = chooser.selected;
  closeChooser();
  assignInstrument(pad, inst);
}

// ---- drawing ----

function drawFrame(pad, i) {
  const clip = pad.clip;
  const c = pad.canvas;
  if (!clip || clip.kind === 'inst' || !c.width || !c.height) return;
  const col = i % clip.cols;
  const row = Math.floor(i / clip.cols);
  // Cover-fit the frame into the pad, inset 1px so neighbouring frames never bleed in.
  let sw = clip.w - 2;
  let sh = clip.h - 2;
  if (sw * c.height > sh * c.width) sw = (sh * c.width) / c.height;
  else sh = (sw * c.height) / c.width;
  const sx = col * clip.w + (clip.w - sw) / 2;
  const sy = row * clip.h + (clip.h - sh) / 2;
  pad.g.drawImage(clip.image, sx, sy, sw, sh, 0, 0, c.width, c.height);
  pad.shown = i;
}

function frameAt(times, t) {
  let i = times.length - 1;
  while (i > 0 && times[i] > t) i--;
  return i;
}

function tick() {
  raf = 0;
  const now = audio.audioNow() + DISPLAY_LEAD;
  let again = false;
  for (const pad of pads) {
    const voice = pad.voice;
    if (!voice) continue;
    if (voice.clip !== pad.clip) {
      pad.voice = null;
      continue;
    }
    const t = now - voice.start;
    if (t >= voice.clip.duration) {
      pad.voice = null;
      pad.el.classList.remove('playing');
      drawFrame(pad, 0);
      continue;
    }
    again = true;
    if (t >= 0 && !voice.fired) {
      voice.fired = true;
      showHit(pad, voice.clip);
    }
    if (voice.clip.kind === 'inst') continue;
    const i = t <= 0 ? 0 : frameAt(voice.clip.times, t);
    if (i !== pad.shown) drawFrame(pad, i);
  }
  if (seq.recording || seq.playing) {
    bar.fill.style.transform = `scaleX(${seq.position.toFixed(4)})`;
    again = true;
  }
  if (capture && !capture.finished) {
    updateCaptureUI(capture);
    again = true;
  }
  if (again) raf = requestAnimationFrame(tick);
}

function kick() {
  if (!raf) raf = requestAnimationFrame(tick);
}

// ---- the beat bar ----

function renderBar() {
  const anyFilled = pads.some((p) => p.clip);
  bar.root.hidden = !anyFilled && !seq.hasLoop;
  bar.root.classList.toggle('taking', seq.recording);
  // Until a child has made a beat once, the button waves and the hint points at it.
  const teaching = !recorded && anyFilled && !seq.recording && !seq.counting && !seq.hasLoop && !capture;
  bar.rec.classList.toggle('nudge', teaching);
  bar.coach.hidden = !teaching || coachOff;
  // It has said its piece after half a minute, and the button keeps waving on its own.
  if (!bar.coach.hidden && !coachTimer) coachTimer = setTimeout(hideCoach, 30000);
  bar.rec.classList.toggle('on', seq.recording);
  bar.rec.classList.toggle('counting', seq.counting);
  bar.rec.setAttribute('aria-pressed', String(seq.recording || seq.counting));
  bar.rec.disabled = !!capture;
  if (!seq.counting) bar.recText.textContent = seq.recording ? 'Stop' : 'Make a beat';
  bar.rec.setAttribute('aria-label',
    seq.recording ? 'Stop recording your beat' :
    seq.counting ? 'Counting in — tap to start now' :
    'Make a beat: record what you play');
  bar.loop.hidden = !seq.hasLoop;
  bar.loop.disabled = seq.recording || seq.counting || !!capture;
  bar.loop.dataset.mode = seq.playing ? 'stop' : 'play';
  bar.loopText.textContent = seq.playing ? 'Stop' : 'Play';
  bar.wipe.hidden = !seq.hasLoop || seq.recording || seq.counting;
  bar.beat.classList.toggle('on', seq.beat);
  bar.beat.setAttribute('aria-pressed', String(seq.beat));
  bar.beat.disabled = !!capture;
  bar.dots.hidden = !seq.beat && !seq.counting;
  bar.speedLong.textContent = seq.speed.name;
  bar.speedShort.textContent = seq.speed.short;
  bar.speed.setAttribute('aria-label', `Beat speed: ${seq.speed.name}. Tap to change.`);
  bar.root.classList.toggle('beat-on', seq.beat);
  // A quiet status line; the bubble under the button does the teaching.
  bar.hint.textContent =
    seq.counting ? 'Get ready…' :
    seq.recording ? 'Tap your pads!' :
    seq.playing ? 'Your beat is looping' : '';
  if (!seq.recording && !seq.playing) bar.fill.style.transform = 'scaleX(0)';
  if (!seq.hasLoop) cancelWipeConfirm();
  kick();
}

function toggleRecording() {
  if (capture) return;
  audio.unlock();
  if (seq.counting) {       // impatient: start right now instead of waiting for the count
    seq.recordNow();
    return;
  }
  if (!seq.recording) {
    if (!beatBuffers) loadInstruments().then((b) => { beatBuffers = b; }, () => {});
    seq.startRecording();
    if (!recorded) toast('Count along — then tap your pads!', 3000);
    return;
  }
  if (!seq.stopRecording()) toast('No pads were tapped, so there is no beat yet. Have another go!');
}

// One beat of the count-in: a knock, a number on the button, and one dot going out.
function countIn(left, when) {
  if (beatBuffers) audio.play('count', beatBuffers.get('woodblock'), when, left === COUNT ? 0.75 : 0.5);
  setTimeout(() => {
    if (!seq.counting) return;
    bar.recText.textContent = String(left);
    for (let i = 0; i < bar.dots.children.length; i++) {
      bar.dots.children[i].classList.toggle('on', i < left);
    }
  }, Math.max(0, (when - audio.audioNow()) * 1000));
}

function toggleLoop() {
  audio.unlock();
  if (seq.playing) {
    seq.stopPlaying();
    silencePads();
  } else {
    seq.play();
  }
}

// Throwing a beat away takes two taps, like clearing a pad.
function onWipe() {
  if (!wipeTimer) {
    bar.wipe.classList.add('confirm');
    if (bar.wipeText) bar.wipeText.textContent = 'Sure?';
    bar.wipe.setAttribute('aria-label', 'Tap again to throw the beat away');
    wipeTimer = setTimeout(cancelWipeConfirm, 3000);
    return;
  }
  cancelWipeConfirm();
  seq.clear();
  silencePads();
}

function cancelWipeConfirm() {
  clearTimeout(wipeTimer);
  wipeTimer = 0;
  bar.wipe.classList.remove('confirm');
  if (bar.wipeText) bar.wipeText.textContent = 'Clear';
  bar.wipe.setAttribute('aria-label', 'Throw the beat away');
}

async function toggleBeat() {
  if (capture || beatLoading) return;
  audio.unlock();
  if (seq.beat) {
    seq.setBeat(false);
    return;
  }
  // The drum sounds are made the first time they are needed, which takes a moment.
  if (!beatBuffers) {
    beatLoading = true;
    bar.beat.classList.add('loading');
    try {
      beatBuffers = await loadInstruments();
    } catch (err) {
      toast(`The beat could not start (${errorText(err)}).`);
      return;
    } finally {
      beatLoading = false;
      bar.beat.classList.remove('loading');
    }
  }
  seq.setBeat(true);
}

// One eighth note of the play-along beat: boom on 1 and 3, tak on 2 and 4, tick between.
function playBeatStep(step, when) {
  if (!beatBuffers) return;
  audio.play('beat-tick', beatBuffers.get('hihat'), when, step % 2 === 0 ? 0.3 : 0.2);
  if (step === 0 || step === 4) audio.play('beat-boom', beatBuffers.get('kick'), when, 0.5);
  if (step === 2 || step === 6) audio.play('beat-tak', beatBuffers.get('snare'), when, 0.4);
  if (step % 2) return;
  // Light the matching dot when that beat reaches the speaker. While counting in, the
  // count owns the dots.
  const beat = step / 2;
  setTimeout(() => {
    if (!seq.beat || seq.counting) return;
    for (let i = 0; i < bar.dots.children.length; i++) {
      bar.dots.children[i].classList.toggle('on', i === beat);
    }
  }, Math.max(0, (when - audio.audioNow()) * 1000));
}

// ---- recording ----

async function startCapture(pad) {
  if (capture) return;
  audio.unlock();
  seq.stopEverything();  // the microphone must not hear the loop or the beat
  silencePads();
  audio.stopAll();
  cancelConfirm(pad);
  const job = { pad, session: null, ui: null, phase: 'capturing', restart: false, cancelled: false, finished: false };
  capture = job;
  job.ui = mountCaptureUI(pad);
  board.classList.add('capturing');
  pad.el.classList.add('active');
  updateChrome();
  kick();
  try {
    let result = null;
    do {
      job.restart = false;
      const aspect = pad.canvas.clientWidth / pad.canvas.clientHeight || pad.w / pad.h;
      const session = new CaptureSession({
        video: job.ui.video,
        preview: job.ui.preview,
        facing,
        aspect,
        frameSize: FRAME_SIZE,
        effect,
      });
      job.session = session;
      session.onstate = (state) => onSessionState(job, state);
      job.ui.video.classList.toggle('mirror', facing === 'user');
      setState(pad, 'starting');
      setCaptureMessage(job, 'Starting camera…');
      await session.start();
      if (session.active) refreshCameraCount(job);
      result = await session.done;
    } while (job.restart && !job.cancelled);
    if (job.cancelled || !result) return;

    job.phase = 'saving';
    setState(pad, 'saving');
    setCaptureMessage(job, 'Saving…');
    const { clip, encode } = await clipFromCapture(result);
    installClip(pad, clip);
    celebrate(pad);
    maybeCoach();
    const board = current;
    persist(pad, async () => {
      const record = await encode();
      record.pad = pad.index;
      await store.savePad(board.id, record);
      store.requestPersistence();
    }, `Recorded, but pad ${pad.index + 1} could not be saved`, 'It will be gone after a reload.');
  } catch (err) {
    if (job.session) job.session.cancel();
    if (!job.cancelled) toast(captureErrorMessage(err));
  } finally {
    finishCapture(job);
  }
}

function onSessionState(job, state) {
  if (job.finished) return;
  if (state === 'listening') {
    setState(job.pad, 'armed');
    setCaptureMessage(job, 'Make a sound!<small>or tap to record</small>');
  } else if (state === 'recording') {
    setState(job.pad, 'recording');
  }
}

function finishCapture(job) {
  if (job.finished) return;
  job.finished = true;
  job.ui.root.remove();
  job.pad.el.classList.remove('active');
  setState(job.pad, job.pad.clip ? 'filled' : 'empty');
  if (capture === job) {
    capture = null;
    board.classList.remove('capturing');
    audio.setAudioSession('playback');
  }
  updateChrome();
}

function cancelCapture() {
  const job = capture;
  if (!job || job.phase !== 'capturing') return;
  job.cancelled = true;
  if (job.session) job.session.cancel();
  finishCapture(job);
}

function flipCamera() {
  const job = capture;
  if (!job || job.phase !== 'capturing' || !job.session || job.session.state === 'recording') return;
  facing = facing === 'user' ? 'environment' : 'user';
  writeSetting(FACING_KEY, facing);
  job.restart = true;
  job.session.cancel();
}

// The sparkle button walks through the silly looks; whatever is on screen is what the
// pad keeps.
function cycleEffect(job) {
  if (!job || job.phase !== 'capturing') return;
  const i = EFFECTS.findIndex((e) => e.id === effect);
  const next = EFFECTS[(i + 1) % EFFECTS.length];
  effect = next.id;
  writeSetting(EFFECT_KEY, effect);
  if (job.session) job.session.setEffect(effect);
  job.ui.fx.setAttribute('aria-label', `Silly look: ${next.name}. Tap to change.`);
  job.ui.fxName.textContent = next.name;
  job.ui.fxName.classList.remove('show');
  void job.ui.fxName.offsetWidth; // restart the little pop
  job.ui.fxName.classList.add('show');
}

function refreshCameraCount(job) {
  countCameras().then((n) => {
    if (n > 0) cameraCount = n;
    if (!job.finished) job.ui.flip.hidden = cameraCount < 2;
  });
}

function mountCaptureUI(pad) {
  const root = document.createElement('div');
  root.className = 'capture';
  root.innerHTML =
    '<video autoplay muted playsinline></video>' +
    '<canvas class="preview"></canvas>' +
    '<div class="cap-top">' +
    `<button type="button" class="round cancel" aria-label="Cancel recording">${ICON_CLOSE}</button>` +
    '<div class="cap-tools">' +
    `<button type="button" class="round flip" aria-label="Switch camera">${ICON_FLIP}</button>` +
    `<button type="button" class="round fx" aria-label="Silly look: ${effectById(effect).name}. Tap to change.">${ICON_SPARK}</button>` +
    '</div>' +
    '</div>' +
    '<div class="fx-name" aria-hidden="true"></div>' +
    '<div class="cap-bottom">' +
    '<div class="rec-badge" aria-hidden="true">REC</div>' +
    '<div class="cap-msg" role="status"></div>' +
    '<div class="meter" aria-hidden="true"><div class="meter-fill"></div><div class="meter-mark"></div></div>' +
    '</div>' +
    '<div class="cap-progress" aria-hidden="true"><div></div></div>';
  const video = root.querySelector('video');
  video.muted = true;
  video.playsInline = true;
  const flip = root.querySelector('.flip');
  flip.hidden = cameraCount < 2;
  pad.el.appendChild(root);
  // The preview shows the frames being kept, effect and all, rather than the raw camera.
  const preview = root.querySelector('.preview');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  preview.width = Math.max(2, Math.round(preview.clientWidth * dpr));
  preview.height = Math.max(2, Math.round(preview.clientHeight * dpr));
  return {
    root,
    video,
    preview,
    flip,
    fx: root.querySelector('.fx'),
    fxName: root.querySelector('.fx-name'),
    msg: root.querySelector('.cap-msg'),
    fill: root.querySelector('.meter-fill'),
    mark: root.querySelector('.meter-mark'),
    bar: root.querySelector('.cap-progress > div'),
    level: 0,
    text: null,
  };
}

function setCaptureMessage(job, html) {
  if (job.ui.text === html) return;
  job.ui.text = html;
  job.ui.msg.innerHTML = html;
}

function updateCaptureUI(job) {
  const session = job.session;
  const ui = job.ui;
  if (!session) return;
  ui.level = Math.max(session.level, ui.level * 0.9);
  ui.fill.style.transform = `scaleX(${meterPos(ui.level).toFixed(3)})`;
  ui.mark.style.left = `${(meterPos(session.threshold) * 100).toFixed(1)}%`;
  ui.bar.style.transform = `scaleX(${session.progress.toFixed(3)})`;
  if (session.state === 'starting' && ui.video.videoWidth && audio.ctx.state !== 'running') {
    setCaptureMessage(job, 'Tap to start listening');
  }
}

// Level (full scale = 1) to meter position, over a 54 dB range.
function meterPos(x) {
  return Math.max(0, Math.min(1, (20 * Math.log10(x + 1e-9) + 54) / 54));
}

// ---- edit mode ----

function setEditing(on) {
  editing = on;
  board.classList.toggle('editing', on);
  editButton.textContent = on ? 'Done' : 'Edit';
  editButton.setAttribute('aria-pressed', String(on));
  pads.forEach(cancelConfirm);
  updateChrome();
}

function onClear(pad) {
  if (!pad.confirmTimer) {
    pad.clearLabel.textContent = 'Tap again';
    pad.clearButton.classList.add('confirm');
    pad.confirmTimer = setTimeout(() => cancelConfirm(pad), 3000);
    return;
  }
  cancelConfirm(pad);
  clearPad(pad);
}

function cancelConfirm(pad) {
  clearTimeout(pad.confirmTimer);
  pad.confirmTimer = 0;
  pad.clearLabel.textContent = 'Clear';
  pad.clearButton.classList.remove('confirm');
}

function clearPad(pad) {
  emptyPad(pad, 'empty');
  updateChrome();
  const board = current;
  persist(pad, () => store.deletePad(board.id, pad.index), `Pad ${pad.index + 1} could not be cleared from storage`, 'It may come back after a reload.');
}

// Storage work for a pad runs in order, so a quick clear or change can't be undone by an
// older save finishing late.
function persist(pad, op, failure, consequence) {
  pad.io = pad.io.then(op).catch((err) => toast(`${failure} (${errorText(err)}). ${consequence}`));
}

function hideCoach() {
  clearTimeout(coachTimer);
  coachTimer = 0;
  if (coachOff) return;
  coachOff = true;
  bar.coach.hidden = true;
}

// The first sound on a board is the moment to mention the red button.
function maybeCoach() {
  if (recorded || coached) return;
  coached = true;
  setTimeout(() => {
    if (!recorded && !seq.hasLoop && !seq.recording && !capture) {
      toast('Now tap “Make a beat”, play your pads, then tap it again — your beat plays back over and over.', 9000);
    }
  }, 1400);
}

function updateChrome() {
  const anyFilled = pads.some((p) => p.clip);
  if (editing && !anyFilled && !capture) {
    setEditing(false);
    return;
  }
  editButton.disabled = !!capture || !anyFilled;
  boardsButton.disabled = !!capture;
  const count = pads.filter((p) => p.clip).length;
  if (boardReady && current && current.count !== count && !capture) {
    current.count = count;
    saveBoardRecord(current);
  }
  hint.textContent = capture
    ? `Recording pad ${capture.pad.index + 1}: make a sound, or tap the pad.`
    : editing
      ? 'Change or clear pads. Tap Done when finished.'
      : 'Tap an empty pad to add a sound. Tap a filled pad to play it.';
  renderBar();
}

// ---- boards ----

function makeBoardId() {
  return `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function boardData(b) {
  return { id: b.id, name: b.name, created: b.created || Date.now(), loop: b.loop || null, count: b.count || 0 };
}

// Board writes run in order too, so a rename can't be overwritten by an earlier save.
function saveBoardRecord(b) {
  const data = boardData(b);
  boardIo = boardIo
    .then(() => store.saveBoard(data))
    .catch((err) => toast(`The board could not be saved (${errorText(err)}).`));
  return boardIo;
}

function nextBoardName() {
  const taken = new Set(boards.map((b) => b.name.toLowerCase()));
  const free = NEW_NAMES.find((n) => !taken.has(n.toLowerCase()));
  if (free) return free;
  let n = boards.length + 1;
  while (taken.has(`board ${n}`)) n++;
  return `Board ${n}`;
}

// Puts a board on screen: pads are emptied, then filled from storage.
async function openBoard(b) {
  seq.stopEverything();
  silencePads();
  cancelWipeConfirm();
  if (editing) setEditing(false);
  current = b;
  boardReady = false;
  boardNameEl.textContent = b.name;
  boardsButton.setAttribute('aria-label', `Board: ${b.name}. Tap to switch boards.`);
  for (const pad of pads) emptyPad(pad, 'loading');
  seq.setLoop(b.loop);
  updateChrome();
  store.setCurrentBoardId(b.id).catch(() => {});

  let records = [];
  try {
    records = await store.loadPads(b.id);
  } catch (err) {
    toast(`The saved pads could not be loaded (${errorText(err)}).`);
  }
  if (current !== b) return; // switched again while this was loading
  await Promise.all(records.map(async (record) => {
    const pad = pads[record.pad];
    if (!pad || pad.clip || (capture && capture.pad === pad)) return;
    try {
      const clip = await restore(record);
      if (current === b && !pad.clip) installClip(pad, clip);
      else releaseClip(clip);
    } catch (err) {
      console.warn(`Pad ${record.pad + 1} could not be restored`, err);
    }
  }));
  if (current !== b) return;
  for (const pad of pads) {
    if (pad.el.dataset.state === 'loading') setState(pad, pad.clip ? 'filled' : 'empty');
  }
  boardReady = true;
  updateChrome();
}

async function newBoard(name) {
  const b = { id: makeBoardId(), name: cleanName(name || nextBoardName()), created: Date.now(), loop: null, count: 0 };
  boards.push(b);
  await saveBoardRecord(b);
  return b;
}

async function removeBoard(b) {
  const others = boards.filter((x) => x.id !== b.id);
  if (!others.length) return;
  boards = others;
  try {
    await store.deleteBoard(b.id);
  } catch (err) {
    toast(`“${b.name}” could not be deleted (${errorText(err)}).`);
  }
  if (current && current.id === b.id) await openBoard(boards[0]);
  renderBoardList();
}

// ---- the boards panel ----

function buildSheet() {
  const root = document.createElement('div');
  root.className = 'chooser sheet';
  root.hidden = true;
  root.innerHTML =
    '<div class="chooser-card sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
    '<div class="chooser-head">' +
    '<h2 id="sheet-title">Your boards</h2>' +
    `<button type="button" class="round sheet-close" aria-label="Close">${ICON_CLOSE}</button>` +
    '</div>' +
    '<div class="board-list"></div>' +
    '<div class="sheet-actions">' +
    `<button type="button" class="btn add-board">${ICON_PLUS}<span>New board</span></button>` +
    `<button type="button" class="btn open-board">${ICON_OPEN}<span>Open a board file</span></button>` +
    '</div>' +
    '<p class="sheet-note">A board file keeps the pictures and sounds you recorded. It is saved on this device — nothing is sent anywhere — so only pass one on to someone you trust.</p>' +
    '<input type="file" class="board-file" accept=".json,application/json" hidden>' +
    '</div>';
  document.body.appendChild(root);

  const s = {
    root,
    list: root.querySelector('.board-list'),
    file: root.querySelector('.board-file'),
    renaming: null,
    confirmId: null,
    confirmTimer: 0,
  };

  root.addEventListener('click', (e) => {
    if (e.target === root || e.target.closest('.sheet-close')) closeSheet();
  });
  root.querySelector('.add-board').addEventListener('click', async () => {
    const b = await newBoard();
    closeSheet();
    await openBoard(b);
    toast(`“${b.name}” is empty and waiting. Tap a pad to fill it.`);
  });
  root.querySelector('.open-board').addEventListener('click', () => s.file.click());
  s.file.addEventListener('change', () => {
    const file = s.file.files && s.file.files[0];
    s.file.value = '';
    if (file) importBoardFile(file);
  });
  s.list.addEventListener('click', onSheetClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) closeSheet();
  });
  return s;
}

function openSheet() {
  if (capture) return;
  if (!sheet) sheet = buildSheet();
  audio.unlock();
  renderBoardList();
  sheet.root.hidden = false;
  const active = sheet.list.querySelector('.board-row.active .row-open');
  if (active) active.focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheet || sheet.root.hidden) return;
  stopRename(false);
  clearConfirm();
  sheet.root.hidden = true;
  boardsButton.focus({ preventScroll: true });
}

function renderBoardList() {
  if (!sheet) return;
  clearConfirm();
  const only = boards.length < 2;
  sheet.list.innerHTML = boards.map((b) => {
    const active = current && b.id === current.id;
    const sounds = b.count === 1 ? '1 sound' : `${b.count || 0} sounds`;
    const beat = b.loop ? ' · has a beat' : '';
    return (
      `<div class="board-row${active ? ' active' : ''}" data-id="${b.id}">` +
      `<button type="button" class="row-open"${active ? ' aria-current="true"' : ''}>` +
      `<span class="row-name">${escapeHtml(b.name)}</span>` +
      `<small class="row-sub">${sounds}${beat}${active ? ' · open' : ''}</small>` +
      '</button>' +
      `<button type="button" class="round tiny act rename" aria-label="Rename ${escapeHtml(b.name)}">${ICON_PENCIL}</button>` +
      `<button type="button" class="round tiny act save" aria-label="Save ${escapeHtml(b.name)} to a file">${ICON_SAVE}</button>` +
      `<button type="button" class="round tiny act remove" aria-label="Delete ${escapeHtml(b.name)}"${only ? ' disabled' : ''}>${ICON_TRASH}</button>` +
      '</div>'
    );
  }).join('');
}

function onSheetClick(e) {
  const row = e.target.closest('.board-row');
  if (!row) return;
  const b = boards.find((x) => x.id === row.dataset.id);
  if (!b) return;
  const button = e.target.closest('button');
  if (!button) return;
  if (!button.classList.contains('remove')) clearConfirm();
  if (button.classList.contains('row-open')) {
    closeSheet();
    if (!current || b.id !== current.id) openBoard(b);
  } else if (button.classList.contains('rename')) {
    startRename(row, b);
  } else if (button.classList.contains('save')) {
    exportBoard(b);
  } else if (button.classList.contains('remove')) {
    confirmRemove(button, b);
  }
}

// Deleting a board holds everything that was recorded on it, so it takes two taps.
function confirmRemove(button, b) {
  if (sheet.confirmId !== b.id) {
    clearConfirm();
    sheet.confirmId = b.id;
    button.classList.add('confirm');
    button.setAttribute('aria-label', `Tap again to delete ${b.name} and everything on it`);
    sheet.confirmTimer = setTimeout(clearConfirm, 3000);
    return;
  }
  clearConfirm();
  removeBoard(b);
}

function clearConfirm() {
  if (!sheet) return;
  clearTimeout(sheet.confirmTimer);
  sheet.confirmTimer = 0;
  sheet.confirmId = null;
  for (const button of sheet.list.querySelectorAll('.remove.confirm')) {
    const row = button.closest('.board-row');
    const b = boards.find((x) => x.id === (row && row.dataset.id));
    button.classList.remove('confirm');
    if (b) button.setAttribute('aria-label', `Delete ${b.name}`);
  }
}

function startRename(row, b) {
  stopRename(false);
  // The list may have been redrawn by the rename we just closed, so find the live row.
  const live = sheet.list.querySelector(`.board-row[data-id="${b.id}"]`) || row;
  const nameEl = live.querySelector('.row-name');
  if (!nameEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'row-input';
  input.value = b.name;
  input.maxLength = 40;
  input.setAttribute('aria-label', `Name for ${b.name}`);
  nameEl.replaceWith(input);
  sheet.renaming = { input, board: b };
  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') stopRename(true);
    else if (e.key === 'Escape') stopRename(false);
  });
  input.addEventListener('blur', () => stopRename(true));
}

function stopRename(save) {
  if (!sheet || !sheet.renaming) return;
  const { input, board: b } = sheet.renaming;
  sheet.renaming = null;
  const name = cleanName(input.value);
  if (save && name !== b.name) {
    b.name = name;
    saveBoardRecord(b);
    if (current && current.id === b.id) {
      boardNameEl.textContent = name;
      boardsButton.setAttribute('aria-label', `Board: ${name}. Tap to switch boards.`);
    }
  }
  renderBoardList();
}

// ---- board files ----

async function exportBoard(b) {
  try {
    if (current && b.id === current.id) await Promise.all(pads.map((p) => p.io)); // let saves land first
    const records = await store.loadPads(b.id);
    if (!records.length) {
      toast(`“${b.name}” has no sounds on it yet.`);
      return;
    }
    saveFile(boardToBlob(b, records), boardFilename(b.name));
    toast(`“${b.name}” was saved as a file. It has the recordings in it, so keep it safe.`, 8000);
  } catch (err) {
    toast(`“${b.name}” could not be saved to a file (${errorText(err)}).`);
  }
}

async function importBoardFile(file) {
  let data;
  try {
    data = await readBoardFile(file, PAD_COUNT);
  } catch (err) {
    toast(`That file could not be opened: ${errorText(err)}.`);
    return;
  }
  let b;
  try {
    b = await newBoard(uniqueName(data.name));
    b.loop = data.loop;
    b.count = data.pads.length;
    for (const record of data.pads) await store.savePad(b.id, record);
    await saveBoardRecord(b);
    store.requestPersistence();
  } catch (err) {
    toast(`That board could not be added (${errorText(err)}).`);
    return;
  }
  closeSheet();
  await openBoard(b);
  toast(`“${b.name}” is ready. Tap the pads!`);
}

function uniqueName(name) {
  const taken = new Set(boards.map((b) => b.name.toLowerCase()));
  let candidate = cleanName(name);
  let n = 2;
  while (taken.has(candidate.toLowerCase())) candidate = `${cleanName(name)} ${n++}`;
  return candidate;
}

// ---- layout ----

// 3 × 4 in portrait, 4 × 3 in landscape; pads fill the space without getting too narrow
// or too flat. Phone-sized pads get compact controls.
function layout() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const landscape = r.width > r.height * 1.05;
  const cols = landscape ? 4 : 3;
  const rows = landscape ? 3 : 4;
  const gap = Math.round(Math.max(10, Math.min(18, Math.min(r.width, r.height) * 0.022)));
  const depth = BLOCK_DEPTH; // each block's raised edge needs room below it
  let w = (r.width - gap * (cols - 1)) / cols;
  let h = (r.height - depth - (gap + depth) * (rows - 1)) / rows;
  w = Math.floor(Math.min(w, h * 1.5));
  h = Math.floor(Math.min(h, w * 1.5));
  board.classList.toggle('compact', w < 180 || h < 150);
  board.style.columnGap = `${gap}px`;
  board.style.rowGap = `${gap + depth}px`;
  board.style.gridTemplateColumns = `repeat(${cols}, ${w}px)`;
  board.style.gridAutoRows = `${h}px`;
  for (const pad of pads) {
    pad.w = w;
    pad.h = h;
  }
  // Each canvas matches the picture area inside its pad's coloured frame.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const pad of pads) {
    const cw = Math.round(pad.canvas.clientWidth * dpr);
    const ch = Math.round(pad.canvas.clientHeight * dpr);
    if (cw && ch && (pad.canvas.width !== cw || pad.canvas.height !== ch)) {
      pad.canvas.width = cw;
      pad.canvas.height = ch;
      pad.shown = -1;
      if (pad.clip) drawFrame(pad, 0);
    }
  }
}

// ---- misc ----

function toast(message, ms = 6000) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function errorText(err) {
  return (err && (err.message || err.name)) || String(err);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null; // private mode or storage blocked
  }
}

function writeSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Just don't remember it.
  }
}

async function restore(record) {
  if (record.kind === 'inst') {
    const inst = instrumentById(record.inst);
    if (!inst) throw new Error(`unknown instrument "${record.inst}"`);
    return instrumentClip(inst);
  }
  return clipFromRecord(record);
}

// The board that was open last time, or a brand new one.
async function firstBoard() {
  try {
    boards = (await store.loadBoards()) || [];
  } catch (err) {
    toast(`The saved boards could not be loaded (${errorText(err)}).`);
    boards = [];
  }
  boards.sort((a, b) => (a.created || 0) - (b.created || 0));
  if (!boards.length) return newBoard('My board');
  let id = null;
  try {
    id = await store.currentBoardId();
  } catch (err) {
    // Fall back to the first board.
  }
  return boards.find((b) => b.id === id) || boards[0];
}

async function boot() {
  for (let i = 0; i < PAD_COUNT; i++) {
    const pad = createPad(i);
    pads.push(pad);
    board.appendChild(pad.el);
  }
  layout();
  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
  else window.addEventListener('resize', layout);

  editButton.addEventListener('click', () => setEditing(!editing));
  boardsButton.addEventListener('click', openSheet);
  bar.root.addEventListener('pointerdown', hideCoach); // they have found the bar
  bar.rec.addEventListener('click', toggleRecording);
  bar.loop.addEventListener('click', toggleLoop);
  bar.wipe.addEventListener('click', onWipe);
  bar.beat.addEventListener('click', toggleBeat);
  bar.speed.addEventListener('click', () => {
    seq.nextSpeed();
    writeSetting(SPEED_KEY, seq.speed.id);
  });
  seq.setSpeed(readSetting(SPEED_KEY) || 'medium');

  // Any touch while recording is a thump the microphone hears; the session ignores it.
  document.addEventListener('pointerdown', () => {
    if (capture && capture.session) capture.session.noteTouch();
  }, true);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS show :active presses
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    // A hidden tab's timers are throttled, which would make the loop stutter.
    cancelCapture();
    seq.stopEverything();
    silencePads();
  });
  updateChrome();
  audio.loadWorklet();
  if (!window.isSecureContext) toast('Open this page over HTTPS to record with the camera and microphone.', 15000);

  await openBoard(await firstBoard());
  // Get the instrument sounds ready in the background.
  setTimeout(() => loadInstruments().then((b) => { beatBuffers = b; }, () => {}), 1200);
}

boot();
