/** wait 卡片的状态聚合：标题、计数、排序与累计等待时长。 */

import type { Messages } from "../i18n";
import type { WaitJob } from "./tool-diff";

export type WaitJobCounts = {
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
};

export function waitJobCounts(jobs: readonly WaitJob[]): WaitJobCounts {
  const counts: WaitJobCounts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const job of jobs) counts[job.status] += 1;
  return counts;
}

/** 运行中优先，然后失败/取消，已完成的排最后；同状态按已运行时间降序。 */
const WAIT_STATUS_ORDER: Record<WaitJob["status"], number> = {
  running: 0,
  failed: 1,
  cancelled: 2,
  completed: 3,
};

export function sortWaitJobs(jobs: readonly WaitJob[]): WaitJob[] {
  return [...jobs].sort(
    (a, b) =>
      WAIT_STATUS_ORDER[a.status] - WAIT_STATUS_ORDER[b.status] ||
      b.durationMs - a.durationMs,
  );
}

/** 折叠行的标题：等待中的任务数，或结束后的总量。 */
export function waitHeadline(
  jobs: readonly WaitJob[],
  t: Messages,
  streaming: boolean,
): string {
  if (!jobs.length) return streaming ? t.toolWaitPending : t.toolWaitFinished;
  const counts = waitJobCounts(jobs);
  if (counts.running === 0) return t.toolWaitSettled(jobs.length);
  if (!streaming) return t.toolWaitLingering(counts.running);
  if (counts.running === jobs.length) return t.toolWaitRunning(counts.running);
  return t.toolWaitPartial(counts.running, jobs.length);
}

/** 头部累计等待：跑着用开始时间算，结束后用工具记录的耗时。 */
export function waitElapsedMs(
  startedAt: number | null,
  durationMs: number | null | undefined,
  streaming: boolean,
  now: number,
): number | null {
  if (!streaming) return durationMs != null && durationMs > 0 ? durationMs : null;
  return startedAt != null ? Math.max(0, now - startedAt) : null;
}
