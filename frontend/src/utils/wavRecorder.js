// Records microphone audio and encodes it directly to 16-bit PCM WAV in the
// browser using the Web Audio API. We avoid MediaRecorder's compressed
// webm/opus output on purpose: it would need ffmpeg/audioread on the server
// to decode, whereas a WAV blob is read natively by the backend with zero
// extra dependencies - simpler and more reliable for a prototype.

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

export class WavRecorder {
  constructor({ onChunk = null, chunkSeconds = null } = {}) {
    this.onChunk = onChunk;
    this.chunkSeconds = chunkSeconds;
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.buffers = [];
    this.chunkBuffers = [];
    this.chunkIndex = 0;
    this.sampleRate = 16000;
    this.levelCallback = null;
  }

  onLevel(cb) {
    this.levelCallback = cb;
  }

  // `externalStream`: pass an already-acquired MediaStream (e.g. a remote
  // WebRTC peer's audio track) instead of requesting the local microphone.
  // Used by WebRTCDemo.jsx to analyze audio received from the other peer
  // through the same chunking/analysis pipeline as the local mic flow.
  async start(externalStream = null) {
    this.stream = externalStream || (await navigator.mediaDevices.getUserMedia({ audio: true }));
    this.ownsStream = !externalStream;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.sampleRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    const bufferSize = 4096;
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    let samplesSinceChunk = 0;
    const chunkSampleTarget = this.chunkSeconds ? this.chunkSeconds * this.sampleRate : null;

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);
      this.buffers.push(copy);
      this.chunkBuffers.push(copy);
      samplesSinceChunk += copy.length;

      if (this.levelCallback) {
        let sum = 0;
        for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
        this.levelCallback(Math.sqrt(sum / copy.length));
      }

      if (chunkSampleTarget && samplesSinceChunk >= chunkSampleTarget) {
        const merged = mergeBuffers(this.chunkBuffers, samplesSinceChunk);
        const blob = encodeWAV(merged, this.sampleRate);
        this.chunkBuffers = [];
        samplesSinceChunk = 0;
        const idx = this.chunkIndex++;
        if (this.onChunk) this.onChunk(blob, idx);
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }
    if (this.source) this.source.disconnect();
    if (this.stream && this.ownsStream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.audioContext) this.audioContext.close();

    const totalLength = this.buffers.reduce((a, b) => a + b.length, 0);
    const merged = mergeBuffers(this.buffers, totalLength);
    return encodeWAV(merged, this.sampleRate);
  }
}

function mergeBuffers(buffers, totalLength) {
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// File-based slicing, used by the Live Call Monitor demo simulation: takes a
// pre-recorded audio file (fetched from the backend's /demo_audio static
// files) and cuts it into overlapping windows that get fed through the same
// /api/analyze-chunk endpoint the real microphone live-monitor mode uses -
// same analysis engine, same deterministic scoring, just reading from a file
// instead of a live input device.
// ---------------------------------------------------------------------------

export async function fetchAndDecodeAudio(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load demo audio (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const mono = audioBuffer.numberOfChannels > 1
    ? averageChannels(audioBuffer)
    : audioBuffer.getChannelData(0).slice();
  const sampleRate = audioBuffer.sampleRate;
  audioContext.close();
  return { samples: mono, sampleRate };
}

function averageChannels(audioBuffer) {
  const length = audioBuffer.length;
  const out = new Float32Array(length);
  const channels = audioBuffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i] / channels;
  }
  return out;
}

// Slices `samples` into sliding windows (windowSeconds long, stepSeconds
// apart) and returns an array of { blob, startSeconds, endSeconds, samples }.
// Sliding windows (rather than strictly back-to-back chunks) give a smoother,
// still fully deterministic run of data points for the live-call visualization.
export function sliceIntoWindows(samples, sampleRate, windowSeconds = 1.6, stepSeconds = 0.6) {
  const windowLen = Math.floor(windowSeconds * sampleRate);
  const stepLen = Math.floor(stepSeconds * sampleRate);
  const windows = [];
  for (let start = 0; start + windowLen <= samples.length; start += stepLen) {
    const slice = samples.subarray(start, start + windowLen);
    windows.push({
      blob: encodeWAV(slice, sampleRate),
      startSeconds: start / sampleRate,
      endSeconds: (start + windowLen) / sampleRate,
      samples: slice,
    });
  }
  return windows;
}

export { encodeWAV };
