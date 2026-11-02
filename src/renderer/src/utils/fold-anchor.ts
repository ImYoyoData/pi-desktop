/**
 * 折叠/展开的锚定补偿：把被点行钉在点击时的视口位置，展开体底部超出视口时
 * 再向下让位，最多让到该行贴住视口顶部 —— 放得下就完全不滚，放不下也不整屏跳到末尾。
 */

export type FoldAnchorMetrics = {
  /** 点击瞬间被点行的视口顶部 */
  anchorTop: number;
  /** 本次重排后被点行的视口顶部 */
  headTop: number;
  /** 被点行所在消息行的视口底部（含展开体） */
  blockBottom: number;
  /** 滚动容器可视区的顶部与底部 */
  viewTop: number;
  viewBottom: number;
};

/** 需要写回 scrollTop 的位移，0 表示视口不动。 */
export function foldAnchorScrollDelta(metrics: FoldAnchorMetrics): number {
  const pin =
    Math.abs(metrics.headTop - metrics.anchorTop) >= 1
      ? metrics.headTop - metrics.anchorTop
      : 0;
  const headTop = metrics.headTop - pin;
  const overflow = metrics.blockBottom - pin - metrics.viewBottom;
  if (overflow < 1) return pin;
  return pin + Math.min(overflow, Math.max(0, headTop - metrics.viewTop));
}
