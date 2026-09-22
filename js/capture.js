// Records one pad. Opens the camera and microphone, listens for a sound (or a tap on the
// pad), then keeps up to a second of audio samples and camera frames on one clock.
// Audio and frames are buffered continuously while listening, so the clip can start a
// moment before the sound was detected and the attack is not cut off.

import { ctx, loadWorklet, setAudioSession } from './audio.js';

const MAX_LEN = 1.0;         // longest clip (s)
const PRE_ROLL = 0.02;       // audio kept before a detected onset
const MANUAL_DELAY = 0.1;    // tap-to-record starts just after the finger's own thump
const MIN_LEN = 0.15;        // never stop on silence sooner than this after the sound
const SILENCE_HOLD = 0.12;   // this long below the quiet level ends the clip early
const TAIL = 0.05;           // kept after the last loud moment, then faded out
const SETTLE = 0.35;         // mic just opened: learn the room noise, don't trigger
const READY_FRAMES = 4;      // camera frames that must arrive before listening starts
const TOUCH_GUARD = 0.3;     // taps on the glass are loud to the mic; ignore them
const MIN_TRIGGER = 0.04;    // quietest peak (full scale = 1) that starts a recording
const VIDEO_LAG = 0.035;     // camera frames reach the page later than matching audio
const FPS = 30;
const MAX_FRAMES = 40;
const RING_SECONDS = 3;
const SLOT_COUNT = 48;       // ~1.6 s of frames at 30 fps
const SHEET_COLS = 6;
const BLOCK = 256;           // analysis window while recording (samples)

export class CaptureSession {
  constructor({ video, facing, aspect, frameSize }) {
    this.video = video;
    this.facing = facing;
    this.frame = frameDims(aspect, frameSize);
    this.state = 'starting'; // starting → listening → recording → done, or closed
    this.level = 0;
    this.threshold = MIN_TRIGGER;
    this.progress = 0;
    this.onstate = null;
    this.stream = null;
    this.nodes = null;
    this.sr = 0;
    this.guardFrom = -1;
    this.guardUntil = -1;
    this.done = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this.done.catch(() => {});
  }

  get active() {
    return this.state !== 'done' && this.state !== 'closed';
  }

