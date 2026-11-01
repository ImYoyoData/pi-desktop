export type RefreshWorkspaceTreeDeps<TChild, TGit> = {
  readIgnored(): Promise<string[]>;
  loadRoot(): Promise<TChild[]>;
  readGit(): Promise<TGit>;
  loadDirs(dirs: string[]): Promise<Map<string, TChild[]>>;
  applyIgnored(patterns: string[]): void;
  applyRoot(children: TChild[]): void;
  applyGit(git: TGit): void;
  applyDirs(batch: Map<string, TChild[]>): void;
};

export type RefreshWorkspaceTreeRun = {
  /** 根目录树：界面首屏只需要它。 */
  tree: Promise<void>;
  /** git 状态与已展开目录的子项：慢，但晚到不影响树已经可见。 */
  background: Promise<void>;
};

/**
 * 刷新工作区文件树。
 *
 * 只有根目录列表算首屏：git status 在仓库大时要等几秒，以前把它和列表绑在同一个
 * Promise.all 里，树就一直空白。这里先出树，git 徽标后补。
 */
export function refreshWorkspaceTree<TChild, TGit>(
  deps: RefreshWorkspaceTreeDeps<TChild, TGit>,
  expandedDirs: readonly string[],
): RefreshWorkspaceTreeRun {
  const tree = (async () => {
    deps.applyIgnored(await deps.readIgnored());
    deps.applyRoot(await deps.loadRoot());
  })();

  const background = tree
    .then(async () => {
      deps.applyGit(await deps.readGit());
      const batch = await deps.loadDirs([...expandedDirs]);
      if (batch.size) deps.applyDirs(batch);
    })
    .catch(() => undefined);

  return { tree, background };
}
