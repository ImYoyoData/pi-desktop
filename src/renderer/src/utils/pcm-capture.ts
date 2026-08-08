/**
 * Mic capture → 16 kHz PCM.
 * Voice record mode buffers audio for one-shot transcription (Cursor-like).
 * Stream push mode remains for any leftover callers.
 *
 * Uses AudioWorkletNode (ScriptProcessorNode is deprecated).
 *
 * Low-power path: light getUserMedia constraints, prewarmed AudioWorklet,
 * no per-frame resample on the UI thread, throttled level meters.
 */

import {
  downsample,
  encodeFloatChunksSync,
  floatTo16BitPCM,
} from "./pcm-encode-core";
import { isLowPowerClient, yieldToPaint } from "./low-power";

export type PcmCapture = {
  stop: () => Promise<{ pcm: Int16Array; sampleRate: number }>;
  abort: () => void;
};

export type StreamingPcmCapture = {
  stop: () => void;
  abort: () => void;
};

export type VoiceRecordSession = {
  stop: () => Promise<{ pcm: Int16Array; sampleRate: number }>;
  abort: () => void;
};

export type PcmStreamPushHandlers = {
  /** Fired every audio frame as 16 kHz s16le base64 (includes silence). */
  onChunk: (pcmBase64: string, sampleRate: number) => void | Promise<void>;
  /** Raw speech-energy flag per frame (before hangover gating) — used for local silence timing. */
  onVoice?: (active: boolean) => void;
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

const WORKLET_NAME = "pi-pcm-capture-processor";

/** Inline worklet: copy input channel and post to main thread. */
const WORKLET_SOURCE = `
class PiPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', PiPcmCaptureProcessor);
`;

let workletModuleUrl: string | null = null;
/** Prewarmed context with worklet module already loaded (suspended). */
let warmCtx: AudioContext | null = null;
let warmModuleReady = false;
let micPermissionOk: boolean | null = null;
let prewarmFlight: Promise<void> | null = null;

function workletBlobUrl(): string {
  if (!workletModuleUrl) {
    workletModuleUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
    );
  }
  return workletModuleUrl;
}

function micAudioConstraints(): MediaTrackConstraints {
  const low = isLowPowerClient();
  // Browser AEC/NS/AGC are surprisingly expensive on low-clock CPUs and often
  // run on the capture render path — disable them when we need click snappiness.
  return {
    channelCount: 1,
    echoCancellation: !low,
    noiseSuppression: !low,
    autoGainControl: !low,
  };
}

/**
 * Best-effort warm-up so the first mic click does not pay AudioWorklet compile
 * + AudioContext creation on the critical path.
 */
export async function prewarmVoiceCapture(): Promise<void> {
  if (prewarmFlight) return prewarmFlight;
  prewarmFlight = (async () => {
    try {
      if (micPermissionOk === null) {
        try {
          micPermissionOk = await window.api.window.requestMediaAccess("microphone");
        } catch {
          micPermissionOk = true;
        }
      }
      if (!warmCtx || warmCtx.state === "closed") {
        warmCtx = new AudioContext({ latencyHint: "interactive" });
        warmModuleReady = false;
      }
      if (warmCtx.state === "suspended") {
        try {
          await warmCtx.resume();
        } catch {
          /* ignore */
        }
      }
      if (!warmModuleReady) {
        await warmCtx.audioWorklet.addModule(workletBlobUrl());
        warmModuleReady = true;
      }
      if (warmCtx.state === "running") {
        try {
          await warmCtx.suspend();
        } catch {
          /* ignore */
        }
      }
    } catch {
      // best-effort — click path still works cold
    } finally {
      prewarmFlight = null;
    }
  })();
  return prewarmFlight;
}

/** Legacy one-shot capture (kept for tests / fallback). */
export async function startPcmCapture(): Promise<PcmCapture> {
  const session = await openMicSession();
  const chunks: Float32Array[] = [];
  let aborted = false;

  session.worklet.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    if (aborted) return;
    const data = ev.data;
    if (data instanceof Float32Array) chunks.push(data);
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
      const pcm = await encodePcmToInt16(chunks, inputRate, TARGET_RATE);
      return { pcm, sampleRate: TARGET_RATE };
    },
  };
}

/**
 * Cursor-like voice take: buffer mic audio with ambient gated out,
 * emit normalized levels for the waveform UI.
 *
 * Heavy resample/encode runs once on stop (worker), not every audio frame.
 */
