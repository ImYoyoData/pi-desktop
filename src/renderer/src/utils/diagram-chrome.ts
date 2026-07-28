export type DiagramToolLabels = {
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  expand: string;
  copySource: string;
  downloadSvg: string;
};

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;

export function clampDiagramZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function readDiagramZoom(block: HTMLElement): number {
  const raw = Number(block.dataset.zoom || "1");
  return clampDiagramZoom(Number.isFinite(raw) ? raw : 1);
}

export function applyDiagramZoom(block: HTMLElement, zoom: number): void {
  const next = clampDiagramZoom(zoom);
  block.dataset.zoom = String(next);
  const canvas = block.querySelector<HTMLElement>(".md-diagram-canvas");
  if (canvas) {
    canvas.style.transform = `scale(${next})`;
  }
  const label = block.querySelector<HTMLElement>("[data-diagram-zoom-label]");
  if (label) {
    label.textContent = `${Math.round(next * 100)}%`;
  }
}

function toolButton(action: string, title: string, text: string): string {
  return `<button type="button" class="md-diagram-btn" data-diagram-action="${action}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">${text}</button>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Build toolbar + zoomable SVG viewport; keep source for copy/download. */
export function mountDiagramChrome(
  block: HTMLElement,
  opts: {
    svg: string;
    source: string;
    kind: string;
    labels: DiagramToolLabels;
    bindFunctions?: (element: Element) => void;
  },
): void {
  const { svg, source, kind, labels, bindFunctions } = opts;
  const toolbar = document.createElement("div");
  toolbar.className = "md-diagram-toolbar";
  toolbar.innerHTML = [
    `<span class="md-diagram-kind">${escapeAttr(kind)}</span>`,
    `<span class="md-diagram-spacer"></span>`,
    toolButton("zoom-out", labels.zoomOut, "−"),
    `<span class="md-diagram-zoom" data-diagram-zoom-label>100%</span>`,
    toolButton("zoom-in", labels.zoomIn, "+"),
    toolButton("zoom-reset", labels.zoomReset, "1:1"),
    toolButton("expand", labels.expand, "⛶"),
    toolButton("copy", labels.copySource, "⎘"),
    toolButton("download", labels.downloadSvg, "↓"),
  ].join("");

  const viewport = document.createElement("div");
  viewport.className = "md-diagram-viewport";
  const canvas = document.createElement("div");
  canvas.className = "md-diagram-canvas";
  canvas.innerHTML = svg;
  viewport.appendChild(canvas);

  const src = document.createElement("pre");
  src.className = "md-diagram-src";
  src.hidden = true;
  src.textContent = source;

  block.replaceChildren(toolbar, viewport, src);
  block.classList.add("md-diagram-ready");
  block.classList.remove("md-diagram-error");
  block.dataset.zoom = "1";
  applyDiagramZoom(block, 1);

  const svgEl = canvas.querySelector("svg");
  if (svgEl && bindFunctions) bindFunctions(svgEl);
}

export function getDiagramSource(block: HTMLElement): string {
  return block.querySelector(".md-diagram-src")?.textContent ?? "";
}

export function getDiagramSvgMarkup(block: HTMLElement): string {
  return block.querySelector(".md-diagram-canvas")?.innerHTML ?? "";
}

export function handleDiagramToolClick(
  block: HTMLElement,
  action: string,
): "expand" | "copied" | "downloaded" | "zoom" | null {
  switch (action) {
    case "zoom-in":
      applyDiagramZoom(block, readDiagramZoom(block) * ZOOM_STEP);
      return "zoom";
    case "zoom-out":
      applyDiagramZoom(block, readDiagramZoom(block) / ZOOM_STEP);
      return "zoom";
    case "zoom-reset":
      applyDiagramZoom(block, 1);
      return "zoom";
    case "copy": {
      const source = getDiagramSource(block);
      if (source) void navigator.clipboard.writeText(source);
      return "copied";
    }
    case "download": {
      const markup = getDiagramSvgMarkup(block);
      if (!markup) return null;
      const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `diagram-${Date.now()}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      return "downloaded";
    }
    case "expand":
      return "expand";
    default:
      return null;
  }
}
