/** 目录路径的所有祖先前缀。用于展开/新建后把目标目录露出来。 */
export function ancestorChain(dir: string): string[] {
  const parts = dir.split("/").filter(Boolean);
  const chain: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    chain.push(parts.slice(0, i).join("/"));
  }
  return chain;
}
