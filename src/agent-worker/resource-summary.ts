import type { WorkerResourceSummary } from "../shared/worker-resources";

export type { WorkerResourceSummary } from "../shared/worker-resources";

type ServicesLike = {
  diagnostics: Array<{ type: string; message: string }>;
  resourceLoader: {
    getSkills: () => {
      skills: Array<{ name: string }>;
      diagnostics: Array<{ message?: string } | string>;
    };
    getAgentsFiles: () => {
      agentsFiles: Array<{ path: string }>;
    };
  };
};

type ExtensionsResultLike = {
  extensions: Array<{ path: string }>;
  errors: Array<{ path: string; error: string }>;
};

/**
 * Snapshot skills / extensions / tools after session bind so we can verify
 * Desktop loads the same package resources the user installed via `pi`.
 */
export function summarizeSessionResources(
  services: ServicesLike,
  extensionsResult: ExtensionsResultLike,
  activeTools: string[],
): WorkerResourceSummary {
  const skills = services.resourceLoader.getSkills();
  const agentsFiles = services.resourceLoader.getAgentsFiles().agentsFiles;
  const diagnostics: string[] = [];

  for (const d of services.diagnostics) {
    diagnostics.push(`[${d.type}] ${d.message}`);
  }
  for (const err of extensionsResult.errors) {
    const where = err.path || "extension";
    diagnostics.push(`[extension] ${where}: ${err.error}`);
  }
  for (const d of skills.diagnostics) {
    const message = typeof d === "string" ? d : (d.message ?? String(d));
    diagnostics.push(`[skill] ${message}`);
  }

  const extensionPaths = extensionsResult.extensions.map((ext) => ext.path);
  const agentsFilePaths = agentsFiles.map((f) => f.path);

  return {
    extensionCount: extensionsResult.extensions.length,
    skillCount: skills.skills.length,
    agentsFileCount: agentsFilePaths.length,
    extensionPaths,
    skillNames: skills.skills.map((s) => s.name),
    agentsFilePaths,
    activeTools: [...activeTools],
    diagnostics,
  };
}

export function logResourceSummary(summary: WorkerResourceSummary): void {
  const toolsPreview = summary.activeTools.slice(0, 24).join(", ");
  console.info(
    `[pi-desktop] resources: ${summary.extensionCount} extension(s), ${summary.skillCount} skill(s), ${summary.agentsFileCount} agents file(s), ${summary.activeTools.length} active tool(s)`,
  );
  if (summary.extensionPaths.length) {
    console.info(`[pi-desktop] extensions: ${summary.extensionPaths.join(" | ")}`);
  }
  if (summary.skillNames.length) {
    console.info(`[pi-desktop] skills: ${summary.skillNames.join(", ")}`);
  }
  if (summary.agentsFilePaths.length) {
    console.info(`[pi-desktop] agents files: ${summary.agentsFilePaths.join(" | ")}`);
  }
  if (toolsPreview) {
    console.info(
      `[pi-desktop] tools: ${toolsPreview}${summary.activeTools.length > 24 ? "…" : ""}`,
    );
  }
  for (const line of summary.diagnostics) {
    console.warn(`[pi-desktop] resource diagnostic: ${line}`);
  }
}
