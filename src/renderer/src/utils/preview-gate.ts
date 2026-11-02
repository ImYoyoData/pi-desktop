type PreviewContentGateInput = {
  active: boolean;
  dirty: boolean;
  missing: boolean;
};

/**
 * 内容区是否该挂载。
 *
 * 折叠或切到别的页面时，预览标签仍在 0 尺寸容器里：先渲染一遍编辑器/Markdown，
 * 展开时又要按 contentEpoch 整块重建，大文件等于把最贵的那次渲染做两遍。
 * 有未保存改动或文件已删除的标签必须继续挂着，否则草稿与提示会丢。
 */
export function previewWantsContent({
  active,
  dirty,
  missing,
}: PreviewContentGateInput): boolean {
  return active || dirty || missing;
}