  async start() {
    const media = navigator.mediaDevices;
    if (!media || !media.getUserMedia) {
      const err = new Error('Camera and microphone need a secure (HTTPS) page.');
      err.name = 'InsecureContextError';
      throw err;
    }
    setAudioSession('play-and-record');
    const stream = await openStream(this.facing);
    if (!this.active) {
      stopStream(stream);
      return;
    }
    this.stream = stream;
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => this._fail(new Error('The camera or microphone stopped.')));
    }
    this.video.srcObject = stream;
    const playing = this.video.play();
    if (playing && playing.catch) playing.catch(() => {});
    await waitForVideo(this.video, () => !this.active);
    if (!this.active) return;
    this._startFrames();
    await this._startAudio();
  }

  // Tap on the armed pad: record from (just after) now, whether or not there is a sound.
  recordNow() {
    if (this.state !== 'listening') return;
    this._begin(Math.round((ctx.currentTime + MANUAL_DELAY) * this.sr), true);
  }

  // A finger just touched the screen. That thump must not count as the pad's sound.
  noteTouch() {
    if (!this.sr) return;
    const now = Math.round(ctx.currentTime * this.sr);
    this.guardFrom = now - Math.round(0.15 * this.sr);
    this.guardUntil = now + Math.round(TOUCH_GUARD * this.sr);
    if (this.state === 'recording' && !this.manual && this.onset >= this.guardFrom) {
      this._setState('listening');
    }
  }

  cancel() {
    if (!this.active) return;
    this._close('closed');
    this._resolve(null);
  }

  _setState(state) {
    this.state = state;
    if (this.onstate) this.onstate(state);
  }

  _fail(err) {
    if (!this.active) return;
    this._close('closed');
    this._reject(err);
  }

  _close(state) {
    this.state = state;
    if (this.stopFrames) this.stopFrames();
    this._stopAudio();
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    if (this.onstate) this.onstate(state);
  }

  // ---- camera frames ----

  _startFrames() {
    const { w, h } = this.frame;
    this.slots = frameSlots(w, h);
    this.slotNext = 0;
    this.grabbed = 0;
    this.lastGrab = -Infinity;
    this.mirror = this.facing === 'user';
    const video = this.video;
    const perFrame = typeof video.requestVideoFrameCallback === 'function';
    let req = 0;
    const loop = () => {
      if (!this.active) return;
      this._grab();
      req = perFrame ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    this.stopFrames = () => {
      if (!perFrame) cancelAnimationFrame(req);
      else if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(req);
    };
    loop();
  }

  _grab() {
    const video = this.video;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const wall = performance.now();
    if (wall - this.lastGrab < 1000 / FPS - 8) return;
    this.lastGrab = wall;
    const { w, h } = this.frame;
    // Crop the camera image to the pad's shape, as the live preview shows it.
    let sw = vw;
    let sh = vh;
    if (vw * h > vh * w) sw = (vh * w) / h;
    else sh = (vw * h) / w;
    const slot = this.slots[this.slotNext];
    this.slotNext = (this.slotNext + 1) % this.slots.length;
    const g = slot.g;
    g.setTransform(this.mirror ? -1 : 1, 0, 0, 1, this.mirror ? w : 0, 0);
    g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
    slot.t = ctx.currentTime - VIDEO_LAG;
    this.grabbed++;
  }

  // ---- microphone ----

  async _startAudio() {
    const sr = ctx.sampleRate;
    this.sr = sr;
    this.cap = Math.ceil(RING_SECONDS * sr);
    this.ring = new Float32Array(this.cap);
    this.ringEnd = 0;
    this.floor = -1;

    const useWorklet = await loadWorklet();
    if (!this.active) return;
    const source = ctx.createMediaStreamSource(this.stream);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    let tap;
    if (useWorklet) {
      tap = new AudioWorkletNode(ctx, 'drum-board-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      tap.port.onmessage = (e) => this._onAudio(e.data.frame, e.data.samples);
    } else {
      tap = ctx.createScriptProcessor(1024, 1, 1);
      let next = -1;
      tap.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        if (next < 0) next = Math.round(ctx.currentTime * sr);
        this._onAudio(next, data);
        next += data.length;
      };
    }
    // The tap has to reach the destination to be processed; the sink keeps it silent.
    source.connect(tap);
    tap.connect(sink);
    sink.connect(ctx.destination);
    this.nodes = { source, tap, sink };
  }

  _stopAudio() {
    const nodes = this.nodes;
    if (!nodes) return;
    this.nodes = null;
    if (nodes.tap.port) nodes.tap.port.postMessage('stop');
    else nodes.tap.onaudioprocess = null;
    try {
      nodes.source.disconnect();
      nodes.tap.disconnect();
      nodes.sink.disconnect();
    } catch (err) {
      // Already disconnected.
    }
  }

  _onAudio(frame, data) {
    if (!this.active) return;
    const n = data.length;
    const cap = this.cap;
    const ring = this.ring;
    let w = frame % cap;
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = data[i];
      ring[w] = x;
      if (++w === cap) w = 0;
      sum += x * x;
      const a = x < 0 ? -x : x;
      if (a > peak) peak = a;
    }
    this.ringEnd = frame + n;
    this.level = Math.max(peak, this.level * 0.8);

    // Cameras often stall briefly after the first picture; only listen once both the
    // microphone and a steady stream of frames are arriving.
    if (this.state === 'starting') {
      if (this.grabbed < READY_FRAMES) return;
      this.settleUntil = frame + Math.round(SETTLE * this.sr);
      this._setState('listening');
    }
    if (this.state === 'listening') this._listen(frame, data, peak, Math.sqrt(sum / n));
    else if (this.state === 'recording') this._scan();
  }

  _listen(frame, data, peak, rms) {
    // Room noise level: follows drops quickly and rises slowly.
    if (this.floor < 0) this.floor = rms;
    else this.floor += (rms - this.floor) * (rms < this.floor ? 0.3 : 0.02);
    this.threshold = Math.min(0.5, Math.max(MIN_TRIGGER, this.floor * 10));
    if (frame < this.settleUntil || peak < this.threshold) return;
    let k = 0;
    while (Math.abs(data[k]) < this.threshold) k++;
    const onset = frame + k;
    if (onset >= this.guardFrom && onset <= this.guardUntil) return;
    this._begin(onset, false);
  }

  _begin(at, manual) {
    const sr = this.sr;
    this.manual = manual;
    this.heard = !manual;
    this.onset = manual ? -1 : at;
    this.lastLoud = manual ? -1 : at;
    this.peakRms = 0;
    const start = manual ? at : at - Math.round(PRE_ROLL * sr);
    this.clipStart = Math.max(this.ringEnd - this.cap + BLOCK, start);
    this.clipMax = this.clipStart + Math.round(MAX_LEN * sr);
    this.scanned = this.clipStart;
    this.progress = 0;
    this._setState('recording');
    this._scan();
  }

  // Walks the newly arrived audio: notes the sound, and ends the clip once it has
  // died away (or the clip is a second long).
  _scan() {
    const sr = this.sr;
    const cap = this.cap;
    const ring = this.ring;
    const thr = this.threshold;
    while (this.scanned + BLOCK <= this.ringEnd) {
      const a = this.scanned;
      const b = a + BLOCK;
      let sum = 0;
      let over = -1;
      for (let f = a; f < b; f++) {
        const x = ring[f % cap];
        sum += x * x;
        if (over < 0 && (x >= thr || -x >= thr)) over = f;
      }
      this.scanned = b;
      const rms = Math.sqrt(sum / BLOCK);
      if (!this.heard && over >= 0 && !(over >= this.guardFrom && over <= this.guardUntil)) {
        this.heard = true;
        this.onset = over;
        this.lastLoud = over;
      }
      if (this.heard) {
        if (rms > this.peakRms) this.peakRms = rms;
        if (rms >= Math.max(this.floor * 3, this.peakRms * 0.04, 0.002)) this.lastLoud = b;
        if (b - this.onset >= MIN_LEN * sr && b - this.lastLoud >= SILENCE_HOLD * sr) {
          this._finish(Math.min(this.clipMax, this.lastLoud + Math.round(TAIL * sr)));
          return;
        }
      }
      if (b >= this.clipMax) {
        this._finish(this.clipMax);
        return;
      }
    }
    const span = this.clipMax - this.clipStart;
    this.progress = Math.max(0, Math.min(1, (this.ringEnd - this.clipStart) / span));
  }

  _finish(end) {
    this.clipEnd = end;
    if (this.stopFrames) this.stopFrames();
    let result;
    try {
      result = this._assemble();
    } catch (err) {
      this._fail(err);
      return;
    }
    this._close('done');
    this._resolve(result);
  }

  _assemble() {
    const sr = this.sr;
    const cap = this.cap;
    const len = Math.max(1, this.clipEnd - this.clipStart);
    const pcm = new Float32Array(len);
    for (let i = 0; i < len; i++) pcm[i] = this.ring[(this.clipStart + i) % cap];

    // Frames: the last one taken at or before the clip start, then everything until the end.
    const t0 = this.clipStart / sr;
    const t1 = this.clipEnd / sr;
    const shots = this.slots.filter((s) => s.t !== null).sort((a, b) => a.t - b.t);
    if (!shots.length) throw new Error('The camera did not deliver any pictures.');
    let first = 0;
    for (let i = 0; i < shots.length; i++) if (shots[i].t <= t0) first = i;
    const picked = shots.slice(first).filter((s, i) => i === 0 || s.t < t1).slice(0, MAX_FRAMES);
    const times = picked.map((s) => Math.max(0, s.t - t0));
    times[0] = 0;

    // Pack them into one sprite sheet image.
    const { w, h } = this.frame;
    const cols = Math.min(SHEET_COLS, picked.length);
    const rows = Math.ceil(picked.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * w;
    sheet.height = rows * h;
    const g = sheet.getContext('2d');
    picked.forEach((s, i) => g.drawImage(s.canvas, (i % cols) * w, Math.floor(i / cols) * h));
    return { pcm, sampleRate: sr, sheet, cols, width: w, height: h, times };
  }
}

