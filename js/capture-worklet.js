// Runs on the audio thread while a pad is recording. Forwards microphone samples to the
// page in small batches, each tagged with the context frame of its first sample so the
// page can line sound up with camera frames.
class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 512;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
    this.start = 0;
    this.live = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.live = false;
    };
  }

  process(inputs) {
    if (!this.live) return false;
    const input = inputs[0];
    const ch = input && input.length ? input[0] : null;
    const n = ch ? ch.length : 128;
    let off = 0;
    while (off < n) {
      if (this.fill === 0) this.start = currentFrame + off;
      const take = Math.min(n - off, this.size - this.fill);
      if (ch) this.buf.set(ch.subarray(off, off + take), this.fill);
      else this.buf.fill(0, this.fill, this.fill + take);
      this.fill += take;
      off += take;
      if (this.fill === this.size) {
        this.port.postMessage({ frame: this.start, samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('drum-board-tap', TapProcessor);
