import { describe, expect, it } from "vitest";
import {
	formatNoVisionModelError,
	isImageSchemaPromptError,
	isNoVisionModelError,
	NO_VISION_ERROR_PREFIX,
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
