import {
  mountDiagramChrome,
  type DiagramToolLabels,
} from "@renderer/utils/diagram-chrome";

let vizPromise: Promise<{
  renderString: (src: string, opts?: { format?: string }) => Promise<string>;
}> | null = null;
let renderSeq = 0;

async function loadViz() {
  if (!vizPromise) {
    vizPromise = (async () => {
      const { instance } = await import("@viz-js/viz");
      return instance();
    })();
  }
  return vizPromise;
}

/** Render ```dot / ```graphviz placeholders under root. */
export async function mountDotIn(
  root: HTMLElement,
  labels: DiagramToolLabels,
): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('[data-diagram="dot"]'),
  );
  if (!blocks.length) return;

  const seq = ++renderSeq;
  let viz: Awaited<ReturnType<typeof loadViz>>;
  try {
    viz = await loadViz();
  } catch {
    for (const block of blocks) block.classList.add("md-diagram-error");
    return;
  }
  if (seq !== renderSeq) return;

  for (const block of blocks) {
    if (seq !== renderSeq) return;
    if (!root.contains(block)) continue;
    if (block.classList.contains("md-diagram-ready")) continue;

    const srcEl = block.querySelector(".md-diagram-src");
    const source = (srcEl?.textContent ?? "").trim();
    if (!source) continue;

    try {
      const svg = await viz.renderString(source, { format: "svg" });
      if (seq !== renderSeq || !root.contains(block)) return;
      mountDiagramChrome(block, {
        svg,
        source,
        kind: "graphviz",
        labels,
      });
    } catch {
      if (!root.contains(block)) continue;
      block.classList.add("md-diagram-error");
    }
  }
}
