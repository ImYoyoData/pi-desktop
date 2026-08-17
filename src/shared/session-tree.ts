/**
 * Helpers for rolling back poisoned user turns in the Pi session tree
 * (e.g. image_url payloads rejected by a non-vision OpenAI-compat endpoint).
 */

export function isImageSchemaPromptError(message: string): boolean {
	const m = message.toLowerCase();
	return (
		m.includes("image_url") ||
		(m.includes("unknown variant") && m.includes("image")) ||
		(m.includes("expected 'text'") && m.includes("image")) ||
		m.includes("does not support image") ||
		m.includes("images are not supported") ||
		(m.includes("vision") && m.includes("not support"))
	);
}

/** Stable worker error prefix — renderer maps this to i18n. */
export const NO_VISION_ERROR_PREFIX = "PI_MODEL_NO_VISION:";

export function isNoVisionModelError(message: string): boolean {
	return message.includes(NO_VISION_ERROR_PREFIX) || isImageSchemaPromptError(message);
}

export function formatNoVisionModelError(): string {
	return `${NO_VISION_ERROR_PREFIX} Current model does not accept images. Switch to a vision-capable model, or remove images and send again.`;
}
