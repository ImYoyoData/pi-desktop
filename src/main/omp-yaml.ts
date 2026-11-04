import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";

/**
 * 读一个 YAML 配置文件为对象；文件不存在或语法错误返回 null。
 *
 * 解析失败不能把整页打挂：config.yml 写错一个缩进，设置页与资源页都要能打开，
 * 否则用户连“回去改回来”都做不到。
 */
export function readYamlObject(filePath: string): Record<string, unknown> | null {
	if (!fs.existsSync(filePath)) return null;
	try {
		const value = loadYaml(fs.readFileSync(filePath, "utf8"));
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[omp] ${filePath} 解析失败，按空配置处理：${message}\n`);
		return null;
	}
}

/** 保存前的读取：文件破损时拒绝写回，避免把用户配置整体覆盖。 */
export function readYamlObjectForWrite(
	filePath: string,
): Record<string, unknown> {
	if (!fs.existsSync(filePath)) return {};
	const doc = readYamlObject(filePath);
	if (doc === null) {
		throw new Error(`refusing to overwrite invalid YAML: ${filePath}`);
	}
	return doc;
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
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	try {
		fs.writeFileSync(tempPath, dumpYaml(doc, { lineWidth: 120 }), {
			encoding: "utf8",
			mode: 0o600,
		});
		fs.renameSync(tempPath, filePath);
	} catch (err) {
		try {
			fs.rmSync(tempPath, { force: true });
		} catch {
			// 临时文件清理失败不掩盖原始错误。
		}
		throw err;
	}
}
