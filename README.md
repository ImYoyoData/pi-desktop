# Pi Desktop

[中文说明](./README.zh-CN.md)

**Pi Desktop** is an Electron + Vue 3 desktop workspace for the [Pi](https://github.com/badlogic/pi-mono) coding agent. Chat with agents, manage sessions, browse the web, run terminals, preview files, and configure models — in one window.

> Current release: **v0.0.1** (prerelease / test build)

## Features

- Multi-session Pi agent workspace (sidebar + streaming chat)
- Model / API key settings synced with `~/.pi/agent`
- Right pane: Changes, Files, Browser (element select → chat tags + screenshots), Terminal, Preview
- Auto-initializes Pi agent config on first launch if missing
- Single-instance packaged app (second launch focuses the existing window)

## Supported platforms

| Platform | Architectures | Installer |
|----------|---------------|-----------|
| Windows  | **x64**, **arm64** | NSIS setup + portable (x64) |
| macOS    | **x64**, **arm64** | DMG + ZIP |

> **Note:** Modern Electron (39+) no longer ships **Windows 32-bit (ia32)**. Use the x64 build on 64-bit Windows.

## Requirements (development)

- Node.js 22.x
- npm 10+
- Windows or macOS

Pi data lives under `~/.pi/agent` (override with `PI_CODING_AGENT_DIR`).

## Install & develop

```sh
git clone https://github.com/ImYoyoData/pi-desktop.git
cd pi-desktop
npm install
npm run icons
npm run dev
```

Useful scripts:

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Electron + Vite |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Compile main/preload/renderer |
| `npm run dist:win` | Package Windows x64 + arm64 |
| `npm run dist:mac` | Package macOS x64 + arm64 |

## Branches & releases

- **`dev`** — active development
- **`main` / `master`** — push triggers GitHub Actions to build and publish a GitHub Release (prerelease) for the version in `package.json`
- Tags `v*` also trigger the release workflow

Artifacts appear under the repository **Releases** page.

## Appearance

Theme defaults to **follow system**. Toggle from the title bar (sun/moon/palette) or **Settings → Appearance**. Language can be set to System / 中文 / English.

## Voice input (optional ASR)

Local **Qwen3-ASR 0.6B Q4_K** (GGUF) via CrispASR. Not installed by default — clicking the mic prompts to download (~640 MB disk, ~900 MB RAM while running). Disable under **Settings → Appearance** to hide the mic and skip loading.

On launch, Pi Desktop ensures:

- `~/.pi/agent/`
- `models.json`, `auth.json`, `settings.json`
- `sessions/`, `skills/`, …

Then open **Settings → Models / API Keys** to add providers.

## License

MIT
