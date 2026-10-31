<div align="center">

<img src="resources/icon.svg" alt="Pi Desktop" width="88" height="88" />

# Pi Desktop

**面向 [Pi](https://github.com/badlogic/pi-mono) 编程 Agent 的桌面工作台** — 多会话对话、工具流、内置浏览器、终端、文件预览与完整 Git 面板，一窗完成。

[English](./README.md) · [Releases](https://github.com/ImYoyoData/pi-desktop/releases) · [Issues](https://github.com/ImYoyoData/pi-desktop/issues)

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
  <img alt="electron" src="https://img.shields.io/badge/Electron-44-47848F?style=for-the-badge&labelColor=1a1a1a&logo=electron&logoColor=white" />
</a>
<a href="https://react.dev/">
  <img alt="react" src="https://img.shields.io/badge/React-19-087EA4?style=for-the-badge&labelColor=1a1a1a&logo=react&logoColor=61DAFB" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6B7280?style=for-the-badge&labelColor=1a1a1a" />
</a>

<br /><br />

```text
┌─────────────┬──────────────────────┬──────────────────┐
│  会话 / 模型  │   Agent 流式对话      │  运行 · Diff      │
│  Skills     │   工具 · 询问用户      │  浏览器 · 终端    │
│             │   引用截图           │  预览 · Git       │
└─────────────┴──────────────────────┴──────────────────┘
```

</div>

---

## 截图

<img src="docs/screenshots/chat-git-panel.png" alt="Pi Desktop" width="760" />

### 为什么选择Pi Desktop？

- 使用Pi-SDK非其他同种产品使用RPC连接CLI工作
- 开发者积极维护

| 分层 | 提供什么 |
| --- | --- |
| **Agent 核心** | 多会话 Pi 运行时、流式回合、带 Diff 的工具卡片、ask-user 向导 |
| **工作台** | 更改 / 运行 / 浏览器 / 终端 / 预览 标签页 |
| **信任与安全** | 项目信任门；工具以应用自身的操作系统权限执行 |
| **发布链路** | 推送到 main 自动构建 NSIS + DMG（各架构） |

---


## 开始使用

### 下载

从 [Releases](https://github.com/ImYoyoData/pi-desktop/releases) 获取最新安装包（Windows x64 / arm64，macOS Apple Silicon / Intel）。

### 源码构建

```bash
npm install        # 环境配置
npm run dev        # 运行
npm run build      # 构建
npm run dist       # 构建安装包
```

## 许可证

[MIT](./LICENSE)
