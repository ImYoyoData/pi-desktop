import { describe, expect, it } from "vitest";
import {
	expandCommandText,
	parseCommandArgs,
	parseSlashInvocation,
	renderCommandTemplate,
} from "../../src/shared/slash-command-template";

describe("parseCommandArgs", () => {
	it("splits whitespace and keeps quoted values together", () => {
		expect(parseCommandArgs("a b")).toEqual(["a", "b"]);
		expect(parseCommandArgs(`"API compatibility" fix`)).toEqual([
			"API compatibility",
			"fix",
		]);
		expect(parseCommandArgs("'one two' three")).toEqual(["one two", "three"]);
		expect(parseCommandArgs("")).toEqual([]);
	});
});

describe("parseSlashInvocation", () => {
	it("splits the first token from its arguments", () => {
		expect(parseSlashInvocation("/review src")).toEqual({
			name: "review",
			args: "src",
		});
		expect(parseSlashInvocation("/frontend:review")).toEqual({
			name: "frontend:review",
			args: "",
		});
		expect(parseSlashInvocation("/review\nbody")).toEqual({
			name: "review",
			args: "",
		});
		expect(parseSlashInvocation("review src")).toBeNull();
	});
});

describe("renderCommandTemplate", () => {
	it("substitutes positional and all arguments", () => {
		expect(renderCommandTemplate("Focus: $1. All: $@", "a b")).toBe(
			"Focus: a. All: a b",
		);
		expect(renderCommandTemplate("Args: $ARGUMENTS", "a b")).toBe("Args: a b");
		expect(renderCommandTemplate("$@[2] / $@[1:2]", "a b c")).toBe("b c / a b");
	});

	it("supports default and slice syntax", () => {
		expect(renderCommandTemplate("${1:-fallback}", "")).toBe("fallback");
		expect(renderCommandTemplate("${1:-fallback}", "given")).toBe("given");
		expect(renderCommandTemplate("${@:-none}", "")).toBe("none");
		expect(renderCommandTemplate("${@:2}", "a b c")).toBe("b c");
		expect(renderCommandTemplate("${@:2:1}", "a b c")).toBe("b");
	});

	it("appends arguments only when the template has no placeholder", () => {
		expect(renderCommandTemplate("Review the diff.", "src/app.ts")).toBe(
			"Review the diff.\n\nsrc/app.ts",
		);
		expect(renderCommandTemplate("Review $1.", "src/app.ts")).toBe(
			"Review src/app.ts.",
		);
	});
});

describe("expandCommandText", () => {
	const commands = [
		{ name: "review", content: "Review $ARGUMENTS carefully." },
		{ name: "frontend:lint", content: "Lint the frontend." },
	];

	it("expands a matching file command", () => {
		expect(expandCommandText("/review src/a.ts", commands)).toBe(
			"Review src/a.ts carefully.",
		);
		expect(expandCommandText("/frontend:lint", commands)).toBe(
			"Lint the frontend.",
		);
	});

	it("keeps unmatched text and skill commands intact", () => {
		expect(expandCommandText("/unknown src", commands)).toBe("/unknown src");
		expect(expandCommandText("/skill:review src", commands)).toBe(
			"/skill:review src",
		);
	});

	it("keeps trailing body lines after the expanded command", () => {
		expect(expandCommandText("/review src\nExtra context", commands)).toBe(
			"Review src carefully.\n\nExtra context",
		);
	});

	it("expands a command typed on the last line after body text", () => {
		expect(expandCommandText("Extra context\n/review src", commands)).toBe(
			"Extra context\n\nReview src carefully.",
		);
	});
});
