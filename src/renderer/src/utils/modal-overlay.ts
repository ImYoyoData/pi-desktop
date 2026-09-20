/** 模态容器节点会常驻 DOM（LazyTeleport），遮罩出现才代表弹窗真的打开。 */
export function hasOpenModal(): boolean {
  return document.querySelector(".n-modal-mask") !== null;
}
