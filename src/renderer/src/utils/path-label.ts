/** Hide the middle of a long string: `abcdefg` → `ab…fg` within `max` chars. */
export function ellipsisMiddle(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  if (max === 2) return `${text.slice(0, 1)}…`;
  const keep = max - 1; // room for …
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/**
 * Display label for file chips. Prefers keeping the basename visible; otherwise
 * falls back to true middle ellipsis.
 */
export function fileTagLabel(path: string, max = 48): string {
  const p = path.replace(/\\/g, "/");
  if (p.length <= max) return p;
  const name = p.split("/").pop() || p;
  if (name.length >= max - 1) return ellipsisMiddle(name, max);
  // `prefix…/basename` — hide the middle directory segment(s).
  const suffix = `…/${name}`;
  const headLen = max - suffix.length;
  if (headLen <= 0) return ellipsisMiddle(p, max);
  let head = p.slice(0, headLen);
  const slash = head.lastIndexOf("/");
  if (slash >= 2) head = head.slice(0, slash);
  if (!head) return ellipsisMiddle(p, max);
  return `${head}${suffix}`;
}

/** Display label for URL chips — middle-ellipsis host+path. */
export function urlTagLabel(url: string, max = 40): string {
  try {
    const u = new URL(url);
    const hostPath = `${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    return ellipsisMiddle(hostPath, max);
  } catch {
    return ellipsisMiddle(url, max);
  }
}
