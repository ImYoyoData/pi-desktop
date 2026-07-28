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
      securityLevel: "strict",
      theme,
      fontFamily: "inherit",
      flowchart: { htmlLabels: false },
    });
    appliedTheme = theme;
  }
  return mermaid;
}

/**
 * Render every `[data-mermaid]` placeholder under `root`.
 * Safe to call repeatedly after `v-html` updates (placeholders are fresh each time).
 */
export async function mountMermaidIn(root: HTMLElement, isDark: boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-mermaid]"));
  if (!blocks.length) return;

  const seq = ++renderSeq;
  const mermaid = await ensureMermaid(isDark);
  if (seq !== renderSeq) return;

  let index = 0;
  for (const block of blocks) {
    if (seq !== renderSeq) return;
    if (!root.contains(block)) continue;
    if (block.getAttribute("data-mermaid-done") === "1") continue;

    const srcEl = block.querySelector(".md-mermaid-src");
    const source = (srcEl?.textContent ?? "").trim();
    if (!source) continue;

    try {
      const id = `pi-mmd-${Date.now().toString(36)}-${index++}`;
      const { svg, bindFunctions } = await mermaid.render(id, source);
      if (seq !== renderSeq || !root.contains(block)) return;
      block.innerHTML = svg;
      block.setAttribute("data-mermaid-done", "1");
      block.classList.remove("md-mermaid-error");
      const svgEl = block.querySelector("svg");
      if (svgEl && bindFunctions) bindFunctions(svgEl);
    } catch {
      if (!root.contains(block)) continue;
      block.classList.add("md-mermaid-error");
      // Keep source pre visible so incomplete streaming diagrams stay readable.
    }
  }
}
