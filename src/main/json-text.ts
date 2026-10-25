import { readFileSync } from "node:fs";

/** 读 JSON 文本并去掉 Windows 编辑器可能写入的 UTF-8 BOM，否则 JSON.parse 会失败。 */
export function readJsonText(filePath: string): string {
	return readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}
