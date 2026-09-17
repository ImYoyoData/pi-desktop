import { describe, expect, it } from "vitest";
import { countLineDiff } from "../../src/shared/line-diff";

describe("countLineDiff", () => {
	it("returns zero counts for identical content", () => {
		expect(countLineDiff("a\nb\nc", "a\nb\nc")).toEqual({
			additions: 0,
			deletions: 0,
		});
	});

	it("counts pure insertions", () => {
		expect(countLineDiff("a\nc", "a\nb\nc")).toEqual({
			additions: 1,
			deletions: 0,
		});
		expect(countLineDiff("", "x\ny")).toEqual({ additions: 2, deletions: 0 });
	});

	it("counts pure deletions", () => {
		expect(countLineDiff("a\nb\nc", "a\nc")).toEqual({
			additions: 0,
			deletions: 1,
		});
		expect(countLineDiff("x\ny", "")).toEqual({ additions: 0, deletions: 2 });
	});

	it("counts a replaced line as one add and one delete", () => {
		expect(countLineDiff("a\nb\nc", "a\nX\nc")).toEqual({
			additions: 1,
			deletions: 1,
		});
	});

	it("collapses consecutive edits that later revert (net semantics)", () => {
		// Session flow: +line b, then remove it again → actual net is zero.
		const afterInsert = "a\nb\nc";
		expect(countLineDiff("a\nc", afterInsert)).toEqual({
			additions: 1,
			deletions: 0,
		});
		expect(countLineDiff("a\nc", "a\nc")).toEqual({
			additions: 0,
			deletions: 0,
		});
	});

	it("normalizes CRLF line endings", () => {
		expect(countLineDiff("a\r\nb\r\nc", "a\nb\nc")).toEqual({
			additions: 0,
			deletions: 0,
		});
		expect(countLineDiff("a\r\nc", "a\nb\nc")).toEqual({
			additions: 1,
			deletions: 0,
		});
	});

	it("does not count a trailing newline as a line", () => {
		expect(countLineDiff("a\n", "a")).toEqual({ additions: 0, deletions: 0 });
	});

	it("treats a big interior rewrite as a full replacement", () => {
		const before: string[] = [];
		const after: string[] = [];
		for (let i = 0; i < 3000; i += 1) before.push(`old-${i}`);
		for (let i = 0; i < 3000; i += 1) after.push(`new-${i}`);
		const counts = countLineDiff(before.join("\n"), after.join("\n"));
		expect(counts).toEqual({ additions: 3000, deletions: 3000 });
	});

	it("handles empty / single-line edge cases", () => {
		expect(countLineDiff("", "")).toEqual({ additions: 0, deletions: 0 });
		expect(countLineDiff("only", "only")).toEqual({
			additions: 0,
			deletions: 0,
		});
		expect(countLineDiff("only", "changed")).toEqual({
			additions: 1,
			deletions: 1,
		});
	});
});
