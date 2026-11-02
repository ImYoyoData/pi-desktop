import { execFileSync } from "node:child_process";
import path from "node:path";
import { bunBinary } from "./bun-binary.mjs";

const root = path.resolve(import.meta.dirname, "..");

/**
 * 从 omp SDK 导出设置面板的元数据，写成桌面端可用的 JSON。
 *
 * 桌面主进程不能 import omp SDK（它依赖 bun 运行时），所以把 omp 自己的
 * tab / group / 字段元数据在构建期抽出来随包分发；omp 升级后重跑本脚本即可。
 */
console.info("[omp-settings] generating schema…");
execFileSync(
	bunBinary(),
	[path.join(root, "scripts", "gen-omp-settings-schema.bun.mjs")],
	{ cwd: root, stdio: "inherit" },
);
