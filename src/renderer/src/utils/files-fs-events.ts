export type WorkspaceFsEventKind = "add" | "change" | "unlink";

export type WorkspaceFsEvent = {
  path: string;
  kind: WorkspaceFsEventKind;
};

export type FsRefreshPlan = {
  /** 需要收起的目录（自己或子目录被删）。 */
  collapseDirs: string[];
  /** 需要重新读盘的可见目录，根目录为空串。 */
  reloadDirs: string[];
};

export function parentDirOf(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? "" : normalized.slice(0, idx);
}

/**
 * 把一批文件变更折算成一次刷新的目标。
 *
 * 只有可见目录才需要重新读盘：不可见的分支展开时会自己读。
 * change 事件不改变目录内容，内容刷新由各自的标签页负责。
 */
export function collectFsRefreshPlan(
  events: readonly WorkspaceFsEvent[],
  expandedKeys: readonly string[],
): FsRefreshPlan {
  const expanded = new Set(expandedKeys);
  const collapse = new Set<string>();
  const reload = new Set<string>();

  for (const event of events) {
    const rel = event.path.replace(/\\/g, "/");
    if (event.kind === "unlink" && expanded.has(rel)) collapse.add(rel);
    if (event.kind === "change") continue;
    const parent = parentDirOf(rel);
    if (parent === "" || expanded.has(parent)) reload.add(parent);
  }

  return { collapseDirs: [...collapse], reloadDirs: [...reload] };
}

export type GitRefreshCoalescer = {
  /** 合并窗口内的多次请求为一次刷新。 */
  schedule(): void;
  cancel(): void;
  readonly pending: boolean;
};

/** 连续的文件变更会把 git status 请求排成一长串，合并成一次即可。 */
export function createGitRefreshCoalescer(options: {
  delayMs: number;
  run: () => void;
}): GitRefreshCoalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    timer = null;
    options.run();
  }

  return {
    schedule(): void {
      if (timer !== null) return;
      timer = setTimeout(flush, options.delayMs);
    },
    cancel(): void {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
    get pending(): boolean {
      return timer !== null;
    },
  };
}
