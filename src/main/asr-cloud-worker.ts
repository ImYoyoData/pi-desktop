/**
 * ASR worker 线程：WAV 编码（云端路径）与本地 WAV 落盘，避免阻塞主进程。
 * 云端 HTTP 由主进程发送（worker 线程无法使用 Electron net，也无法走代理）。
 *
 * Job:  { kind?: "encodeWav", sampleRate, pcm } / { kind: "writeWav", path, sampleRate, pcm }
 * Reply: { ok: true, wav? } | { ok: false, error }
 */

import { writeFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";

type EncodeWavJob = {
  kind?: "encodeWav";
  sampleRate: number;
  pcm: ArrayBuffer;
};

type WriteWavJob = {
  kind: "writeWav";
  path: string;
  sampleRate: number;
  pcm: ArrayBuffer;
};

type Job = EncodeWavJob | WriteWavJob;

type Reply = { ok: true; wav?: ArrayBuffer } | { ok: false; error: string };

function wavBytesFromPcm(pcm: Int16Array, sampleRate: number): Buffer<ArrayBuffer> {
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, 44);
  return buffer;
}

function reply(msg: Reply, transfer: ArrayBuffer[] = []): void {
  parentPort?.postMessage(msg, transfer);
}

function pcmView(ab: ArrayBuffer): Int16Array {
  return new Int16Array(ab);
}

parentPort?.on("message", (job: Job) => {
  void (async () => {
    try {
      if (!job?.pcm) throw new Error("ASR worker: missing pcm");
      const pcm = pcmView(job.pcm);
      const wav = wavBytesFromPcm(pcm, job.sampleRate || 16000);
      if (job.kind === "writeWav") {
        if (!job.path) throw new Error("ASR worker: missing wav path");
        writeFileSync(job.path, wav);
        reply({ ok: true });
        return;
      }
      const wavBytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
      reply({ ok: true, wav: wavBytes }, [wavBytes]);
    } catch (err) {
      reply({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
});
