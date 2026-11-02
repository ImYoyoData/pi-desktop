import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bunBinary } from "./bun-binary.mjs";

const root = path.resolve(import.meta.dirname, "..");

/**
 * `omp-legacy-pi-modules` 是 oh-my-pi monorepo 的虚拟模块，npm 包里没有；
 * 它只服务于加载旧版 Pi 插件（桌面端不用），构建时补一个空 stub 即可。
 */
function ensureLegacyModuleStub() {
	const dir = path.join(root, "node_modules", "omp-legacy-pi-modules");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "package.json"),
		`${JSON.stringify(
			{
				name: "omp-legacy-pi-modules",
				version: "0.0.0",
				type: "module",
				main: "index.js",
			},
			null,
			"\t",
		)}\n`,
	);
	writeFileSync(
		path.join(dir, "index.js"),
		"export const BUNDLED_PI_MODULE_LOADERS = {};\n",
	);
}

function targetFor(platform, arch) {
	const os =
		platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
	return `${os === "windows" ? "bun-windows" : os === "darwin" ? "bun-darwin" : "bun-linux"}-${arch === "arm64" ? "arm64" : "x64"}`;
}

const platform = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? process.arch;
const outDir = path.join(root, "build", "omp");
const outFile = path.join(
	outDir,
	platform === "win32" ? "omp-worker.exe" : "omp-worker",
);

ensureLegacyModuleStub();
mkdirSync(outDir, { recursive: true });

console.info(`[omp-worker] building ${targetFor(platform, arch)} → ${outFile}`);
execFileSync(
	bunBinary(),
	[
		"build",
		"--compile",
		`--target=${targetFor(platform, arch)}`,
		"--outfile",
		outFile,
		path.join(root, "src", "omp-worker", "index.ts"),
	],
	{ cwd: root, stdio: "inherit" },
);
console.info(`[omp-worker] done`);
