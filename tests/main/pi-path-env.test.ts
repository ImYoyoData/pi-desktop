import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	augmentPathForPiCli,
	buildAgentWorkerEnv,
	isInsideElectronAsar,
	packageRootFromPiCli,
	resolvePiCodingAgentCliPath,
} from "../../src/main/pi-path-env";
import {
	PI_DESKTOP_NODE_PATH_ENV,
	PI_DESKTOP_PI_CLI_PATH_ENV,
	PI_PACKAGE_DIR_ENV,
	PI_SUBAGENT_PI_BINARY_ENV,
	PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT_ENV,
} from "../../src/shared/pi-subagent-env";
import { applyPiSubagentSpawnFix } from "../../src/agent-worker/pi-subagent-spawn-fix";

describe("augmentPathForPiCli", () => {
	it("preserves existing PATH entries", () => {
		const env = augmentPathForPiCli({ PATH: "C:\\\\existing" });
		expect(env.PATH?.split(/;|:/).some((p) => p.includes("existing"))).toBe(
			true,
		);
	});

	it("does not clear HOME/USERPROFILE", () => {
		const env = augmentPathForPiCli({
			PATH: "/usr/bin",
			HOME: "/Users/test",
			USERPROFILE: "C:\\\\Users\\\\test",
		});
		expect(env.HOME).toBe("/Users/test");
		expect(env.USERPROFILE).toBe("C:\\\\Users\\\\test");
	});

	it("includes pnpm Local dir on Windows", () => {
		if (process.platform !== "win32") return;
		const local = "C:\\Users\\test\\AppData\\Local";
		const env = augmentPathForPiCli({
			PATH: "C:\\existing",
			LOCALAPPDATA: local,
			USERPROFILE: "C:\\Users\\test",
		});
		expect(env.PATH).toContain(path.join(local, "pnpm"));
	});

	it("includes Library/pnpm and Homebrew paths on unix", () => {
		if (process.platform === "win32") return;
		const env = augmentPathForPiCli({
			PATH: "/usr/bin",
			HOME: "/Users/test",
		});
		expect(env.PATH).toContain("/Users/test/Library/pnpm");
		expect(env.PATH).toContain("/opt/homebrew/bin");
	});
});

describe("resolvePiCodingAgentCliPath", () => {
	it("finds cli.js under searchRoots", () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-cli-"));
		const cli = path.join(
			root,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"dist",
			"cli.js",
		);
		mkdirSync(path.dirname(cli), { recursive: true });
		writeFileSync(cli, "#!/usr/bin/env node\n", "utf8");
		// Explicit empty env: a developer's PI_DESKTOP_PI_CLI_PATH override must
		// not leak in via process.env and short-circuit before searchRoots.
		expect(resolvePiCodingAgentCliPath([root], {})).toBe(cli);
	});

	it("honors PI_DESKTOP_PI_CLI_PATH override", () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-cli-override-"));
		const cli = path.join(root, "custom-cli.js");
		writeFileSync(cli, "ok", "utf8");
		expect(
			resolvePiCodingAgentCliPath([], { [PI_DESKTOP_PI_CLI_PATH_ENV]: cli }),
		).toBe(cli);
	});
});

describe("buildAgentWorkerEnv", () => {
	it("sets desktop node/cli and package root; clears .cmd PI_SUBAGENT_PI_BINARY", () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-worker-env-"));
		const packageRoot = path.join(
			root,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
		);
		const cli = path.join(packageRoot, "dist", "cli.js");
		mkdirSync(path.dirname(cli), { recursive: true });
		writeFileSync(cli, "#!/usr/bin/env node\n", "utf8");
		// Real packages ship a package.json at the root — getPackageDir relies on it.
		writeFileSync(path.join(packageRoot, "package.json"), "{}", "utf8");
		const fakeNode = path.join(root, "node.exe");
		writeFileSync(fakeNode, "", "utf8");

		const env = buildAgentWorkerEnv(
			{
				PATH: "/usr/bin",
				[PI_DESKTOP_NODE_PATH_ENV]: fakeNode,
				[PI_SUBAGENT_PI_BINARY_ENV]:
					"C:\\\\Users\\\\x\\\\AppData\\\\Local\\\\pnpm\\\\pi.CMD",
			},
			{ searchRoots: [root] },
		);

		expect(env[PI_DESKTOP_NODE_PATH_ENV]).toBe(fakeNode);
		expect(env[PI_DESKTOP_PI_CLI_PATH_ENV]).toBe(cli);
		expect(env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT_ENV]).toBe(
			packageRootFromPiCli(cli),
		);
		// SDK hook points at the package root so themes/templates resolve (the
		// bundled SDK otherwise walks up from out/main to the app root).
		expect(env[PI_PACKAGE_DIR_ENV]).toBe(packageRootFromPiCli(cli));
		expect(env[PI_SUBAGENT_PI_BINARY_ENV]).toBeUndefined();
		expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
	});

	it("omits PI_PACKAGE_DIR when the CLI's package root has no package.json", () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-pkgdir-missing-"));
		const cli = path.join(root, "dist", "cli.js");
		mkdirSync(path.dirname(cli), { recursive: true });
		writeFileSync(cli, "#!/usr/bin/env node\n", "utf8");

		const env = buildAgentWorkerEnv(
			{ PATH: "/usr/bin", [PI_DESKTOP_PI_CLI_PATH_ENV]: cli },
			{ searchRoots: [] },
		);
		expect(env[PI_DESKTOP_PI_CLI_PATH_ENV]).toBe(cli);
		expect(env[PI_PACKAGE_DIR_ENV]).toBeUndefined();
	});

	it("drops system Node when the only CLI path is under app.asar (no ELECTRON_RUN_AS_NODE on fork env)", () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-asar-cli-"));
		// Create a real file whose absolute path contains "app.asar"
		const asarDir = path.join(
			root,
			"app.asar",
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"dist",
		);
		mkdirSync(asarDir, { recursive: true });
		const asarCli = path.join(asarDir, "cli.js");
		writeFileSync(asarCli, "#!/usr/bin/env node\n", "utf8");
		const fakeNode = path.join(root, "node");
		writeFileSync(fakeNode, "", "utf8");
		expect(isInsideElectronAsar(asarCli)).toBe(true);

		const env = buildAgentWorkerEnv(
			{
				PATH: "/usr/bin",
				ELECTRON_RUN_AS_NODE: "1",
				[PI_DESKTOP_NODE_PATH_ENV]: fakeNode,
				[PI_DESKTOP_PI_CLI_PATH_ENV]: asarCli,
			},
			{ searchRoots: [] },
		);

		expect(env[PI_DESKTOP_PI_CLI_PATH_ENV]).toBe(asarCli);
		expect(env[PI_DESKTOP_NODE_PATH_ENV]).toBeUndefined();
		// Must never reach utilityProcess.fork — breaks parentPort / sessions:open.
		expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
	});
});

