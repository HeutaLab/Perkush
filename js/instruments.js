// Built-in cartoon percussion. Every sound is synthesised with Web Audio (no audio files to
// download or license) and every instrument is an inline SVG in the app's outlined cartoon
// style, with a face where one fits.

import { ctx, makeBuffer } from './audio.js';

const INK = '#1e2a4a';
const PEAK = 0.6;        // same loudness target as recorded pads
const GAP = 0.05;        // silence between instruments in the shared render (s)

// ---- drawing helpers ----

function face(x, y, s = 1, mouth = 'smile') {
  const eye = (dx) => `<ellipse cx="${x + dx * s}" cy="${y}" rx="${3.4 * s}" ry="${4.4 * s}" fill="${INK}"/>`;
  const blush = (dx) => `<circle cx="${x + dx * s}" cy="${y + 8 * s}" r="${4 * s}" fill="#ffb3c4"/>`;
  const m = mouth === 'o'
    ? `<ellipse cx="${x}" cy="${y + 11 * s}" rx="${4 * s}" ry="${5 * s}" fill="${INK}"/>`
    : `<path d="M${x - 7 * s} ${y + 8 * s}Q${x} ${y + 15 * s} ${x + 7 * s} ${y + 8 * s}" fill="none" stroke="${INK}" stroke-width="${3.6 * s}" stroke-linecap="round"/>`;
  return eye(-10) + eye(10) + blush(-17) + blush(17) + m;
}

// A wooden stick or beater: dark outline with a light core.
function stick(d, core = '#ffe0a8', width = 9) {
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="${core}" stroke-width="${width - 5}" stroke-linecap="round"/>`;
}

function sparkle(x, y, r) {
  const k = r * 0.3;
  return `<path d="M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z" fill="#ffd23f" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
}

const lugs = [[60, 20.5], [101.5, 62], [60, 103.5], [18.5, 62]]
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5" fill="#ffd23f" stroke="${INK}" stroke-width="3"/>`).join('');

function hand() {
  return `<g transform="rotate(22 40 70)">` +
    `<ellipse cx="52" cy="60" rx="7" ry="12" transform="rotate(-28 52 60)" fill="#fff" stroke="${INK}" stroke-width="5"/>` +
    `<rect x="22" y="32" width="32" height="52" rx="16" fill="#fff" stroke="${INK}" stroke-width="5"/>` +
    `<path d="M31 42v11M38.5 40v13M46 42v11" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<rect x="23" y="80" width="30" height="16" rx="6" fill="#ff75b8" stroke="${INK}" stroke-width="5"/>` +
    `</g>`;
}

function maraca(angle, head, handle) {
  return `<g transform="rotate(${angle} 60 66)">` +
    `<rect x="54" y="62" width="12" height="48" rx="6" fill="${handle}" stroke="${INK}" stroke-width="5"/>` +
    `<ellipse cx="60" cy="42" rx="21" ry="25" fill="${head}" stroke="${INK}" stroke-width="5"/>` +
    `<path d="M41 30q9.5 7 19 0t19 0" fill="none" stroke="#fff6c2" stroke-width="4" stroke-linecap="round"/>` +
    face(60, 45, 0.62) +
    `</g>`;
}

function tambourineJingles() {
  return [0, 60, 120, 180, 240, 300].map((a) => {
    const r = (a * Math.PI) / 180;
    const x = (60 + 38 * Math.cos(r)).toFixed(1);
    const y = (60 + 38 * Math.sin(r)).toFixed(1);
    return `<ellipse cx="${x}" cy="${y}" rx="8" ry="5" transform="rotate(${a + 90} ${x} ${y})" fill="#ffd23f" stroke="${INK}" stroke-width="3"/>`;
  }).join('');
}

function xylophoneBars() {
  return ['#ff5a5a', '#ff9a3d', '#ffd23f', '#84dc5a', '#45bcff'].map((c, i) => {
    const h = 70 - i * 9;
    const x = 12 + i * 20;
    const y = 60 - h / 2 + 4;
    return `<rect x="${x}" y="${y}" width="16" height="${h}" rx="5" fill="${c}" stroke="${INK}" stroke-width="4"/>` +
      `<circle cx="${x + 8}" cy="${y + 7}" r="2.2" fill="${INK}"/><circle cx="${x + 8}" cy="${y + h - 7}" r="2.2" fill="${INK}"/>`;
  }).join('');
}

