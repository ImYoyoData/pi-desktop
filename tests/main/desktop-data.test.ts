import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dirs = vi.hoisted(() => ({ userData: "", appData: "" }));

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) =>
			name === "userData" ? dirs.userData : dirs.appData,
	},
}));

import {
	desktopDataPath,
	migrateDesktopDataFiles,
	migrateFile,
} from "../../src/main/desktop-data";

describe("desktop-data", () => {
	let root: string;
	let agentDir: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-data-"));
		agentDir = path.join(root, "agent");
		dirs.appData = path.join(root, "appData");
		fs.mkdirSync(dirs.appData, { recursive: true });
		fs.mkdirSync(dirs.appData + path.sep + "pi-desktop", { recursive: true });
		dirs.userData = path.join(dirs.appData, "pi-desktop-dev");
		fs.mkdirSync(dirs.userData, { recursive: true });
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("desktopDataPath 落在 agent 目录", () => {
		expect(desktopDataPath("proxy.json")).toBe(
			path.join(agentDir, "proxy.json"),
		);
	});

	it("目标缺失时复制第一个存在的来源", () => {
		const first = path.join(root, "first");
		const second = path.join(root, "second");
		fs.mkdirSync(first);
		fs.mkdirSync(second);
		fs.writeFileSync(path.join(second, "state.json"), "second");
		const target = path.join(root, "target", "state.json");

		expect(migrateFile([first, second], target)).toBe(true);
		expect(fs.readFileSync(target, "utf8")).toBe("second");
	});

	it("目标已存在时保留共享文件", () => {
		const source = path.join(root, "source");
		fs.mkdirSync(source);
		fs.writeFileSync(path.join(source, "state.json"), "legacy");
		const target = path.join(root, "target", "state.json");
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, "shared");

		expect(migrateFile([source], target)).toBe(false);
		expect(fs.readFileSync(target, "utf8")).toBe("shared");
	});

	it("来源都不存在时什么都不创建", () => {
		const target = path.join(root, "target", "state.json");

		expect(migrateFile([path.join(root, "missing")], target)).toBe(false);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("启动迁移同时覆盖当前模式与安装包的旧文件", () => {
		fs.writeFileSync(
			path.join(dirs.userData, "proxy.json"),
			'{"desktop":{"mode":"system"}}',
		);
		fs.writeFileSync(
			path.join(dirs.appData, "pi-desktop", "models-selection.json"),
			'{"model":"pi-1"}',
		);

		migrateDesktopDataFiles();

		expect(fs.readFileSync(path.join(agentDir, "proxy.json"), "utf8")).toContain(
			"system",
		);
		expect(
			fs.readFileSync(path.join(agentDir, "models-selection.json"), "utf8"),
		).toContain("pi-1");
	});
});
