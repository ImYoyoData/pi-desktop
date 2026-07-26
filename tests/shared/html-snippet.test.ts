import { describe, expect, it } from "vitest";
import { truncateHtmlSnippet } from "../../src/shared/html-snippet";

describe("truncateHtmlSnippet", () => {
  it("returns short html unchanged", () => {
    const html = "<div><p>hello</p></div>";
    expect(truncateHtmlSnippet(html)).toBe(html);
  });

  it("truncates html longer than max with suffix marker", () => {
    const html = `<div>${"x".repeat(5000)}</div>`;
    const result = truncateHtmlSnippet(html, 4000);
    expect(result.length).toBeLessThanOrEqual(4000);
    expect(result.endsWith("<!-- truncated -->")).toBe(true);
  });

  it("uses 4000 as default max", () => {
    const html = "a".repeat(5000);
    const result = truncateHtmlSnippet(html);
    expect(result.length).toBeLessThanOrEqual(4000);
  });
});