function springCoils() {
  return [92, 81, 70, 59].map((y) =>
    `<ellipse cx="60" cy="${y}" rx="22" ry="6" fill="none" stroke="${INK}" stroke-width="8"/>` +
    `<ellipse cx="60" cy="${y}" rx="22" ry="6" fill="none" stroke="#d6e2f5" stroke-width="3"/>`).join('');
}

const ART = {
  kick:
    `<circle cx="60" cy="62" r="47" fill="#ff5a5a" stroke="${INK}" stroke-width="5"/>` +
    `<circle cx="60" cy="62" r="35" fill="#fff3d6" stroke="${INK}" stroke-width="4"/>` +
    lugs + face(60, 56, 1.05),

  snare:
    stick('M26 12L54 42') + stick('M94 12L66 42') +
    `<circle cx="25" cy="11" r="6" fill="#fff3d6" stroke="${INK}" stroke-width="3.5"/>` +
    `<circle cx="95" cy="11" r="6" fill="#fff3d6" stroke="${INK}" stroke-width="3.5"/>` +
    `<path d="M16 50V88A44 13 0 0 0 104 88V50" fill="#45bcff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="M17 83A44 13 0 0 0 103 83" fill="none" stroke="#ffd23f" stroke-width="5"/>` +
    `<ellipse cx="60" cy="50" rx="44" ry="13" fill="#fff3d6" stroke="${INK}" stroke-width="5"/>` +
    face(60, 65, 0.95),

  hihat:
    `<path d="M60 56V110M42 112L60 98L78 112" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M60 22V34" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
    `<ellipse cx="60" cy="64" rx="46" ry="11" fill="#e2a800" stroke="${INK}" stroke-width="5"/>` +
    `<ellipse cx="60" cy="47" rx="48" ry="15" fill="#ffd23f" stroke="${INK}" stroke-width="5"/>` +
    face(60, 44, 0.7),

  crash:
    `<path d="M60 64V110M40 112L60 96L80 112" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<g transform="rotate(-10 60 50)">` +
    `<ellipse cx="60" cy="50" rx="52" ry="20" fill="#ffd23f" stroke="${INK}" stroke-width="5"/>` +
    `<ellipse cx="60" cy="50" rx="36" ry="13" fill="none" stroke="#e2a800" stroke-width="3"/>` +
    face(60, 45, 0.8, 'o') +
    `</g>` +
    `<path d="M16 20l6 8M104 14l-5 9M60 6v9" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,

  clap:
    hand() + `<g transform="translate(120 0) scale(-1 1)">${hand()}</g>` +
    `<path d="M60 8v11M47 13l5 8M73 13l-5 8" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,

  cowbell:
    stick('M92 50L112 22', '#ffe0a8', 8) +
    `<path d="M48 36V24H72V36" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="M36 36H84L98 92Q60 104 22 92Z" fill="#ffd23f" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="M22 92Q60 104 98 92Q60 83 22 92Z" fill="#c99400" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M44 45L40 78" stroke="#fff6c2" stroke-width="5" stroke-linecap="round"/>` +
    face(62, 58, 0.95),

  tambourine:
    `<circle cx="60" cy="60" r="45" fill="#ff75b8" stroke="${INK}" stroke-width="5"/>` +
    `<circle cx="60" cy="60" r="31" fill="#fff3d6" stroke="${INK}" stroke-width="4"/>` +
    tambourineJingles() + face(60, 55, 0.95),

  maracas: maraca(-26, '#ff9a3d', '#b48cff') + maraca(26, '#84dc5a', '#45bcff'),

  triangle:
    `<path d="M59 24V12" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="59" cy="9" r="4" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M55 31L22 94H98L63 31" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M55 31L22 94H98L63 31" fill="none" stroke="#d6e2f5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    stick('M86 46L110 18', '#d6e2f5', 8) +
    sparkle(20, 34, 9) + sparkle(102, 70, 7) + sparkle(36, 110, 6),

  woodblock:
    stick('M84 44L104 16', '#ffe0a8', 8) +
    `<circle cx="106" cy="13" r="8" fill="#ff5a5a" stroke="${INK}" stroke-width="3.5"/>` +
    `<rect x="14" y="46" width="92" height="50" rx="16" fill="#e39a55" stroke="${INK}" stroke-width="5"/>` +
    `<rect x="28" y="56" width="64" height="9" rx="4.5" fill="#8a4f1e" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M22 86q8-4 16 0M84 88q8-4 14 0" fill="none" stroke="#b86f30" stroke-width="3" stroke-linecap="round"/>` +
    face(60, 74, 0.85),

  bongos:
    `<rect x="52" y="64" width="18" height="12" rx="4" fill="#8a4f1e" stroke="${INK}" stroke-width="4"/>` +
    `<path d="M14 44L22 98Q40 106 58 98L66 44" fill="#ff9a3d" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<ellipse cx="40" cy="44" rx="26" ry="8" fill="#fff3d6" stroke="${INK}" stroke-width="5"/>` +
    `<path d="M62 56L68 98Q84 104 100 98L106 56" fill="#45bcff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<ellipse cx="84" cy="56" rx="22" ry="7" fill="#fff3d6" stroke="${INK}" stroke-width="5"/>` +
    face(40, 66, 0.72) + face(84, 72, 0.62),

  xylophone:
    `<path d="M8 33L112 57M8 95L112 71" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
    xylophoneBars() + stick('M68 106L104 72', '#ffe0a8', 7) +
    `<circle cx="106" cy="70" r="7" fill="#b48cff" stroke="${INK}" stroke-width="3.5"/>`,

  gong:
    `<rect x="12" y="24" width="10" height="88" rx="5" fill="#ff5a5a" stroke="${INK}" stroke-width="4.5"/>` +
    `<rect x="98" y="24" width="10" height="88" rx="5" fill="#ff5a5a" stroke="${INK}" stroke-width="4.5"/>` +
    `<rect x="8" y="16" width="104" height="11" rx="5.5" fill="#ff5a5a" stroke="${INK}" stroke-width="4.5"/>` +
    `<path d="M46 27L50 36M74 27L70 36" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="60" cy="68" r="34" fill="#ffd23f" stroke="${INK}" stroke-width="5"/>` +
    `<circle cx="60" cy="68" r="25" fill="none" stroke="#e2a800" stroke-width="3"/>` +
    face(60, 63, 0.95, 'o'),

  boing:
    `<rect x="30" y="98" width="60" height="14" rx="7" fill="#45bcff" stroke="${INK}" stroke-width="4.5"/>` +
    springCoils() +
    `<circle cx="60" cy="33" r="23" fill="#84dc5a" stroke="${INK}" stroke-width="5"/>` +
    face(60, 29, 0.85) +
    `<path d="M20 28q-7 7 0 14M100 28q7 7 0 14" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,

  pop:
    `<circle cx="58" cy="62" r="38" fill="#bfeaff" stroke="${INK}" stroke-width="5"/>` +
    `<path d="M33 50a28 28 0 0 1 20-19" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>` +
    `<circle cx="100" cy="26" r="9" fill="#bfeaff" stroke="${INK}" stroke-width="4"/>` +
    `<circle cx="18" cy="24" r="6" fill="#bfeaff" stroke="${INK}" stroke-width="3.5"/>` +
    `<circle cx="104" cy="96" r="5" fill="#bfeaff" stroke="${INK}" stroke-width="3"/>` +
    face(58, 60, 1.05),
};

