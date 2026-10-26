/**
 * 消息区滚轮归属：落在内部纵向滚动容器（代码块、图表预览、思考块）且该容器还能
 * 朝该方向滚时，滚轮属于它，不能当成「用户在翻历史」。
 *
 * markdown 里的 `.code-body` / `.md-diagram-viewport` 曾经漏了标记，于是在预览里滚
 * 一下就翻掉跟随状态，消息区又被贴底拉回，两套滚动互相打架。
 */

export type InnerScrollMetrics = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
};

export function innerScrollCanSwallow(
  metrics: InnerScrollMetrics,
  deltaY: number,
): boolean {
  if (deltaY === 0) return false;
  if (metrics.scrollHeight - metrics.clientHeight <= 1) return false;
  return deltaY < 0
    ? metrics.scrollTop > 0
    : metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight > 1;
}
