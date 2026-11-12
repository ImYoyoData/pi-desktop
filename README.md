<div align="center">

<img src="resources/icon.svg" alt="Pi Desktop" width="88" height="88" />

# Pi Desktop

**The desktop agent workbench for [Pi](https://github.com/earendil-works/pi) and [OMP](https://github.com/can1357/oh-my-pi)**

[中文说明](./README.zh-CN.md) · [Releases](https://github.com/ImYoyoData/pi-desktop/releases) · [Issues](https://github.com/ImYoyoData/pi-desktop/issues)

<br />

<a href="https://github.com/ImYoyoData/pi-desktop/releases">
  <img alt="version" src="https://img.shields.io/github/v/release/ImYoyoData/pi-desktop?include_prereleases&style=for-the-badge&label=version&color=C9A227&labelColor=1a1a1a" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop/stargazers">
  <img alt="stars" src="https://img.shields.io/github/stars/ImYoyoData/pi-desktop?style=for-the-badge&color=EDB21A&labelColor=1a1a1a&logo=github&logoColor=white" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop/forks">
  <img alt="forks" src="https://img.shields.io/github/forks/ImYoyoData/pi-desktop?style=for-the-badge&color=2B6CB0&labelColor=1a1a1a" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop/issues">
  <img alt="issues" src="https://img.shields.io/github/issues/ImYoyoData/pi-desktop?style=for-the-badge&color=16A34A&labelColor=1a1a1a" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop/blob/dev/LICENSE">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-2B6CB0?style=for-the-badge&labelColor=1a1a1a" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop">
  <img alt="language" src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&labelColor=1a1a1a&logo=typescript&logoColor=white" />
</a>
<a href="https://www.electronjs.org/">
  <img alt="electron" src="https://img.shields.io/badge/Electron-45-47848F?style=for-the-badge&labelColor=1a1a1a&logo=electron&logoColor=white" />
</a>
<a href="https://react.dev/">
  <img alt="react" src="https://img.shields.io/badge/React-19-087EA4?style=for-the-badge&labelColor=1a1a1a&logo=react&logoColor=61DAFB" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6B7280?style=for-the-badge&labelColor=1a1a1a" />
</a>

<br /><br />

```text
┌───────────────────┬──────────────────────┬───────────────────┐
│ Sessions · Models │ Agent streaming chat │ Files · Changes   │
│ Skills · Todos    │ Tools · Ask user     │ Browser · Preview │
│ Engine Pi / OMP   │ Quoted screenshots   │ Terminal (bottom) │
└───────────────────┴──────────────────────┴───────────────────┘
```

</div>

---

<h2 align="center">Screenshots</h2>

<p align="center">
  <img src="docs/screenshots/new-session.png" alt="Pi Desktop new session" width="760" />
</p>

---

### Why Pi Desktop?

- Drives agents with the Pi SDK directly, without an RPC bridge to the CLI
- Switch between the Pi and OMP (oh-my-pi) engines in one window, each with its own config directory and sessions
- Actively maintained

| Layer | What it provides |
| --- | --- |
| **Agent core** | Multi-session Pi / OMP runtimes, streaming turns, tool cards with diffs, ask_user wizard, skills and slash commands, session-level todo list |
| **Workbench** | Files / Changes / Browser right pane, bottom terminal, Markdown preview (edit / split / preview) and a full Git panel (branches, staging, commit, push, history) |
| **Trust & safety** | Project trust gate; tools run with the app's own OS permissions |
| **Release pipeline** | A push to main builds NSIS (x64 / arm64), DMG (Apple Silicon / Intel) and AppImage (x64) and publishes a Release |

---

## Getting started

### Download

Get the latest installer from [Releases](https://github.com/ImYoyoData/pi-desktop/releases): Windows x64 / arm64, macOS Apple Silicon / Intel, Linux x64 (AppImage).

### Build from source

Requires Node.js 24+.

```bash
npm install        # install dependencies
npm run typecheck  # typecheck main + renderer
npm run dugite:git # fetch the embedded Git binary (optional; Git panel needs it)
npm run dev        # run in development
npm run build      # build
npm run dist       # package for the current platform
```

## Interface languages

English, Simplified Chinese, Traditional Chinese and Japanese.

## License

[MIT](./LICENSE)