// ---- sound helpers (all times relative to t, the instrument's slot in the render) ----

let noiseData = null;

function noise(ac, t, seconds) {
  if (!noiseData || noiseData.sampleRate !== ac.sampleRate) {
    const len = Math.ceil(2 * ac.sampleRate);
    const buffer = ac.createBuffer(1, len, ac.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseData = buffer;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseData;
  src.start(t, Math.random() * Math.max(0, noiseData.duration - seconds), seconds);
  return src;
}

function osc(ac, type, freq, t, seconds) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(t + seconds);
  return o;
}

function filter(ac, type, freq, q = 1) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(ac, value = 0) {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

// Quick rise to `peak`, then an exponential fall to silence over `decay` seconds.
function hitEnv(param, t, peak, decay, attack = 0.002) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

// Six detuned square waves: the classic metallic cymbal recipe.
function metal(ac, out, t, fund, decay, cutoff, level) {
  const band = filter(ac, 'bandpass', 10000, 0.8);
  const high = filter(ac, 'highpass', cutoff);
  const g = gain(ac);
  hitEnv(g.gain, t, level, decay, 0.001);
  for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) chain(osc(ac, 'square', fund * r, t, decay + 0.05), band);
  chain(band, high, g, out);
}

function tone(ac, out, t, type, freq, level, decay, attack = 0.001) {
  const g = gain(ac);
  hitEnv(g.gain, t, level, decay, attack);
  chain(osc(ac, type, freq, t, decay + attack + 0.05), g, out);
}

function burst(ac, out, t, seconds, level, decay, filters) {
  const g = gain(ac);
  hitEnv(g.gain, t, level, decay, 0.0005);
  chain(noise(ac, t, seconds), ...filters, g, out);
}

const SOUNDS = {
  kick(ac, out, t) {
    const o = osc(ac, 'sine', 160, t, 0.7);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.18);
    const g = gain(ac);
    hitEnv(g.gain, t, 1, 0.55, 0.003);
    chain(o, g, out);
    burst(ac, out, t, 0.03, 0.35, 0.02, [filter(ac, 'highpass', 1200)]);
  },
  snare(ac, out, t) {
    burst(ac, out, t, 0.3, 0.9, 0.18, [filter(ac, 'highpass', 1400)]);
    tone(ac, out, t, 'triangle', 185, 0.8, 0.09);
    tone(ac, out, t, 'triangle', 330, 0.45, 0.06);
  },
  hihat(ac, out, t) {
    metal(ac, out, t, 40, 0.06, 7000, 1);
  },
  crash(ac, out, t) {
    metal(ac, out, t, 58, 1.1, 5000, 0.55);
    const g = gain(ac);
    hitEnv(g.gain, t, 0.5, 1.2, 0.004);
    chain(noise(ac, t, 1.3), filter(ac, 'highpass', 4500), g, out);
  },
  clap(ac, out, t) {
    const g = gain(ac);
    for (const dt of [0, 0.011, 0.023]) {
      g.gain.setValueAtTime(1, t + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.009);
    }
    g.gain.setValueAtTime(0.85, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    chain(noise(ac, t, 0.35), filter(ac, 'bandpass', 1150, 1.1), g, out);
  },
  cowbell(ac, out, t) {
    const band = filter(ac, 'bandpass', 950, 1.6);
    const g = gain(ac);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    for (const f of [587, 845]) chain(osc(ac, 'square', f, t, 0.5), band);
    chain(band, g, out);
  },
  tambourine(ac, out, t) {
    const g = gain(ac);
    for (const [dt, level] of [[0, 1], [0.045, 0.6], [0.095, 0.4]]) {
      g.gain.setValueAtTime(level, t + dt);
      g.gain.exponentialRampToValueAtTime(level * 0.15, t + dt + 0.04);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    chain(noise(ac, t, 0.45), filter(ac, 'highpass', 6000), g, out);
    metal(ac, out, t, 330, 0.25, 7000, 0.35);
  },
  maracas(ac, out, t) {
    const g = gain(ac);
    for (const [dt, level] of [[0, 0.9], [0.14, 0.7]]) {
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(level, t + dt + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.11);
    }
    chain(noise(ac, t, 0.3), filter(ac, 'bandpass', 6500, 1.4), filter(ac, 'highpass', 3000), g, out);
  },
  triangle(ac, out, t) {
    tone(ac, out, t, 'sine', 1480, 0.6, 1.6, 0.002);
    tone(ac, out, t, 'sine', 3950, 0.3, 0.9, 0.002);
    tone(ac, out, t, 'sine', 6440, 0.18, 0.5, 0.002);
  },
  woodblock(ac, out, t) {
    tone(ac, out, t, 'sine', 880, 0.9, 0.07);
    tone(ac, out, t, 'sine', 1970, 0.3, 0.04);
    burst(ac, out, t, 0.02, 0.4, 0.008, [filter(ac, 'bandpass', 2500, 2)]);
  },
  bongos(ac, out, t) {
    const o = osc(ac, 'sine', 430, t, 0.35);
    o.frequency.exponentialRampToValueAtTime(360, t + 0.05);
    const g = gain(ac);
    hitEnv(g.gain, t, 1, 0.24, 0.001);
    chain(o, g, out);
    burst(ac, out, t, 0.03, 0.3, 0.015, [filter(ac, 'bandpass', 3000, 1.5)]);
  },
  xylophone(ac, out, t) {
    tone(ac, out, t, 'sine', 784, 0.9, 0.7);
    tone(ac, out, t, 'sine', 784 * 3.93, 0.3, 0.12);
    tone(ac, out, t, 'sine', 784 * 9.2, 0.12, 0.05);
  },
  gong(ac, out, t) {
    for (const [f, level] of [[98, 0.7], [147.5, 0.5], [219, 0.35], [309, 0.25], [431, 0.15]]) {
      const o = osc(ac, 'sine', f, t, 2.3);
      o.frequency.linearRampToValueAtTime(f * 1.012, t + 1.2);
      const g = gain(ac);
      hitEnv(g.gain, t, level, 2.1, 0.012);
      chain(o, g, out);
    }
    burst(ac, out, t, 0.1, 0.25, 0.06, [filter(ac, 'lowpass', 900)]);
  },
  boing(ac, out, t) {
    const o = osc(ac, 'sawtooth', 110, t, 1);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.8);
    const low = filter(ac, 'lowpass', 900, 14);
    const lfo = osc(ac, 'sine', 12, t, 1);
    const depth = gain(ac);
    depth.gain.setValueAtTime(700, t);
    depth.gain.exponentialRampToValueAtTime(80, t + 0.9);
    chain(lfo, depth);
    depth.connect(low.frequency);
    const g = gain(ac);
    hitEnv(g.gain, t, 0.9, 0.85, 0.004);
    chain(o, low, g, out);
  },
  pop(ac, out, t) {
    const o = osc(ac, 'sine', 380, t, 0.12);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.045);
    const g = gain(ac);
    hitEnv(g.gain, t, 1, 0.07, 0.001);
    chain(o, g, out);
  },
};

