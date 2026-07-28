/**
 * Mic capture → 16 kHz PCM.
 * Voice record mode buffers audio for one-shot transcription (Cursor-like).
 * Stream push mode remains for any leftover callers.
 */

export type PcmCapture = {
  stop: () => Promise<{ pcmBase64: string; sampleRate: number }>;
  abort: () => void;
};

export type StreamingPcmCapture = {
  stop: () => void;
  abort: () => void;
};

export type VoiceRecordSession = {
  stop: () => Promise<{ pcmBase64: string; sampleRate: number }>;
  abort: () => void;
};

export type PcmStreamPushHandlers = {
  /** Fired every audio frame as 16 kHz s16le base64 (includes silence). */
  onChunk: (pcmBase64: string, sampleRate: number) => void | Promise<void>;
  /** Fired after IDLE_STOP_MS with no speech energy. */
  onIdleStop?: () => void;
  /**
   * When false, never auto-stop on silence (always-on wake listening).
   * Default true.
   */
  idleStop?: boolean;
};

const TARGET_RATE = 16000;
/**
 * RMS above this counts as voice. Higher than raw ambient / keyboard / fan noise
 * so we only forward human speech (+ hangover) into the ASR buffer.
 */
const SPEECH_RMS = 0.014;
/** Keep capturing briefly after speech so word tails are not clipped. */
const SPEECH_HANGOVER_MS = 450;
/** No speech at all → auto stop listening (stream push only). */
const IDLE_STOP_MS = 30_000;
/** Hard cap for one Cursor-like take. */
const MAX_VOICE_RECORD_MS = 120_000;
/** Smaller buffer → snappier push (~43ms @ 48kHz). */
const PROCESSOR_BUFFER = 2048;

/** Legacy one-shot capture (kept for tests / fallback). */
export async function startPcmCapture(): Promise<PcmCapture> {
  const session = await openMicSession();
  const chunks: Float32Array[] = [];
  let aborted = false;

  session.processor.onaudioprocess = (ev) => {
    if (aborted) return;
    chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
  };

  return {
    abort: () => {
      aborted = true;
      session.cleanup();
    },
    stop: async () => {
      aborted = true;
      const inputRate = session.sampleRate;
      session.cleanup();
      const merged = mergeFloat32(chunks);
      const resampled = inputRate === TARGET_RATE ? merged : downsample(merged, inputRate, TARGET_RATE);
      return {
        pcmBase64: int16ToBase64(floatTo16BitPCM(resampled)),
        sampleRate: TARGET_RATE,
      };
    },
  };
}

/**
 * Cursor-like voice take: buffer mic audio with ambient gated to silence,
 * emit normalized levels for the waveform UI.
 */
export async function startVoiceRecord(handlers: {
  onLevel?: (level: number) => void;
  /** Fired when max duration is reached — caller should confirm. */
  onMaxDuration?: () => void;
}): Promise<VoiceRecordSession> {
  const session = await openMicSession();
  const inputRate = session.sampleRate;
  const chunks: Float32Array[] = [];
  let aborted = false;
  let stopped = false;
  let lastVoiceAt = 0;
  const startedAt = Date.now();
  let maxFired = false;

  session.processor.onaudioprocess = (ev) => {
    if (aborted || stopped) return;
    const input = ev.inputBuffer.getChannelData(0);
    const rms = calcRms(input);
    const now = Date.now();
    if (rms >= SPEECH_RMS) lastVoiceAt = now;

    const level = Math.min(1, rms / 0.08);
    handlers.onLevel?.(level);

    const copy = new Float32Array(input);
    const resampled = inputRate === TARGET_RATE ? copy : downsample(copy, inputRate, TARGET_RATE);
    if (resampled.length === 0) return;

    const inHangover = lastVoiceAt > 0 && now - lastVoiceAt < SPEECH_HANGOVER_MS;
    const keepVoice = rms >= SPEECH_RMS || inHangover;
    chunks.push(keepVoice ? resampled : new Float32Array(resampled.length));

    if (!maxFired && now - startedAt >= MAX_VOICE_RECORD_MS) {
      maxFired = true;
      stopped = true;
      handlers.onMaxDuration?.();
    }
  };

  return {
    abort: () => {
      if (aborted) return;
      aborted = true;
      stopped = true;
      session.cleanup();
    },
    stop: async () => {
      if (aborted) {
        return { pcmBase64: "", sampleRate: TARGET_RATE };
      }
      // Flip flags first so onaudioprocess stops immediately (no more recording/levels)
      stopped = true;
      aborted = true;
      session.cleanup();
      const merged = mergeFloat32(chunks);
      return {
        pcmBase64: int16ToBase64(floatTo16BitPCM(merged)),
        sampleRate: TARGET_RATE,
      };
    },
  };
}

