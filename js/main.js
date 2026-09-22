// The board: 12 pads, tap to play / record, edit mode for re-record and clear, and the
// render loop that keeps each pad's picture on the audio clock.

import * as audio from './audio.js';
import { CaptureSession, captureErrorMessage, countCameras } from './capture.js';
import { clipFromCapture, clipFromRecord, releaseClip } from './clip.js';
import * as store from './store.js';

const PAD_COUNT = 12;
const FRAME_SIZE = 256;      // longest side of a stored video frame (px)
const DISPLAY_LEAD = 0.02;   // a frame drawn now reaches the screen about a refresh later
const FACING_KEY = 'video-drum-board.facing';
const BLOCK_DEPTH = 6;       // px; matches --d in style.css

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const ICON_FLIP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4.5 10a7.5 7.5 0 0 1 13.4-3.6M19.5 14a7.5 7.5 0 0 1-13.4 3.6"/><path d="M18.5 3v4h-4M5.5 21v-4h4"/></svg>';
const ICON_REDO =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.5H15"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5"/></svg>';

const stage = document.getElementById('stage');
const board = document.getElementById('board');
const editButton = document.getElementById('edit');
const hint = document.getElementById('hint');
const toastEl = document.getElementById('toast');
const mascot = document.querySelector('.mascot');
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const pads = [];
let editing = false;
let capture = null;          // the recording in progress: { pad, session, ui, phase, ... }
let facing = loadFacing();
let cameraCount = 2;         // assume a camera switch is possible until we know better
let raf = 0;
let toastTimer = 0;

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
    '<div class="empty-face" aria-hidden="true"><span class="rec-dot"></span><span>Tap to record</span></div>' +
    `<span class="num" aria-hidden="true">${n}</span>` +
    '<div class="edit-face">' +
    `<button type="button" class="btn rerecord" aria-label="Re-record pad ${n}">${ICON_REDO}<span>Re-record</span></button>` +
    `<button type="button" class="btn clear" aria-label="Clear pad ${n}">${ICON_TRASH}<span class="clear-label">Clear</span></button>` +
    '</div>';
  const canvas = el.querySelector('canvas');
  const pad = {
    index,
    el,
    canvas,
    g: canvas.getContext('2d'),
    flash: el.querySelector('.flash'),
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
  const label =
    state === 'filled' ? `Pad ${n}, play` :
    state === 'empty' ? `Pad ${n}, empty, record` :
    `Pad ${n}, recording`;
  pad.el.setAttribute('aria-label', label);
}

// Playing happens on pointerdown for the lowest latency; recording and edit actions use
// click, which also counts as the gesture iOS needs to start audio.
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
    return;
  }
  if (button && button.classList.contains('rerecord')) startCapture(pad);
  else if (button && button.classList.contains('clear')) onClear(pad);
  else if (!pad.clip && pad.el.dataset.state === 'empty') startCapture(pad);
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
    startCapture(pad);
  }
}

function hit(pad) {
  const clip = pad.clip;
  pad.voice = { start: audio.play(pad.index, clip.buffer), clip };
  if (pad.shown !== 0) drawFrame(pad, 0);
  pad.el.classList.add('playing');
  press(pad);
  if (pad.flash.animate) pad.flash.animate([{ opacity: 0.35 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' });
  hop();
  kick();
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

// A freshly recorded pad pops into place.
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
  pad.shown = -1;
  drawFrame(pad, 0);
}

// ---- drawing ----

function drawFrame(pad, i) {
  const clip = pad.clip;
  const c = pad.canvas;
  if (!clip || !c.width || !c.height) return;
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
    const i = t <= 0 ? 0 : frameAt(voice.clip.times, t);
    if (i !== pad.shown) drawFrame(pad, i);
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

// ---- recording ----

async function startCapture(pad) {
  if (capture) return;
  audio.unlock();
  audio.stopAll(); // pads still ringing would trigger the recording
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
      const session = new CaptureSession({ video: job.ui.video, facing, aspect, frameSize: FRAME_SIZE });
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
    persist(pad, async () => {
      const record = await encode();
      record.pad = pad.index;
      await store.savePad(record);
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
  saveFacing(facing);
  job.restart = true;
  job.session.cancel();
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
    '<div class="cap-top">' +
    `<button type="button" class="round cancel" aria-label="Cancel recording">${ICON_CLOSE}</button>` +
    `<button type="button" class="round flip" aria-label="Switch camera">${ICON_FLIP}</button>` +
    '</div>' +
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
  return {
    root,
    video,
    flip,
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
  audio.stop(pad.index);
  pad.voice = null;
  pad.el.classList.remove('playing');
  releaseClip(pad.clip);
  pad.clip = null;
  pad.shown = -1;
  pad.g.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  setState(pad, 'empty');
  updateChrome();
  persist(pad, () => store.deletePad(pad.index), `Pad ${pad.index + 1} could not be cleared from storage`, 'It may come back after a reload.');
}

// Storage work for a pad runs in order, so a quick clear or re-record can't be undone
// by an older save finishing late.
function persist(pad, op, failure, consequence) {
  pad.io = pad.io.then(op).catch((err) => toast(`${failure} (${errorText(err)}). ${consequence}`));
}

function updateChrome() {
  const anyFilled = pads.some((p) => p.clip);
  if (editing && !anyFilled && !capture) {
    setEditing(false);
    return;
  }
  editButton.disabled = !!capture || !anyFilled;
  hint.textContent = capture
    ? `Recording pad ${capture.pad.index + 1}: make a sound, or tap the pad.`
    : editing
      ? 'Re-record or clear pads. Tap Done when finished.'
      : 'Tap an empty pad to record. Tap a filled pad to play.';
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

function loadFacing() {
  try {
    return localStorage.getItem(FACING_KEY) === 'environment' ? 'environment' : 'user';
  } catch (err) {
    return 'user';
  }
}

function saveFacing(value) {
  try {
    localStorage.setItem(FACING_KEY, value);
  } catch (err) {
    // Private mode or storage blocked: just don't remember it.
  }
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
  // Any touch while recording is a thump the microphone hears; the session ignores it.
  document.addEventListener('pointerdown', () => {
    if (capture && capture.session) capture.session.noteTouch();
  }, true);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS show :active presses
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelCapture();
  });
  updateChrome();
  audio.loadWorklet();
  if (!window.isSecureContext) toast('Open this page over HTTPS to record with the camera and microphone.', 15000);

  let records = [];
  try {
    records = await store.loadPads();
  } catch (err) {
    toast(`Saved pads could not be loaded (${errorText(err)}).`);
  }
  await Promise.all(records.map(async (record) => {
    const pad = pads[record.pad];
    if (!pad || pad.clip || (capture && capture.pad === pad)) return;
    try {
      installClip(pad, await clipFromRecord(record));
    } catch (err) {
      console.warn(`Pad ${record.pad + 1} could not be restored`, err);
    }
  }));
  for (const pad of pads) {
    if (pad.el.dataset.state === 'loading') setState(pad, pad.clip ? 'filled' : 'empty');
  }
  updateChrome();
}

boot();
