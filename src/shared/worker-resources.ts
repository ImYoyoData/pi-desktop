/** Snapshot of skills / extensions / tools loaded into an agent worker session. */
export type WorkerResourceSummary = {
  extensionCount: number;
  skillCount: number;
  agentsFileCount: number;
  extensionPaths: string[];
  skillNames: string[];
  agentsFilePaths: string[];
  activeTools: string[];
  diagnostics: string[];
};