/**
 * Continuous listening: push PCM to the host stream process.
 * Non-voice frames are replaced with silence so ambient noise is not transcribed.
 */
export async function startPcmStreamPush(handlers: PcmStreamPushHandlers): Promise<StreamingPcmCapture> {
  const session = await openMicSession();
  const inputRate = session.sampleRate;
  const idleStop = handlers.idleStop !== false;

  let stopped = false;
  let lastSpeechAt = Date.now();
  let lastVoiceAt = 0;

  session.processor.onaudioprocess = (ev) => {
    if (stopped) return;
    const input = ev.inputBuffer.getChannelData(0);
    const rms = calcRms(input);
    const now = Date.now();
    if (rms >= SPEECH_RMS) {
      lastSpeechAt = now;
      lastVoiceAt = now;
    }

    const copy = new Float32Array(input);
    const resampled = inputRate === TARGET_RATE ? copy : downsample(copy, inputRate, TARGET_RATE);
    if (resampled.length === 0) return;

    const inHangover = lastVoiceAt > 0 && now - lastVoiceAt < SPEECH_HANGOVER_MS;
    const forwardVoice = rms >= SPEECH_RMS || inHangover;
    const pcm = forwardVoice ? floatTo16BitPCM(resampled) : new Int16Array(resampled.length);
    const pcmBase64 = int16ToBase64(pcm);
    try {
      void handlers.onChunk(pcmBase64, TARGET_RATE);
    } catch {
      // caller handles errors
    }

    if (idleStop && now - lastSpeechAt >= IDLE_STOP_MS) {
      stopped = true;
      session.cleanup();
      handlers.onIdleStop?.();
    }
  };

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      session.cleanup();
    },
    abort: () => {
      if (stopped) return;
      stopped = true;
      session.cleanup();
    },
  };
}

/** @deprecated Prefer startPcmStreamPush. */
export async function startStreamingPcmCapture(handlers: {
  onUtterance: (pcmBase64: string, sampleRate: number) => void | Promise<void>;
  onIdleStop?: () => void;
}): Promise<StreamingPcmCapture> {
  return startPcmStreamPush({
    onChunk: handlers.onUtterance,
    onIdleStop: handlers.onIdleStop,
  });
}

type MicSession = {
  processor: ScriptProcessorNode;
  sampleRate: number;
  cleanup: () => void;
};

async function openMicSession(): Promise<MicSession> {
  // macOS: trigger TCC microphone prompt before Chromium getUserMedia
  try {
    const ok = await window.api.window.requestMediaAccess("microphone");
    if (!ok) {
      throw new Error(
        "Microphone permission denied — allow mic access in System Settings → Privacy & Security → Microphone, then retry.",
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Microphone permission denied")) throw err;
    // Non-Electron / missing API — fall through to getUserMedia
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error(
        "Microphone permission denied — allow mic access in system settings, then retry.",
      );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw new Error("No microphone found.");
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  const audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch {
      // ignore
    }
  }
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  const cleanup = () => {
    try {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
    } catch {
      // ignore
    }
    for (const t of stream.getTracks()) t.stop();
    void audioCtx.close();
  };

  return {
    processor,
    sampleRate: audioCtx.sampleRate || 48000,
    cleanup,
  };
}

function calcRms(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = input[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, input.length));
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

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
