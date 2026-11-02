import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readYamlObject } from "../../src/main/omp-yaml";

describe("omp YAML 读写", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-yaml-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("文件不存在返回 null", () => {
		expect(readYamlObject(path.join(dir, "missing.yml"))).toBeNull();
	});

	it("语法错误时按空配置处理，不把调用方打挂", () => {
		const file = path.join(dir, "config.yml");
		fs.writeFileSync(file, "a: [1,\nb: :\n", "utf8");
		expect(readYamlObject(file)).toBeNull();
	});

	it("正常文件按对象读出", () => {
		const file = path.join(dir, "config.yml");
		fs.writeFileSync(file, "theme:\n  dark: night\n", "utf8");
		expect(readYamlObject(file)).toEqual({ theme: { dark: "night" } });
	});
});
