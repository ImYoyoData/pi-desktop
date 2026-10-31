/**
 * MessageList 的贴底跟随状态机 —— 决策只由“用户意图”驱动，滚动事件不参与。
 *
 * 为什么不看滚动事件：虚拟列表的滚动锚定补偿同样会派发 scroll 事件
 * （挂载新行后把 scrollTop 往下推回去，保证内容视觉位置不变），
 * 这类事件与“用户向下滚动”无法区分。一旦滚动事件能重新贴底，
 * 用户刚往上滚就被吸回底部，且没有任何办法挣脱。
 *
 * 因此：离开实时边缘、回到实时边缘，都只认显式意图
 * （滚轮、键盘、触摸、拖动滚动条）；scroll 事件不参与任何状态判断，
 * 贴底也只在内容/尺寸变化后写一次。
 */

export type FollowIntent = "up" | "down";

export type FollowDecision = {
  following: boolean;
  /** 状态是否真的翻转了 —— 调用方据此决定要不要更新界面。 */
  engaged: boolean;
};

export function decideFollowOnIntent(input: {
  intent: FollowIntent;
  nearBottom: boolean;
  following: boolean;
}): FollowDecision {
  if (input.intent === "up") {
    // 向上永远是“回看历史”的意图 —— 立刻离开实时边缘
    return { following: false, engaged: input.following };
  }
  // 向下只有进入底部区域才算“回到实时边缘”；否则用户只是继续在历史里翻
  if (!input.nearBottom) {
    return { following: input.following, engaged: false };
  }
  return { following: true, engaged: !input.following };
}
