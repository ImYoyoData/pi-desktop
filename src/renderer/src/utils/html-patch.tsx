import { useEffect, useRef, type ReactNode } from "react";

const appliedHtml = new WeakMap<HTMLElement, string>();

/** 图表占位符身份：类型 + 源码。 */
function diagramKey(node: Node): string | null {
  if (!(node instanceof HTMLElement)) return null;
  if (!node.hasAttribute("data-diagram")) return null;
  const src = node.querySelector(".md-diagram-src, .md-mermaid-src")?.textContent ?? "";
  return `${node.getAttribute("data-diagram") ?? ""}\u0000${src.trim()}`;
}

function isRenderedDiagram(node: Node): boolean {
  return node instanceof HTMLElement && node.classList.contains("md-diagram-ready");
}

/** 只有已渲染完成的图表才按身份保留；未完成/失败的块仍重建，保留原有的重试机会。 */
function sameNode(prev: Node, next: Node): boolean {
  if (prev.isEqualNode(next)) return true;
  if (!isRenderedDiagram(prev)) return false;
  const key = diagramKey(prev);
  return key !== null && key === diagramKey(next);
}

export function patchHtmlInto(el: HTMLElement, html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const next = Array.from(parsed.body.childNodes);
  const prev = Array.from(el.childNodes);
  let head = 0;
  while (head < prev.length && head < next.length) {
    const prevNode = prev[head];
    const nextNode = next[head];
    if (!prevNode || !nextNode || !sameNode(prevNode, nextNode)) break;
    head++;
  }
  for (let i = prev.length - 1; i >= head; i--) prev[i]?.remove();
  if (head >= next.length) return;
  const fragment = document.createDocumentFragment();
  for (let i = head; i < next.length; i++) {
    const node = next[i];
    if (node) fragment.append(node);
  }
  el.append(fragment);
}

export function renderHtmlBlock(el: HTMLElement, html: string): void {
  if (appliedHtml.get(el) === html) return;
  appliedHtml.set(el, html);
  patchHtmlInto(el, html);
}

export type MarkdownHtmlProps = {
  html: string;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
};

/** 与 v-html 等价，但复用未变化的子节点，避免整块 DOM 重建与重排。 */
export function MarkdownHtml({
  html,
  className,
  style,
  children,
}: MarkdownHtmlProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) renderHtmlBlock(ref.current, html);
  }, [html]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
