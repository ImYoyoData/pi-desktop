import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";

/** 读一个 YAML 配置文件为对象；文件不存在返回 null。 */
export function readYamlObject(filePath: string): Record<string, unknown> | null {
	if (!fs.existsSync(filePath)) return null;
	const value = loadYaml(fs.readFileSync(filePath, "utf8"));
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** 写回 YAML，并在覆盖前留一份 .bak（js-yaml 往返会丢注释）。 */
export function writeYamlObject(
	filePath: string,
	doc: Record<string, unknown>,
): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	try {
		fs.copyFileSync(filePath, `${filePath}.bak`);
	} catch {
		// 首次创建没有原文件可备份。
	}
	fs.writeFileSync(filePath, dumpYaml(doc, { lineWidth: 120 }), "utf8");
}
