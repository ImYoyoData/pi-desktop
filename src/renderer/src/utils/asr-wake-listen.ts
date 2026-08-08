/**

 * Singleton always-on wake-word listener (renderer-owned mic → streamPush).

 * Only one capture/stream session runs app-wide.

 */



import { matchWakeWords, parseWakeWords } from "../../../shared/asr-wake";

import type { AsrStreamEvent } from "../../../shared/asr";

import { startPcmStreamPush, type StreamingPcmCapture } from "./pcm-capture";



/** Dispatched on window after voice wake match (+ cue). Composer opens dictation. */
export const ASR_VOICE_WAKE_EVENT = "pi-asr-wake";

export type WakeListenDeps = {

  getWakeWords: () => string;

  streamStart: () => Promise<void>;

  streamPush: (pcmBase64: string) => void;

  streamStop: () => Promise<void>;

  bindStreamEvents: (onEvent: (event: AsrStreamEvent) => void) => () => void;

  onWake: () => void | Promise<void>;

};



let capture: StreamingPcmCapture | null = null;

let offStream: (() => void) | null = null;

let running = false;

let starting = false;

let stopping = false;

let firing = false;

/** Bumped by stop to cancel an in-flight start. */

let listenGen = 0;

/** True after streamStart succeeds until streamStop (even if mic not attached yet). */

let streamOwned = false;

/** In-flight start so stop can await and always tear down a just-started stream. */

let startPromise: Promise<void> | null = null;

/** Ignore matches briefly after start / after a fire. */

let ignoreUntil = 0;



let lastDeps: WakeListenDeps | null = null;



export function isWakeListenRunning(): boolean {

  return running;

}

export function isWakeStreamWarm(): boolean {
  return running || streamOwned;
}

let preloadOwned = false;
let preloadDeps: WakeListenDeps | null = null;

/**
 * Preload-only mode: start the stream (loads the model into memory) WITHOUT
 * opening the mic or matching wake words — the model is warm but never
 * listening. Used when “model resident” is on but voice wake is off.
 */
export async function startPreloadStream(deps: WakeListenDeps): Promise<void> {
  preloadDeps = deps;
  if (preloadOwned || running || starting) return;
  preloadOwned = true;
  try {
    await deps.streamStart();
  } catch (err) {
    preloadOwned = false;
    throw err;
  }
}

export async function stopPreloadStream(): Promise<void> {
  if (!preloadOwned) return;
  preloadOwned = false;
  try {
    await preloadDeps?.streamStop();
  } catch {
    // best-effort
  }
}



async function tearDownCapture(): Promise<void> {

  capture?.stop();

  capture = null;

  offStream?.();

  offStream = null;

  running = false;

  if (streamOwned) {

    streamOwned = false;

    try {

      await lastDeps?.streamStop();

    } catch {

      // ignore

    }

  }

}



export async function stopWakeListen(): Promise<void> {

  if (stopping) return;

  stopping = true;

  listenGen += 1;

  try {

    // Let an in-flight start notice cancellation and release its stream.

    if (startPromise) {

      try {

        await startPromise;

      } catch {

        // ignore start errors during stop

      }

    }

    await tearDownCapture();

  } finally {

    stopping = false;

    starting = false;

    firing = false;

  }

}



/**
 * Pause the wake listener's mic + event matching but keep the warm stream
 * (and the loaded model) alive, so dictation can reuse it instantly.
 */
export async function suspendWakeListen(): Promise<void> {
  if (!running && !starting) return;
  // Let an in-flight start finish so it owns the stream, then pause just the mic.
  if (startPromise) {
    try {
      await startPromise;
    } catch {
      // ignore start errors during suspend
    }
  }
  capture?.stop();
  capture = null;
  offStream?.();
  offStream = null;
  running = false;
  // streamOwned intentionally stays true — the stream child stays warm.
}

export async function startWakeListen(deps: WakeListenDeps): Promise<void> {

  lastDeps = deps;

  if (running || starting || stopping || firing) return;

  starting = true;

  const gen = listenGen;

  const work = (async () => {

    try {

      await deps.streamStart();

      if (gen !== listenGen) {

        try {

          await deps.streamStop();

        } catch {

          // ignore

        }

        return;

      }

      streamOwned = true;

      ignoreUntil = Date.now() + 800;

      offStream = deps.bindStreamEvents((event) => {

        if (firing || !running) return;

        if (event.type !== "partial" && event.type !== "final") return;

        if (Date.now() < ignoreUntil) return;

        const words = parseWakeWords(deps.getWakeWords());

        const hit = matchWakeWords(event.text, words);

        if (!hit) return;

        firing = true;

        ignoreUntil = Date.now() + 2000;

        void (async () => {

          try {

            await suspendWakeListen();
            await deps.onWake();

          } finally {

            firing = false;

          }

        })();

      });

      capture = await startPcmStreamPush({

        onChunk: (pcmBase64) => {

          deps.streamPush(pcmBase64);

        },

        idleStop: false,

      });

      if (gen !== listenGen) {

        capture?.stop();

        capture = null;

        offStream?.();

        offStream = null;

        streamOwned = false;

        try {

          await deps.streamStop();

        } catch {

          // ignore

        }

        return;

      }

      running = true;

    } catch (err) {

      capture?.abort();

      capture = null;

      offStream?.();

      offStream = null;

      running = false;

      if (streamOwned || gen === listenGen) {

        streamOwned = false;

        try {

          await deps.streamStop();

        } catch {

          // ignore

        }

      }

      throw err;

    } finally {

      starting = false;

    }

  })();

  startPromise = work;

  try {

    await work;

  } finally {

    if (startPromise === work) startPromise = null;

  }

}



/**

 * Start or stop wake listen to match desired state.

 * Returns quietly on start failure (caller may toast).

 */

export async function syncWakeListen(

  desired: boolean,

  deps: WakeListenDeps,

): Promise<{ ok: boolean; error?: string }> {

  lastDeps = deps;

  if (!desired) {

    await stopWakeListen();

    return { ok: true };

  }

  if (running || starting) return { ok: true };

  try {

    await startWakeListen(deps);

    return { ok: true };

  } catch (err) {

    const error = err instanceof Error ? err.message : String(err);

    return { ok: false, error };

  }

}


