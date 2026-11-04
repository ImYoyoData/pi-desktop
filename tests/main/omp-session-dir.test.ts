import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ensureOmpSessionDir,
	ompLegacySessionDirName,
	ompSessionDirName,
} from "../../src/main/omp-session-dir";

describe("omp 会话目录编码", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-dirs-"));
		process.env.OMP_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		delete process.env.OMP_AGENT_DIR;
		fs.rmSync(agentDir, { recursive: true, force: true });
	});

	it("home 下的工作区使用相对 home 的短目录名", () => {
		const cwd = path.join(os.homedir(), "pi-desktop-omp-dir-test");
		expect(ompSessionDirName(cwd)).toBe("-pi-desktop-omp-dir-test");
	});

	it("temp 下的工作区优先使用 -tmp- 目录名", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-cwd-"));
		try {
			const name = ompSessionDirName(cwd);
			expect(name.startsWith("-tmp-")).toBe(true);
			expect(name).not.toBe(ompLegacySessionDirName(cwd));
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("home 与 temp 之外的工作区保持旧的绝对路径编码", () => {
		const root = path.parse(os.homedir()).root;
		const cwd = path.join(root, "pi-desktop-omp-abs-test");
		expect(ompSessionDirName(cwd)).toBe(ompLegacySessionDirName(cwd));
		expect(ompSessionDirName(cwd).startsWith("--")).toBe(true);
	});

	it("迁移桌面旧会话目录到 SDK 目录名", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-migrate-"));
		try {
			const sessionsRoot = path.join(agentDir, "sessions");
			const legacyDir = path.join(sessionsRoot, ompLegacySessionDirName(cwd));
			fs.mkdirSync(legacyDir, { recursive: true });
			fs.writeFileSync(path.join(legacyDir, "session.jsonl"), "{}\n", "utf8");

			const dir = ensureOmpSessionDir(cwd);

			expect(dir).toBe(path.join(sessionsRoot, ompSessionDirName(cwd)));
			expect(fs.existsSync(path.join(dir, "session.jsonl"))).toBe(true);
			expect(fs.existsSync(legacyDir)).toBe(false);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});