// ---- the instruments ----

// motion: how the drawing moves when played. seconds: length of the sound. level: relative loudness.
export const INSTRUMENTS = [
  { id: 'kick', name: 'Big Drum', word: 'BOOM!', motion: 'thump', seconds: 0.7, level: 1 },
  { id: 'snare', name: 'Snare', word: 'TAK!', motion: 'thump', seconds: 0.35, level: 0.95 },
  { id: 'hihat', name: 'Hi-Hat', word: 'TSS!', motion: 'ring', seconds: 0.15, level: 0.6 },
  { id: 'crash', name: 'Cymbal', word: 'CRASH!', motion: 'ring', seconds: 1.4, level: 0.7 },
  { id: 'clap', name: 'Clap', word: 'CLAP!', motion: 'pop', seconds: 0.4, level: 0.95 },
  { id: 'cowbell', name: 'Cowbell', word: 'CLONK!', motion: 'ring', seconds: 0.5, level: 0.75 },
  { id: 'tambourine', name: 'Tambourine', word: 'JINGLE!', motion: 'shake', seconds: 0.5, level: 0.7 },
  { id: 'maracas', name: 'Maracas', word: 'SHAKA!', motion: 'shake', seconds: 0.35, level: 0.65 },
  { id: 'triangle', name: 'Triangle', word: 'DING!', motion: 'ring', seconds: 1.7, level: 0.6 },
  { id: 'woodblock', name: 'Woodblock', word: 'TOK!', motion: 'thump', seconds: 0.15, level: 0.85 },
  { id: 'bongos', name: 'Bongos', word: 'BOP!', motion: 'thump', seconds: 0.35, level: 0.95 },
  { id: 'xylophone', name: 'Xylophone', word: 'PLINK!', motion: 'pop', seconds: 0.8, level: 0.75 },
  { id: 'gong', name: 'Gong', word: 'BONG!', motion: 'ring', seconds: 2.3, level: 0.9 },
  { id: 'boing', name: 'Boing', word: 'BOING!', motion: 'bounce', seconds: 1, level: 0.8 },
  { id: 'pop', name: 'Pop', word: 'POP!', motion: 'pop', seconds: 0.15, level: 0.8 },
];