export function captureErrorMessage(err) {
  const name = err && err.name;
  if (name === 'InsecureContextError') return err.message;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'Camera or microphone access is blocked. Allow both for this site in Safari’s website settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No camera or microphone was found.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The camera or microphone is busy. Close other apps using it and try again.';
  }
  return (err && err.message) || 'Recording failed.';
}

export async function countCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length;
  } catch (err) {
    return 0;
  }
}

async function openStream(facing) {
  const media = navigator.mediaDevices;
  try {
    return await media.getUserMedia({
      // Raw microphone: voice processing would squash drum transients and duck playback.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
  } catch (err) {
    if (err && (err.name === 'OverconstrainedError' || err.name === 'TypeError')) {
      return media.getUserMedia({ audio: true, video: true });
    }
    throw err;
  }
}

function stopStream(stream) {
  if (stream) for (const track of stream.getTracks()) track.stop();
}

function waitForVideo(video, aborted, timeout = 8000) {
  const began = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (aborted() || (video.videoWidth > 0 && video.readyState >= 2)) resolve();
      else if (performance.now() - began > timeout) reject(new Error('The camera did not start.'));
      else setTimeout(check, 40);
    };
    check();
  });
}

function frameDims(aspect, size) {
  const a = Math.min(1.6, Math.max(0.625, aspect || 1));
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  return a >= 1 ? { w: size, h: even(size / a) } : { w: even(size * a), h: size };
}

// Frame canvases are reused between recordings rather than reallocated each time.
const slotPool = [];

function frameSlots(w, h) {
  while (slotPool.length < SLOT_COUNT) {
    slotPool.push({ canvas: document.createElement('canvas'), g: null, t: null });
  }
  for (const slot of slotPool) {
    if (slot.canvas.width !== w || slot.canvas.height !== h) {
      slot.canvas.width = w;
      slot.canvas.height = h;
    }
    if (!slot.g) slot.g = slot.canvas.getContext('2d');
    slot.t = null;
  }
  return slotPool;
}
