// Turns a finished capture into what the board plays (AudioBuffer + frame sheet) and what
// IndexedDB stores (16-bit PCM + JPEG sheet), and turns stored records back into clips.

import { makeBuffer } from './audio.js';

const TARGET_PEAK = 0.6;   // every pad lands at a similar loudness...
const MAX_GAIN = 8;        // ...without turning near-silence into hiss
const JPEG_QUALITY = 0.8;

// Returns the playable clip right away, plus encode(), which produces the record to store.
// JPEG encoding can be slow, so it runs after the pad is already playable.
export async function clipFromCapture(cap) {
  const samples = shapeAudio(cap.pcm, cap.sampleRate);
  const frames = { w: cap.width, h: cap.height, cols: cap.cols, times: cap.times };
  let bitmap = null;
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(cap.sheet);
    } catch (err) {
      // Draw from the canvas itself instead.
    }
  }
  const clip = buildClip(frames, makeBuffer(samples, cap.sampleRate), bitmap || cap.sheet);
  const encode = async () => {
    try {
      const blob = await canvasToBlob(cap.sheet, 'image/jpeg', JPEG_QUALITY);
      return {
        v: 1,
        created: Date.now(),
        sampleRate: cap.sampleRate,
        pcm: toInt16(samples).buffer,
        sheet: await blobToArrayBuffer(blob),
        sheetType: blob.type || 'image/jpeg',
        frames,
      };
    } finally {
      if (bitmap) {
        // Hand the canvas memory back now; iOS limits total canvas memory.
        cap.sheet.width = 0;
        cap.sheet.height = 0;
      }
    }
  };
  return { clip, encode };
}

export async function clipFromRecord(record) {
  const samples = fromInt16(new Int16Array(record.pcm));
  const image = await decodeImage(new Blob([record.sheet], { type: record.sheetType || 'image/jpeg' }));
  return buildClip(record.frames, makeBuffer(samples, record.sampleRate), image);
}

export function releaseClip(clip) {
  if (clip && clip.image && typeof clip.image.close === 'function') clip.image.close();
}

function buildClip(frames, buffer, image) {
  return {
    buffer,
    image,
    w: frames.w,
    h: frames.h,
    cols: frames.cols,
    times: frames.times,
    duration: buffer.duration,
  };
}

function shapeAudio(input, sampleRate) {
  const n = input.length;
  const out = new Float32Array(n);
  // ~20 Hz high-pass: removes mic DC offset and rumble, which would click at the edges.
  const r = 1 - (2 * Math.PI * 20) / sampleRate;
  let px = input[0] || 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    const x = input[i];
    py = x - px + r * py;
    px = x;
    out[i] = py;
  }
  // Short fades so the pad starts and stops without a click.
  const fadeIn = Math.min(n, Math.round(sampleRate * 0.002));
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  const fadeOut = Math.min(n - fadeIn, Math.round(sampleRate * 0.02));
  for (let i = 0; i < fadeOut; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1e-5) {
    const gain = Math.min(TARGET_PEAK / peak, MAX_GAIN);
    for (let i = 0; i < n; i++) out[i] *= gain;
  }
  return out;
}

function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    out[i] = Math.round(x * 32767);
  }
  return out;
}

function fromInt16(ints) {
  const out = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i++) out[i] = ints[i] / 32767;
  return out;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the video frames.'))), type, quality);
  });
}

function blobToArrayBuffer(blob) {
  return blob.arrayBuffer ? blob.arrayBuffer() : new Response(blob).arrayBuffer();
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch (err) {
      // Fall back to an <img> below.
    }
  }
  // The object URL stays alive with the image so the browser can re-decode it later.
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  if (img.decode) await img.decode();
  else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
  return img;
}
