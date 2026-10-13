/**
 * MessageList 虚拟窗口的纯决策 —— 滚动/防振荡边缘情况可脱离 Vue 单测。
 *
 * 此前同等逻辑内联在组件里且无可用测试：向上/向下扩展会互相把对方推回
 * 阈值内，形成每帧交替重建 DOM 的自激振荡；裁剪线判据用错估算又会触发
 * "滚到中段必卡"。这里把两类判据抽成纯函数，测量与 DOM 写入仍留在组件。
 */

export type VirtualWindow = { start: number; end: number };
export type WindowAdjustDir = "up" | "down";

/** 反向调整的最小间隔：两侧裁剪互相触发时必须隔一帧以上。 */
export const WINDOW_REVERSE_COOLDOWN_MS = 120;
/** 统计反向次数的滑动窗口。 */
export const WINDOW_REVERSE_WINDOW_MS = 1_000;
/** 窗口内反向超过该次数即判定为振荡。 */
export const WINDOW_REVERSE_MAX = 4;
/** 判定振荡后的加长冷却。 */
export const AUTO_COVER_SUPPRESS_MS = 400;

export type WindowAdjustGate = {
  /** 最近一次调整方向；null 表示还没调整过。 */
  lastDir: WindowAdjustDir | null;
  /** 最近一次调整时刻。 */
  lastAt: number;
  /** 当前滑动窗口内的反向次数。 */
  reverseCount: number;
  /** 反向计数的窗口起点。 */
  windowStart: number;
  /** 振荡判定后的冷却截止时刻。 */
  suppressedUntil: number;
};

export function createWindowAdjustGate(now: number): WindowAdjustGate {
  return {
    lastDir: null,
    lastAt: 0,
    reverseCount: 0,
    windowStart: now,
    suppressedUntil: 0,
  };
}

/**
 * 是否允许本次调整。首次调整与同向连续扩展不受限；反向调整必须已过冷却，
 * 冷却期处于加长模式。调用方必须在 DOM 变更前询问。
 */
export function allowWindowAdjust(
  gate: WindowAdjustGate,
  dir: WindowAdjustDir,
  now: number,
): boolean {
  if (gate.lastDir === null || gate.lastDir === dir) return true;
  const cooldown =
    now < gate.suppressedUntil ? AUTO_COVER_SUPPRESS_MS : WINDOW_REVERSE_COOLDOWN_MS;
  return now - gate.lastAt >= cooldown;
}

/** 记录一次调整并返回新闸门状态；反向次数超限时进入加长冷却。 */
export function noteWindowAdjust(
  gate: WindowAdjustGate,
  dir: WindowAdjustDir,
  now: number,
): WindowAdjustGate {
  const next = { ...gate, lastDir: dir, lastAt: now };
  if (now - gate.windowStart > WINDOW_REVERSE_WINDOW_MS) {
    next.reverseCount = 0;
    next.windowStart = now;
  }
  if (gate.lastDir !== null && gate.lastDir !== dir) {
    next.reverseCount += 1;
  }
  if (next.reverseCount > WINDOW_REVERSE_MAX) {
    next.reverseCount = 0;
    next.suppressedUntil = now + AUTO_COVER_SUPPRESS_MS;
  }
  return next;
}

/**
 * 裁剪线判据的输入。`margin` 仅估算分支使用：估算高度偏低会让裁剪线算得
 * 离视口更近，余量必须额外含被裁区间自身的估算高度。
 */
export type TrimLineProbe = {
  dir: WindowAdjustDir;
  /** 裁剪线位置，相对滚动内容坐标系。 */
  trimLineTop: number;
  viewportTop: number;
  viewportBottom: number;
  overscanPx: number;
  margin?: number;
};

/**
 * 裁剪线是否安全地位于视口之外。
 *
 * 向上扩展裁尾部要求裁剪线在视口下方，向下扩展裁头部要求在视口上方；
 * 两侧都需留出 overscan，否则裁完 spacer 立刻顶进视口（露出空白），
 * 或被下一次扩展原样挂回来（上下交替重建 DOM）。
 */
export function trimLineIsSafe(probe: TrimLineProbe): boolean {
  const margin = probe.margin ?? 0;
  if (probe.dir === "up") {
    return probe.trimLineTop > probe.viewportBottom + probe.overscanPx + margin;
  }
  return probe.trimLineTop < probe.viewportTop - probe.overscanPx - margin;
}