export async function startVoiceRecord(handlers: {
  onLevel?: (level: number) => void;
  /** Fired when max duration is reached — caller should confirm. */
  onMaxDuration?: () => void;
}): Promise<VoiceRecordSession> {
  // Let the record bar paint before we open the mic / AudioContext.
  await yieldToPaint();
  const session = await openMicSession();
  const inputRate = session.sampleRate;
  const chunks: Float32Array[] = [];
  let aborted = false;
  let stopped = false;
  let lastVoiceAt = 0;
  const startedAt = Date.now();
  let maxFired = false;
  // ~20 Hz meter is plenty for the bar; avoids Vue-adjacent churn every 10ms.
  const levelIntervalMs = isLowPowerClient() ? 50 : 40;
  let lastLevelAt = 0;

  session.worklet.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    if (aborted || stopped) return;
    const input = ev.data;
    if (!(input instanceof Float32Array) || input.length === 0) return;

    const rms = calcRms(input);
    const now = Date.now();
    if (rms >= SPEECH_RMS) lastVoiceAt = now;

    if (handlers.onLevel && now - lastLevelAt >= levelIntervalMs) {
      lastLevelAt = now;
      handlers.onLevel(Math.min(1, rms / 0.08));
    }

    const inHangover = lastVoiceAt > 0 && now - lastVoiceAt < SPEECH_HANGOVER_MS;
    const keepVoice = rms >= SPEECH_RMS || inHangover;
    // Skip silence entirely (no zero-fill allocations). Resample once on stop.
    if (keepVoice) chunks.push(input);

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
        return { pcm: new Int16Array(0), sampleRate: TARGET_RATE };
      }
      stopped = true;
      aborted = true;
      session.cleanup();
      // Resample + encode off the UI thread.
      const pcm = await encodePcmToInt16(chunks, inputRate, TARGET_RATE);
      // Warm the next click in the background.
      void prewarmVoiceCapture();
      return { pcm, sampleRate: TARGET_RATE };
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

  session.worklet.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    if (stopped) return;
    const input = ev.data;
    if (!(input instanceof Float32Array) || input.length === 0) return;

    const rms = calcRms(input);
    const now = Date.now();
    if (rms >= SPEECH_RMS) {
      lastSpeechAt = now;
      lastVoiceAt = now;
    }
    try {
      handlers.onVoice?.(rms >= SPEECH_RMS);
    } catch {
      // caller handles errors
    }

    const resampled = inputRate === TARGET_RATE ? input : downsample(input, inputRate, TARGET_RATE);
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
  worklet: AudioWorkletNode;
  sampleRate: number;
  cleanup: () => void;
};

async function takeWarmContext(): Promise<AudioContext | null> {
  const ctx = warmCtx;
  if (!ctx || ctx.state === "closed" || !warmModuleReady) return null;
  warmCtx = null;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
  }
  return ctx;
}

async function openMicSession(): Promise<MicSession> {
  // macOS: trigger TCC microphone prompt before Chromium getUserMedia
  if (micPermissionOk === false) {
    throw new Error(
      "Microphone permission denied — allow mic access in System Settings → Privacy & Security → Microphone, then retry.",
    );
  }
  if (micPermissionOk === null) {
    try {
      const ok = await window.api.window.requestMediaAccess("microphone");
      micPermissionOk = ok;
      if (!ok) {
        throw new Error(
          "Microphone permission denied — allow mic access in System Settings → Privacy & Security → Microphone, then retry.",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Microphone permission denied")) throw err;
      // Non-Electron / missing API — fall through to getUserMedia
      micPermissionOk = true;
    }
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: micAudioConstraints(),
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      micPermissionOk = false;
      throw new Error(
        "Microphone permission denied — allow mic access in system settings, then retry.",
      );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw new Error("No microphone found.");
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  let audioCtx = await takeWarmContext();
  if (!audioCtx) {
    audioCtx = new AudioContext({ latencyHint: "interactive" });
    if (audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
      } catch {
        // ignore
      }
    }
    try {
      await audioCtx.audioWorklet.addModule(workletBlobUrl());
      warmModuleReady = true;
    } catch (err) {
      for (const t of stream.getTracks()) t.stop();
      void audioCtx.close();
      const msg = err instanceof Error ? err.message : String(err);
      if (/worklet/i.test(msg)) {
        throw new Error(
          `Unable to load audio worklet (${msg}). Check CSP worker-src allows blob:.`,
        );
      }
      throw err instanceof Error ? err : new Error(msg);
    }
  }

  const source = audioCtx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioCtx, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(worklet);
  worklet.connect(mute);
  mute.connect(audioCtx.destination);

  const ctx = audioCtx;
  const cleanup = () => {
    try {
      worklet.port.onmessage = null;
      worklet.disconnect();
      source.disconnect();
      mute.disconnect();
    } catch {
      // ignore
    }
    for (const t of stream.getTracks()) t.stop();
    void ctx.close().finally(() => {
      // Recreate a suspended warm context for the next click (module URL stays).
      if (!warmCtx || warmCtx.state === "closed") {
        void prewarmVoiceCapture();
      }
    });
  };

  return {
    worklet,
    sampleRate: audioCtx.sampleRate || 48000,
    cleanup,
  };
}

function calcRms(input: Float32Array): number {
  // Stride sampling on long buffers — enough for a meter / VAD gate.
  const step = input.length > 256 ? 4 : 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < input.length; i += step) {
    const v = input[i] ?? 0;
    sum += v * v;
    n += 1;
  }
  return Math.sqrt(sum / Math.max(1, n));
}

/**
 * Encode recorded Float32 chunks to 16 kHz s16le PCM. Runs on a Web Worker
 * so the encode (merge / resample / convert) never blocks the UI thread;
 * falls back to the synchronous path when workers are unavailable.
 */
async function encodePcmToInt16(
  chunks: Float32Array[],
  inputRate: number,
  targetRate: number,
): Promise<Int16Array> {
  try {
    const { encodePcmChunks } = await import("./pcm-encode-client");
    const buffer = await encodePcmChunks(chunks, inputRate, targetRate);
    return new Int16Array(buffer);
  } catch {
    return encodeFloatChunksSync(chunks, inputRate, targetRate);
  }
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
