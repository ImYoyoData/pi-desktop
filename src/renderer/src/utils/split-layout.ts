export type SplitLayoutInput = {
  leftSize: number;
  centerSize: number;
  rightSize: number;
  bottomSize: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  editorMaximized: boolean;
};

export type SplitPaneSizes = {
  outerLeft: number;
  outerMain: number;
  chat: number;
  rightPane: number;
  chatTop: number;
  bottomPanel: number;
  leftHidden: boolean;
  chatVisible: boolean;
};

/** 聊天列与右栏的缺省比例：两边尺寸都丢失时用它兜底。 */
const FALLBACK_CHAT_SHARE = 37.5;

/**
 * 三组分栏的百分比。
 *
 * 右侧栏折叠或编辑器区最大化时，聊天列与右栏要让位（0 / 100），
 * 否则按中心列与右栏的相对比例重新分配。
 */
export function splitPaneSizes(layout: SplitLayoutInput): SplitPaneSizes {
  const leftHidden = layout.leftCollapsed;
  const sum = layout.centerSize + layout.rightSize;
  const chatShare = sum > 0 ? (layout.centerSize / sum) * 100 : FALLBACK_CHAT_SHARE;

  const chat = layout.editorMaximized ? 0 : layout.rightCollapsed ? 100 : chatShare;
  const rightPane = 100 - chat;

  const chatTop = layout.editorMaximized
    ? layout.bottomCollapsed
      ? 100
      : 0
    : layout.bottomCollapsed
      ? 100
      : 100 - layout.bottomSize;
  const bottomPanel = layout.editorMaximized
    ? layout.bottomCollapsed
      ? 0
      : 100
    : layout.bottomCollapsed
      ? 0
      : layout.bottomSize;

  return {
    outerLeft: leftHidden ? 0 : layout.leftSize,
    outerMain: leftHidden ? 100 : 100 - layout.leftSize,
    chat,
    rightPane,
    chatTop,
    bottomPanel,
    leftHidden,
    chatVisible: !layout.editorMaximized,
  };
}
