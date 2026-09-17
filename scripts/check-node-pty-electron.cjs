"use strict";
/**
 * Diagnostic — can the node-pty prebuilt binaries installed by pnpm be loaded
 * by the Electron runtime without a node-gyp rebuild (i.e. without Visual
 * Studio Build Tools)?
 *
 * Runs Electron with ELECTRON_RUN_AS_NODE=1 and tries to spawn a real cmd.exe
 * pty through node-pty.
 *
 *   node scripts/check-node-pty-electron.cjs
 *
 * Exit 0 + "NODE_PTY_ELECTRON_OK"  → prebuilds work under Electron, no rebuild
 *                                    (and no Visual Studio) is required on x64.
 * Exit 1 + "NODE_PTY_ELECTRON_FAIL" → the prebuild cannot load in Electron; the
 *                                    native module must be rebuilt from source
 *                                    (install VS Build Tools, see README).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

if (process.platform !== "win32") {
  console.log("Not win32 — nothing to check here.");
  process.exit(0);
}

let electronExe;
try {
  // The `electron` npm package's index.js exports the path to the real binary.
  electronExe = require(path.join(root, "node_modules", "electron"));
} catch {
  console.error("electron is not installed — run pnpm install first.");
  process.exit(2);
}

const probe = `
"use strict";
const TIMEOUT_MS = 5000;
let done = false;
function finish(code, message) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  try { p && p.kill(); } catch {}
  if (message) console.log(message);
  process.exit(code);
}
let p = null;
const timer = setTimeout(
  () => finish(1, "NODE_PTY_ELECTRON_FAIL timeout (no pty output)"),
  TIMEOUT_MS,
);
try {
  const { spawn } = require("node-pty");
  p = spawn("cmd.exe", ["/d", "/s", "/c", "echo PTY_PROBE_OK"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
  });
  let out = "";
  p.onData((d) => {
    out += d;
    if (out.includes("PTY_PROBE_OK")) {
      finish(0, "NODE_PTY_ELECTRON_OK");
    }
  });
  p.onExit((e) =>
    finish(1, "NODE_PTY_ELECTRON_FAIL exit=" + e.exitCode + " out=" + out.slice(0, 200)),
  );
} catch (err) {
  finish(1, "NODE_PTY_ELECTRON_FAIL " + (err && err.message ? err.message : String(err)));
}
`;

const res = spawnSync(electronExe, ["-e", probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  cwd: root,
  encoding: "utf8",
  timeout: 20000,
  windowsHide: true,
});

if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);
process.exit(res.status ?? 1);
