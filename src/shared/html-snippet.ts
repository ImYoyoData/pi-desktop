const TRUNCATED_SUFFIX = "<!-- truncated -->";

export function truncateHtmlSnippet(html: string, max = 4000): string {
  if (html.length <= max) {
    return html;
  }
  const keep = Math.max(0, max - TRUNCATED_SUFFIX.length);
  return html.slice(0, keep) + TRUNCATED_SUFFIX;
}
