import { computed } from "vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

/** 可选工作区：最近工作区 + 当前工作区（去重），并处理重名标签。 */
export function useScopedWorkspaces() {
  const workspace = useWorkspaceStore();
  const paths = computed(() => {
    const list = [...workspace.recent];
    const root = workspace.root?.trim();
    if (root && !list.some((p) => p.toLowerCase() === root.toLowerCase())) {
      list.push(root);
    }
    return list;
  });
  function label(target: string): string {
    const base = baseName(target);
    const duplicated = paths.value.filter((p) => baseName(p) === base).length > 1;
    return duplicated ? target : base;
  }
  return { paths, label };
}