const byId = new Map(INSTRUMENTS.map((inst) => [inst.id, inst]));

export function instrumentById(id) {
  return byId.get(id) || null;
}

export function instrumentSvg(inst) {
  return `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${ART[inst.id]}</svg>`;
}

// A tappable instrument tile (used by the pad picker and the front page).
export function tileHtml(inst) {
  return `<button type="button" class="inst-tile" data-id="${inst.id}" aria-pressed="false">` +
    `<span class="inst-art">${instrumentSvg(inst)}</span>` +
    `<span class="inst-label">${inst.name}</span>` +
    `<span class="pow" aria-hidden="true">${inst.word}</span>` +
    `</button>`;
}

// ---- rendering ----

let loading = null;

// Renders every instrument once, in a single offline pass, and resolves to a Map of
// instrument id → AudioBuffer. Later calls reuse the same result.
export function loadInstruments() {
  if (!loading) {
    loading = renderAll().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

async function renderAll() {
  const sr = ctx.sampleRate;
  const slots = [];
  let at = GAP;
  for (const inst of INSTRUMENTS) {
    slots.push({ inst, start: at });
    at += inst.seconds + GAP;
  }
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ac = new Offline(1, Math.ceil(at * sr), sr);
  const out = ac.createGain();
  out.connect(ac.destination);
  for (const { inst, start } of slots) SOUNDS[inst.id](ac, out, start);
  const rendered = await startRendering(ac);
  const data = rendered.getChannelData(0);

  const buffers = new Map();
  for (const { inst, start } of slots) {
    const from = Math.round(start * sr);
    const samples = shape(data.slice(from, from + Math.round(inst.seconds * sr)), sr, PEAK * inst.level);
    buffers.set(inst.id, makeBuffer(samples, sr));
  }
  return buffers;
}

function startRendering(ac) {
  return new Promise((resolve, reject) => {
    ac.oncomplete = (e) => resolve(e.renderedBuffer);
    const result = ac.startRendering();
    if (result && result.then) result.then(resolve, reject);
  });
}

// Levels the sound, trims the silent end (so a pad stops glowing when the sound stops) and
// fades out the last few milliseconds so it never clicks.
function shape(samples, sr, target) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const k = peak > 1e-5 ? target / peak : 1;
  let end = samples.length;
  while (end > 1 && Math.abs(samples[end - 1]) * k < 0.002) end--;
  const out = samples.subarray(0, Math.min(samples.length, end + Math.round(sr * 0.01)));
  const fade = Math.min(out.length, Math.round(sr * 0.008));
  for (let i = 0; i < out.length; i++) {
    const tail = out.length - i;
    out[i] *= tail < fade ? k * (tail / fade) : k;
  }
  return out;
}

// ---- animation ----

const MOTIONS = {
  thump: { duration: 280, frames: [{ transform: 'scale(1.12, 0.84)' }, { transform: 'scale(0.95, 1.07)' }, { transform: 'none' }] },
  ring: { duration: 520, frames: [{ transform: 'rotate(-9deg) scale(1.06)' }, { transform: 'rotate(7deg)' }, { transform: 'rotate(-4deg)' }, { transform: 'none' }] },
  shake: { duration: 480, frames: [{ transform: 'rotate(-14deg)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(5deg)' }, { transform: 'none' }] },
  bounce: { duration: 560, frames: [{ transform: 'translateY(-16%) scale(0.95, 1.08)' }, { transform: 'scale(1.08, 0.9)' }, { transform: 'translateY(-6%)' }, { transform: 'none' }] },
  pop: { duration: 320, frames: [{ transform: 'scale(1.18)' }, { transform: 'scale(0.94)' }, { transform: 'none' }] },
};

const POW = [
  { opacity: 0, transform: 'translate(-50%, 20%) scale(0.4) rotate(-12deg)' },
  { opacity: 1, transform: 'translate(-50%, -15%) scale(1.15) rotate(-8deg)', offset: 0.25 },
  { opacity: 1, transform: 'translate(-50%, -25%) scale(1) rotate(-8deg)', offset: 0.7 },
  { opacity: 0, transform: 'translate(-50%, -40%) scale(0.95) rotate(-8deg)' },
];

const POW_STILL = [
  { opacity: 0, transform: 'translate(-50%, -15%) rotate(-8deg)' },
  { opacity: 1, transform: 'translate(-50%, -15%) rotate(-8deg)', offset: 0.2 },
  { opacity: 1, transform: 'translate(-50%, -15%) rotate(-8deg)', offset: 0.7 },
  { opacity: 0, transform: 'translate(-50%, -15%) rotate(-8deg)' },
];

// Makes an instrument drawing jump, ring or shake, and pops its sound word.
export function animateInstrument(artEl, powEl, inst, reducedMotion) {
  if (powEl && powEl.animate) powEl.animate(reducedMotion ? POW_STILL : POW, { duration: 650, easing: 'ease-out' });
  if (reducedMotion || !artEl || !artEl.animate) return;
  const m = MOTIONS[inst.motion];
  artEl.animate(m.frames, { duration: m.duration, easing: 'ease-out' });
}
