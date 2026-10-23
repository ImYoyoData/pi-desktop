import { useMemo } from "react";
import { useWorkspaceStore } from "@renderer/stores/workspace";

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

/** 可选工作区：最近工作区 + 当前工作区（去重），并处理重名标签。 */
export function useScopedWorkspaces() {
  const workspace = useWorkspaceStore();
  const recent = workspace.recent;
  const root = workspace.root;
  const paths = useMemo(() => {
    const list = [...recent];
    const current = root?.trim();
    if (current && !list.some((p) => p.toLowerCase() === current.toLowerCase())) {
      list.push(current);
    }
    return list;
  }, [recent, root]);
  function label(target: string): string {
    const base = baseName(target);
    const duplicated = paths.filter((p) => baseName(p) === base).length > 1;
    return duplicated ? target : base;
  }
  return { paths, label };
}
