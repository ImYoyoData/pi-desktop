import { describe, expect, it } from "vitest";
import {
	formatNoVisionModelError,
	isImageSchemaPromptError,
	isNoVisionModelError,
	NO_VISION_ERROR_PREFIX,
	orphanToolResultEntryIds,
} from "../../src/shared/session-tree";
import { formatLlmError } from "../../src/renderer/src/utils/llm-error";

describe("session-tree image error helpers", () => {
	it("detects OpenAI-compat image_url schema rejections", () => {
		const raw =
			`400: {"message":"Failed to deserialize the JSON body into the target type: messages[1]: unknown variant 'image_url', expected 'text'","type":"invalid_request_error"}`;
		expect(isImageSchemaPromptError(raw)).toBe(true);
		expect(isNoVisionModelError(raw)).toBe(true);
	});

	it("detects the stable no-vision prefix", () => {
		const raw = formatNoVisionModelError();
		expect(raw.startsWith(NO_VISION_ERROR_PREFIX)).toBe(true);
		expect(isNoVisionModelError(raw)).toBe(true);
	});

	it("maps no-vision / image_url errors to friendly copy", () => {
		const zh = formatLlmError(formatNoVisionModelError(), "zh-CN");
		expect(zh).toContain("不支持图片");
		const en = formatLlmError(
			`400 unknown variant 'image_url', expected 'text'`,
			"en",
		);
		expect(en.toLowerCase()).toContain("image");
	});
});

describe("orphanToolResultEntryIds", () => {
	const assistant = (stopReason: string, callIds: string[]) => ({
		id: `assistant-${stopReason}`,
		type: "message",
		message: {
			role: "assistant",
			stopReason,
			content: callIds.map((id) => ({ type: "toolCall", id })),
		},
	});
	const toolResult = (id: string, callId: string) => ({
		id,
		type: "message",
		message: { role: "toolResult", toolCallId: callId },
	});
	const edit = (targetId: string, replacement: unknown) => ({
		id: `edit-${targetId}`,
		type: "context_edit",
		targetId,
		replacement,
	});

	it("drops tool results whose tool call lives in an aborted message", () => {
		expect(
			orphanToolResultEntryIds([
				assistant("aborted", ["call_1", "call_2"]),
				toolResult("r1", "call_1"),
				toolResult("r2", "call_2"),
			]),
		).toEqual(["r1", "r2"]);
	});

	it("drops tool results whose tool call lives in an errored message", () => {
		expect(
			orphanToolResultEntryIds([
				assistant("error", ["call_1"]),
				toolResult("r1", "call_1"),
			]),
		).toEqual(["r1"]);
	});

	it("keeps tool results of a completed tool turn", () => {
		expect(
			orphanToolResultEntryIds([
				assistant("toolUse", ["call_1"]),
				toolResult("r1", "call_1"),
			]),
		).toEqual([]);
	});

	it("does not re-drop a result already removed from context", () => {
		expect(
			orphanToolResultEntryIds([
				assistant("aborted", ["call_1"]),
				toolResult("r1", "call_1"),
				edit("r1", null),
			]),
		).toEqual([]);
	});

	it("ignores edits that keep the message", () => {
		expect(
			orphanToolResultEntryIds([
				assistant("aborted", ["call_1"]),
				toolResult("r1", "call_1"),
				edit("r1", { content: "kept" }),
			]),
		).toEqual(["r1"]);
	});
});
