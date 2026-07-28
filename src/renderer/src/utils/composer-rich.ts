/**
 * Pure helpers for the composer contenteditable rich surface.
 * Chip labels live in DOM spans (`data-chip-id`); draft text is text nodes only.
 */

const CHIP_SPAN_RE = /<span[^>]*data-chip-id="[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
const CHIP_ID_RE = /data-chip-id="([^"]*)"/gi;

export function extractDraftFromRichHtml(html: string): string {
  return html
    .replace(CHIP_SPAN_RE, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<div[^>]*>/gi, "\n")
    .replace(/<\/div>/gi, "")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\u200B/g, "");
}

export function chipIdsFromRichHtml(html: string): string[] {
  const ids: string[] = [];
  CHIP_ID_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHIP_ID_RE.exec(html)) !== null) {
    if (match[1]) ids.push(match[1]);
  }
  return ids;
}

/**
 * Walk a contenteditable root: text nodes → draft, chip spans → chipOrder (skipped as labels).
 * Falls back to HTML string helpers when `querySelectorAll` is the only API (tests).
 */
export function serializeRichEditor(root: HTMLElement): { draft: string; chipOrder: string[] } {
  if (typeof root.querySelectorAll === "function" && typeof (root as Node).childNodes === "undefined") {
    const chipOrder: string[] = [];
    const nodes = root.querySelectorAll("[data-chip-id]");
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i]?.getAttribute("data-chip-id");
      if (id) chipOrder.push(id);
    }
    return {
      draft: extractDraftFromRichHtml(root.innerHTML),
      chipOrder,
    };
  }

  const chipOrder: string[] = [];
  let draft = "";

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      draft += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const chipId = el.getAttribute?.("data-chip-id") ?? el.dataset?.chipId;
    if (chipId) {
      chipOrder.push(chipId);
      draft += " ";
      return;
    }
    if (el.tagName === "BR") {
      draft += "\n";
      return;
    }
    const children = el.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child) walk(child);
    }
    if (el !== root && (el.tagName === "DIV" || el.tagName === "P")) {
      draft += "\n";
    }
  };

  const children = root.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child) walk(child);
  }

  return {
    draft: draft.replace(/\u200B/g, "").replace(/\u00A0/g, " "),
    chipOrder,
  };
}
