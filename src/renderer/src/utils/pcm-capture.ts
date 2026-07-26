/** Capture mic PCM (16-bit mono) via Web Audio, resampled toward 16 kHz. */

export type PcmCapture = {
  stop: () => Promise<{ pcmBase64: string; sampleRate: number }>;
  abort: () => void;
};

export async function startPcmCapture(): Promise<PcmCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let aborted = false;

  processor.onaudioprocess = (ev) => {
    if (aborted) return;
    const input = ev.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  const cleanup = () => {
    try {
      processor.disconnect();
      source.disconnect();
    } catch {
      // ignore
    }
    for (const t of stream.getTracks()) t.stop();
    void audioCtx.close();
  };

  return {
    abort: () => {
      aborted = true;
      cleanup();
    },
    stop: async () => {
      aborted = true;
      const inputRate = audioCtx.sampleRate || 48000;
      cleanup();
      const merged = mergeFloat32(chunks);
      const targetRate = 16000;
      const resampled = inputRate === targetRate ? merged : downsample(merged, inputRate, targetRate);
      const pcm16 = floatTo16BitPCM(resampled);
      const pcmBase64 = BufferLikeToBase64(pcm16);
      return { pcmBase64, sampleRate: targetRate };
    },
  };
}

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const newLen = Math.floor(input.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    out[i] = input[start] ?? 0;
  }
  return out;
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

function BufferLikeToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
