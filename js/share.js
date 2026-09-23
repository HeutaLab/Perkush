// Saving a board to a file, and opening one again.
//
// A board file holds the actual recordings — the faces and voices on the pads — so it
// never travels on its own: writing one hands the file to the device (Files, Downloads),
// and opening one uses the file picker. Nothing here talks to a network.

import { normaliseLoop } from './sequencer.js';

const FORMAT = 1;
const MAX_FILE = 80 * 1024 * 1024;  // a full board of recordings is a few MB
const MAX_NAME = 40;

// One board as a JSON file: instrument pads are a name, recorded pads carry their sound
// and pictures as base64.
export function boardToBlob(board, records) {
  const doc = {
    app: 'perkush',
    format: FORMAT,
    name: cleanName(board.name),
    created: Date.now(),
    loop: board.loop || null,
    pads: records.map(packPad).filter(Boolean),
  };
  return new Blob([JSON.stringify(doc)], { type: 'application/json' });
}

export function boardFilename(name) {
  const stem = cleanName(name).replace(/[^\w \-]+/g, '').trim().replace(/\s+/g, '-') || 'board';
  return `${stem}.perkush.json`;
}

// Hands the file to the browser to save (Files on iPad, the downloads folder elsewhere).
export function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Reads a file the child picked. Throws a friendly message if it is not a board file.
export async function readBoardFile(file, padCount) {
  if (file.size > MAX_FILE) throw new Error('that file is too big to be a board');
  let doc;
  try {
    doc = JSON.parse(await readText(file));
  } catch (err) {
    throw new Error('that file is not a Perkush board');
  }
  if (!doc || doc.app !== 'perkush' || !Array.isArray(doc.pads)) {
    throw new Error('that file is not a Perkush board');
  }
  if (Number(doc.format) > FORMAT) {
    throw new Error('that board was saved by a newer version of Perkush');
  }
  const pads = [];
  const seen = new Set();
  for (const raw of doc.pads) {
    const pad = unpackPad(raw, padCount);
    if (!pad || seen.has(pad.pad)) continue;
    seen.add(pad.pad);
    pads.push(pad);
  }
  if (!pads.length) throw new Error('that board file has no sounds in it');
  return {
    name: cleanName(doc.name || fileStem(file.name)),
    loop: normaliseLoop(doc.loop),
    pads,
  };
}

function packPad(record) {
  const pad = Math.trunc(record.pad);
  if (!Number.isInteger(pad) || pad < 0) return null;
  if (record.kind === 'inst') return { pad, kind: 'inst', inst: String(record.inst) };
  if (!record.pcm || !record.sheet || !record.frames) return null;
  return {
    pad,
    v: 1,
    created: record.created || Date.now(),
    sampleRate: record.sampleRate,
    pcm: toBase64(record.pcm),
    sheet: toBase64(record.sheet),
    sheetType: record.sheetType || 'image/jpeg',
    frames: record.frames,
  };
}

function unpackPad(raw, padCount) {
  if (!raw || typeof raw !== 'object') return null;
  const pad = Math.trunc(Number(raw.pad));
  if (!Number.isInteger(pad) || pad < 0 || pad >= padCount) return null;
  if (raw.kind === 'inst') {
    return typeof raw.inst === 'string' ? { pad, kind: 'inst', inst: raw.inst, created: Date.now() } : null;
  }
  const sampleRate = Number(raw.sampleRate);
  const frames = raw.frames;
  if (!(sampleRate >= 4000 && sampleRate <= 192000)) return null;
  if (typeof raw.pcm !== 'string' || typeof raw.sheet !== 'string') return null;
  if (!frames || !Array.isArray(frames.times) || !frames.times.length) return null;
  const size = (x) => Number.isFinite(Number(x)) && Number(x) > 0 && Number(x) <= 4096;
  if (!size(frames.w) || !size(frames.h) || !size(frames.cols)) return null;
  let pcm;
  let sheet;
  try {
    pcm = fromBase64(raw.pcm);
    sheet = fromBase64(raw.sheet);
  } catch (err) {
    return null;
  }
  if (!pcm.byteLength || !sheet.byteLength) return null;
  return {
    pad,
    v: 1,
    created: Number(raw.created) || Date.now(),
    sampleRate,
    pcm,
    sheet,
    sheetType: typeof raw.sheetType === 'string' ? raw.sheetType : 'image/jpeg',
    frames: {
      w: Number(frames.w),
      h: Number(frames.h),
      cols: Math.trunc(Number(frames.cols)),
      times: frames.times.map(Number).filter(Number.isFinite),
    },
  };
}

export function cleanName(name) {
  const text = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  return (text || 'My board').slice(0, MAX_NAME);
}

function fileStem(name) {
  return String(name || '').replace(/\.[^.]*$/, '').replace(/\.perkush$/i, '');
}

function readText(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('the file could not be read'));
    reader.readAsText(file);
  });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let text = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(text);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
