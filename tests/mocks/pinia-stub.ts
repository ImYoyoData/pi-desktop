export function defineStore(_id: string, setup: () => unknown): () => unknown {
  return setup as () => unknown;
}
