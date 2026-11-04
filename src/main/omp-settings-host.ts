import fs from "node:fs";
import path from "node:path";
import { ompAgentDir } from "./omp-dir";
import { readYamlObject, readYamlObjectForWrite, writeYamlObject } from "./omp-yaml";
import {
	OMP_SETTINGS,
	readOmpSetting,
	writeOmpSetting,
	type OmpSettingsSnapshot,
} from "../shared/omp-settings";

/** omp 的全局设置文件；兼容 config.yaml。 */
export function ompConfigPath(): string {
	const dir = ompAgentDir();
	const yml = path.join(dir, "config.yml");
	if (fs.existsSync(yml)) return yml;
	const yaml = path.join(dir, "config.yaml");
	return fs.existsSync(yaml) ? yaml : yml;
}

/** 只回传 schema 里存在、且 config.yml 里已显式设置的值。 */
export function readOmpSettings(): OmpSettingsSnapshot {
	const doc = readYamlObject(ompConfigPath());
	const values: Record<string, unknown> = {};
	if (doc) {
		for (const entry of OMP_SETTINGS) {
			const value = readOmpSetting(doc, entry.id);
			if (value !== undefined) values[entry.id] = value;
		}
	}
	return { values };
}

/**
 * 合并保存：`patch` 里值为 null/undefined 表示删除该设置，其余写回。
 * 只接受 schema 里的 id，未涉及的配置项原样保留。
 */
export function saveOmpSettings(
	patch: Record<string, unknown>,
): OmpSettingsSnapshot {
	const known = new Set(OMP_SETTINGS.map((entry) => entry.id));
	const filePath = ompConfigPath();
	const doc = readYamlObjectForWrite(filePath);
	for (const [id, value] of Object.entries(patch)) {
		if (!known.has(id)) continue;
		writeOmpSetting(doc, id, value);
	}
	writeYamlObject(filePath, doc);
	return readOmpSettings();
}
