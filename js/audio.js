// One AudioContext for the whole board: plays pads with minimal latency and hosts the
// microphone tap while a pad is recording.

const AudioCtor = window.AudioContext || window.webkitAudioContext;

function createContext() {
  try {
    return new AudioCtor({ latencyHint: 'interactive' });
  } catch (err) {
    return new AudioCtor();
  }
}

export const ctx = createContext();

// Each pad is levelled when it is recorded; the limiter only catches many pads hit at once.
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -3;
limiter.knee.value = 3;
limiter.ratio.value = 20;
limiter.attack.value = 0.002;
limiter.release.value = 0.15;
limiter.connect(ctx.destination);

const master = ctx.createGain();
master.connect(limiter);

const voices = new Map();

// iOS only starts audio from a real gesture (touchend / click), so every gesture nudges
// the context awake if it is still suspended or was interrupted.
export function unlock() {
  if (ctx.state === 'running') return;
  const resumed = ctx.resume();
  if (resumed && resumed.catch) resumed.catch(() => {});
  try {
    // Older iOS versions also want a sound started inside the gesture.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch (err) {
    // Nothing to do; resume() is what matters on current browsers.
  }
}

for (const type of ['touchend', 'pointerup', 'mouseup', 'click', 'keydown']) {
  document.addEventListener(type, unlock, { capture: true, passive: true });
}

// Safari 16.4+: 'playback' keeps the pads audible when the iPad is in silent mode.
// Recording needs 'play-and-record' for as long as the microphone is open.
export function setAudioSession(type) {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) {
      navigator.audioSession.type = type;
    }
  } catch (err) {
    // Unsupported on this browser.
  }
}

setAudioSession('playback');

// The context time reaching the speaker right now. Pad pictures follow this clock, so
// they wait for the sound instead of running ahead of it.
export function audioNow() {
  const t = ctx.currentTime;
  if (ctx.state === 'running' && typeof ctx.getOutputTimestamp === 'function') {
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      const est = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      if (est <= t + 0.02 && est > t - 0.3) return est;
    }
  }
  return t - (ctx.outputLatency || ctx.baseLatency || 0);
}

// Starts a pad from the top, cutting off (with a short fade) whatever it was playing.
// Returns the context time the sound starts at.
export function play(key, buffer) {
  const now = ctx.currentTime;
  stop(key, now);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  src.connect(gain);
  gain.connect(master);
  src.start(now);
  const voice = { src, gain };
  voices.set(key, voice);
  src.onended = () => {
    gain.disconnect();
    if (voices.get(key) === voice) voices.delete(key);
  };
  return now;
}

export function stop(key, when = ctx.currentTime) {
  const voice = voices.get(key);
  if (!voice) return;
  voices.delete(key);
  try {
    voice.gain.gain.cancelScheduledValues(when);
    voice.gain.gain.setTargetAtTime(0, when, 0.004);
    voice.src.stop(when + 0.03);
  } catch (err) {
    // Already stopped.
  }
}

export function stopAll() {
  for (const key of Array.from(voices.keys())) stop(key);
}

export function makeBuffer(samples, sampleRate) {
  const buffer = ctx.createBuffer(1, Math.max(1, samples.length), sampleRate);
  if (buffer.copyToChannel) buffer.copyToChannel(samples, 0);
  else buffer.getChannelData(0).set(samples);
  return buffer;
}

const WORKLET_URL = new URL('./capture-worklet.js', import.meta.url).href;
let workletLoad = null;

// Resolves true when the capture worklet is available, false to use the fallback.
export function loadWorklet() {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return Promise.resolve(false);
  if (!workletLoad) {
    workletLoad = ctx.audioWorklet.addModule(WORKLET_URL).then(
      () => true,
      (err) => {
        console.warn('Capture worklet unavailable, using ScriptProcessor', err);
        workletLoad = null;
        return false;
      },
    );
  }
  return workletLoad;
}