describe("applyPiSubagentSpawnFix", () => {
	it("rewrites execPath and argv[1] from env", () => {
		const prevExec = process.execPath;
		const prevArgv1 = process.argv[1];
		const prevNode = process.env[PI_DESKTOP_NODE_PATH_ENV];
		const prevCli = process.env[PI_DESKTOP_PI_CLI_PATH_ENV];
		const prevBinary = process.env[PI_SUBAGENT_PI_BINARY_ENV];
		const prevAsNode = process.env.ELECTRON_RUN_AS_NODE;

		const root = mkdtempSync(path.join(tmpdir(), "pi-spawn-fix-"));
		const fakeNode = path.join(root, "node");
		const fakeCli = path.join(root, "cli.js");
		writeFileSync(fakeNode, "", "utf8");
		writeFileSync(fakeCli, "", "utf8");

		process.env[PI_DESKTOP_NODE_PATH_ENV] = fakeNode;
		process.env[PI_DESKTOP_PI_CLI_PATH_ENV] = fakeCli;
		process.env[PI_SUBAGENT_PI_BINARY_ENV] = "C:\\\\shim\\\\pi.CMD";
		delete process.env.ELECTRON_RUN_AS_NODE;

		try {
			applyPiSubagentSpawnFix();
			expect(process.execPath).toBe(fakeNode);
			expect(process.argv[1]).toBe(fakeCli);
			expect(process.env[PI_SUBAGENT_PI_BINARY_ENV]).toBeUndefined();
		} finally {
			Object.defineProperty(process, "execPath", {
				value: prevExec,
				configurable: true,
			});
			process.argv[1] = prevArgv1;
			if (prevNode === undefined) delete process.env[PI_DESKTOP_NODE_PATH_ENV];
			else process.env[PI_DESKTOP_NODE_PATH_ENV] = prevNode;
			if (prevCli === undefined) delete process.env[PI_DESKTOP_PI_CLI_PATH_ENV];
			else process.env[PI_DESKTOP_PI_CLI_PATH_ENV] = prevCli;
			if (prevBinary === undefined)
				delete process.env[PI_SUBAGENT_PI_BINARY_ENV];
			else process.env[PI_SUBAGENT_PI_BINARY_ENV] = prevBinary;
			if (prevAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
			else process.env.ELECTRON_RUN_AS_NODE = prevAsNode;
		}
	});

	it("sets ELECTRON_RUN_AS_NODE after boot when no system Node (for child inheritance)", () => {
		const prevArgv1 = process.argv[1];
		const prevNode = process.env[PI_DESKTOP_NODE_PATH_ENV];
		const prevCli = process.env[PI_DESKTOP_PI_CLI_PATH_ENV];
		const prevAsNode = process.env.ELECTRON_RUN_AS_NODE;

		const root = mkdtempSync(path.join(tmpdir(), "pi-spawn-asnode-"));
		const fakeCli = path.join(root, "cli.js");
		writeFileSync(fakeCli, "", "utf8");

		delete process.env[PI_DESKTOP_NODE_PATH_ENV];
		process.env[PI_DESKTOP_PI_CLI_PATH_ENV] = fakeCli;
		delete process.env.ELECTRON_RUN_AS_NODE;

		try {
			applyPiSubagentSpawnFix();
			expect(process.argv[1]).toBe(fakeCli);
			expect(process.env.ELECTRON_RUN_AS_NODE).toBe("1");
		} finally {
			process.argv[1] = prevArgv1;
			if (prevNode === undefined) delete process.env[PI_DESKTOP_NODE_PATH_ENV];
			else process.env[PI_DESKTOP_NODE_PATH_ENV] = prevNode;
			if (prevCli === undefined) delete process.env[PI_DESKTOP_PI_CLI_PATH_ENV];
			else process.env[PI_DESKTOP_PI_CLI_PATH_ENV] = prevCli;
			if (prevAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
			else process.env.ELECTRON_RUN_AS_NODE = prevAsNode;
		}
	});
});
