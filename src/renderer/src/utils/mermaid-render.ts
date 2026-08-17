import {
  mountDiagramChrome,
  type DiagramToolLabels,
} from "@renderer/utils/diagram-chrome";
import type { MermaidConfig } from "mermaid";

type MermaidApi = {
  initialize: (config: MermaidConfig) => void;
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let appliedTheme: "dark" | "default" | null = null;
let renderSeq = 0;

/** Mermaid accepts `<br>` / `<br/>` in node text when htmlLabels are on. */
function normalizeMermaidSource(source: string): string {
  return source.replace(/<br\s*\/?>/gi, "<br/>").trim();
}

function detectMermaidKind(source: string): string {
  const head = source.trimStart().slice(0, 48).toLowerCase();
  if (head.startsWith("flowchart") || head.startsWith("graph ")) return "flowchart";
  if (head.startsWith("sequencediagram")) return "sequence";
  if (head.startsWith("classdiagram")) return "class";
  if (head.startsWith("statediagram")) return "state";
  if (head.startsWith("erdiagram")) return "er";
  if (head.startsWith("gantt")) return "gantt";
  if (head.startsWith("pie")) return "pie";
  if (head.startsWith("mindmap")) return "mindmap";
  if (head.startsWith("timeline")) return "timeline";
  if (head.startsWith("gitgraph")) return "git";
  return "mermaid";
}

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default as unknown as MermaidApi);
  }
  return mermaidPromise;
}

async function ensureMermaid(isDark: boolean): Promise<MermaidApi> {
  const mermaid = await loadMermaid();
  const theme = isDark ? "dark" : "default";
  if (appliedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // loose: allow <br/> / HTML labels in flowchart nodes (common in Chinese docs)
      securityLevel: "loose",
      theme,
      fontFamily:
        'ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      flowchart: {
        htmlLabels: true,
        useMaxWidth: true,
        curve: "basis",
        padding: 12,
      },
      themeVariables: {
        fontSize: "14px",
      },
    });
    appliedTheme = theme;
  }
  return mermaid;
}

/**
 * Drop rendered mermaid chrome so the next mountMermaidIn pass re-draws
 * with the current theme (without re-parsing markdown HTML).
 */
export function resetMermaidForTheme(root: HTMLElement): void {
  appliedTheme = null;
  for (const block of root.querySelectorAll<HTMLElement>("[data-mermaid]")) {
    const srcEl = block.querySelector(".md-diagram-src, .md-mermaid-src");
    const source = (srcEl?.textContent ?? "").trim();
    if (!source) continue;
    block.classList.remove("md-diagram-ready", "md-diagram-error");
    block.removeAttribute("data-mermaid-done");
    const pre = document.createElement("pre");
    pre.className = "md-diagram-src";
    pre.textContent = source;
    block.replaceChildren(pre);
  }
}

/**
 * Render every `[data-mermaid]` placeholder under `root`.
 * Safe to call repeatedly after `v-html` updates (placeholders are fresh each time).
 */
export async function mountMermaidIn(
  root: HTMLElement,
  isDark: boolean,
  labels: DiagramToolLabels,
): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-mermaid]"));
  if (!blocks.length) return;

  const seq = ++renderSeq;
  const mermaid = await ensureMermaid(isDark);
  if (seq !== renderSeq) return;

  let index = 0;
  for (const block of blocks) {
    if (seq !== renderSeq) return;
    if (!root.contains(block)) continue;
    if (block.classList.contains("md-diagram-ready")) continue;

    const srcEl = block.querySelector(".md-diagram-src, .md-mermaid-src");
    const source = (srcEl?.textContent ?? "").trim();
    if (!source) continue;

    try {
      const id = `pi-mmd-${Date.now().toString(36)}-${index++}`;
      const { svg, bindFunctions } = await mermaid.render(id, normalizeMermaidSource(source));
      if (seq !== renderSeq || !root.contains(block)) return;
      mountDiagramChrome(block, {
        svg,
        source,
        kind: detectMermaidKind(source),
        labels,
        bindFunctions,
      });
      block.setAttribute("data-mermaid-done", "1");
    } catch (err) {
      if (!root.contains(block)) continue;
      block.classList.add("md-diagram-error");
      // Keep source visible so incomplete streaming diagrams stay readable.
      const detail = err instanceof Error ? err.message : String(err);
      if (detail && !block.querySelector(".md-diagram-error-msg")) {
        const tip = document.createElement("div");
        tip.className = "md-diagram-error-msg";
        tip.textContent = detail.slice(0, 280);
        block.appendChild(tip);
      }
    }
  }
}
