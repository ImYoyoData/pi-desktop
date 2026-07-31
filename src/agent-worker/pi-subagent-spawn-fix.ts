/**
 * pi-subagents resolves child launches via getPiSpawnCommand:
 *   spawn(process.execPath, [piCliScript, ...flags])
 * In Electron utilityProcess, execPath is Electron and the extension cannot
 * resolve @earendil-works/pi-coding-agent — it falls back to bare `pi` / .CMD,
 * which spawn() cannot run on Windows without shell (EINVAL).
 *
 * Main sets PI_DESKTOP_NODE_PATH + PI_DESKTOP_PI_CLI_PATH; we rewrite execPath
 * and argv[1] so the package's resolver finds the real CLI + Node binary.
 */
import {
  PI_DESKTOP_NODE_PATH_ENV,
  PI_DESKTOP_PI_CLI_PATH_ENV,
  PI_SUBAGENT_PI_BINARY_ENV,
} from "../shared/pi-subagent-env";

export function applyPiSubagentSpawnFix(): void {
  const nodePath = process.env[PI_DESKTOP_NODE_PATH_ENV]?.trim();
  const cliPath = process.env[PI_DESKTOP_PI_CLI_PATH_ENV]?.trim();
  if (!cliPath) return;

  if (nodePath) {
    try {
      Object.defineProperty(process, "execPath", {
        value: nodePath,
        configurable: true,
      });
    } catch {
      // Some runtimes freeze execPath; ELECTRON_RUN_AS_NODE may still help.
      process.env.ELECTRON_RUN_AS_NODE = "1";
    }
  } else {
    process.env.ELECTRON_RUN_AS_NODE = "1";
  }

  // resolvePiCliScript() short-circuits when argv[1] is a script inside the
  // pi-coding-agent package — which is exactly our CLI entry.
  process.argv[1] = cliPath;

  // Drop .cmd overrides that would bypass node+cli and fail spawn() on Windows.
  const binary = process.env[PI_SUBAGENT_PI_BINARY_ENV]?.trim();
  if (binary && /\.(cmd|bat)$/i.test(binary)) {
    delete process.env[PI_SUBAGENT_PI_BINARY_ENV];
  }
}
