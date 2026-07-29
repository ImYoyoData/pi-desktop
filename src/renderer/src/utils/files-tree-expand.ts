/** Ancestor chain for accordion focus (exclusive of workspace root ""). */
export function ancestorChain(dir: string): string[] {
  const parts = dir.split("/").filter(Boolean);
  const chain: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    chain.push(parts.slice(0, i).join("/"));
  }
  return chain;
}

/**
 * Accordion expand/collapse: keep at most one subdirectory branch.
 */
export function nextExpandedKeys(prev: string[], nextFromTree: string[]): string[] {
  const added = nextFromTree.filter((k) => !prev.includes(k));
  if (added.length === 0) return nextFromTree;
  return ancestorChain(added[added.length - 1]!);
}
