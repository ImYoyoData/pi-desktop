import { formatElapsedShort } from "./agent-wait";

/** 十秒内保留一位小数，更长用粗略单位（与工具行一致）。 */
export function formatDuration(ms: number): string {
  // 100ms 以下显示秒只会得到 "0.0s"，没有信息量。
  if (ms < 100) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatElapsedShort(ms);
}
