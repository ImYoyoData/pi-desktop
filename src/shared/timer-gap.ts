/**
 * 定时器 tick 间隔检测：系统休眠唤醒或进程长时间阻塞后，基于墙钟的「静默多久」
 * 判定会把暂停期间的空洞当成卡死，唤醒瞬间批量误判。调用方在 tick 开始时比对
 * 上次 tick 时刻，命中即跳过本轮判定并把静默基准推到当前时刻。
 */

/** tick 间隔超过该值视为暂停过（休眠 / 阻塞 / 定时器冻结）。 */
export const TIMER_GAP_MS = 30_000;

export function timerGapDetected(
  lastTickAt: number,
  now = Date.now(),
  gapMs = TIMER_GAP_MS,
): boolean {
  if (!lastTickAt) return false;
  return now - lastTickAt > gapMs;
}
