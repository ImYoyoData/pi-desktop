/** 模态容器节点会常驻 DOM，遮罩出现才代表弹窗真的打开。 */
export function hasOpenModal(): boolean {
  return (
    document.querySelector(".ant-modal-mask") !== null ||
    document.querySelector(".ant-drawer-mask") !== null
  );
}
