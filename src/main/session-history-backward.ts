import { readSync } from "node:fs";
import type { BackwardChunk } from "./session-history-parse";

const MIN_SPAN = 64 * 1024;
const MAX_SPAN = 32 * 1024 * 1024;

/** 从文件尾往回读一块完整行；单行超长时抛错由调用方回退整文件解析。 */
export function readBackwardLines(fd: number, fromByte: number): BackwardChunk | null {
  if (fromByte <= 0) return null;
  let span = MIN_SPAN;
  for (;;) {
    const start = Math.max(0, fromByte - span);
    const buf = Buffer.allocUnsafe(fromByte - start);
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    const chunk = read === buf.length ? buf : buf.subarray(0, read);
    if (start === 0) {
      return { start: 0, lines: chunk.toString("utf8").split("\n") };
    }
    const nl = chunk.indexOf(0x0a);
    // 换行恰好在块尾时本块还给不出完整行（整行都在这块里）——往前再读一节。
    if (nl >= 0 && nl + 1 < chunk.length) {
      return {
        start: start + nl + 1,
        lines: chunk.subarray(nl + 1).toString("utf8").split("\n"),
      };
    }
    if (fromByte - start >= MAX_SPAN) {
      throw new Error("session line too long for reverse read");
    }
    span *= 2;
  }
}
