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
  <img alt="electron" src="https://img.shields.io/badge/Electron-39-47848F?style=for-the-badge&labelColor=1a1a1a&logo=electron&logoColor=white" />
</a>
<a href="https://vuejs.org/">
  <img alt="vue" src="https://img.shields.io/badge/Vue-3.5-42B883?style=for-the-badge&labelColor=1a1a1a&logo=vuedotjs&logoColor=white" />
</a>
<a href="https://github.com/ImYoyoData/pi-desktop">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-6B7280?style=for-the-badge&labelColor=1a1a1a" />
</a>

<br /><br />

```text
┌─────────────┬──────────────────────┬──────────────────┐
│  会话 / 模型  │   Agent 流式对话      │  运行 · Diff      │
│  Skills     │   工具 · 询问用户      │  浏览器 · 终端    │
│             │   语音 · 引用截图      │  预览 · Git       │
└─────────────┴──────────────────────┴──────────────────┘
```

</div>

---

## 截图

**对话 + Git 工作台** — 下达任务，观看 Agent 思考与调用工具，然后直接在右侧面板审阅并提交改动：

<img src="docs/screenshots/chat-git-panel.png" alt="Pi Desktop 对话与 Git 面板" width="760" />

**内置浏览器打开项目仓库** — 浏览任意网页并拾取元素作为 Agent 上下文：

<img src="docs/screenshots/github-repo-browser.png" alt="Pi Desktop 内置浏览器打开 GitHub 仓库" width="760" />

---

## 为什么是 Pi Desktop

Pi 本身很强。Pi Desktop 把它装进**产品级工作台**：多会话并行、工具调用可审阅、变更可回看、浏览器可点选元素、终端常开 —— 不离开一个窗口。

### 优点

- **多会话 Agent 工作区** — 每个项目可并行多个 Pi 会话，各自独立模型、推理强度与历史，并与 Pi CLI 共享会话文件。
- **透明的 Agent 执行过程** — 每个工具调用与思考步骤实时流入对话；最终回答后自动折叠为一个“过程”摘要，答案保持干净。
- **内置 Git 工作台** — 更改面板支持暂存/取消暂存、单文件 Diff、提交与推送、分支管理、提交历史（含单提交文件清单）、重置（软/硬）、单文件恢复。
- **内置浏览器 + 元素拾取** — 打开网页、选择元素/截图，作为引用与图片喂给 Agent。
- **终端 / 预览 / 运行** — node-pty 终端、Monaco Diff 预览、后台进程运行面板。
- **灵活语音输入** — 听写与唤醒词，支持本机 **CrispASR**（离线、隐私）或你配置的 **OpenAI 兼容云端 ASR API**。
- **图片进入上下文** — 粘贴图片或图片 URL，按会话缓存后以 base64 发送给视觉模型，同时把文件路径写入上下文供文本模型定位。
- **信任与安全** — 按工作区的信任门、bash/写入权限询问与白名单。
- **低配机器也能流畅启动** — UI 懒加载、PCM 编码离主线程、主进程启动不加载 Pi SDK。

| 分层 | 提供什么 |
| --- | --- |
| **Agent 核心** | 多会话 Pi 运行时、流式回合、带 Diff 的工具卡片、ask-user 向导 |
| **工作台** | 更改 / 运行 / 浏览器 / 终端 / 预览 标签页 |
| **信任与安全** | 项目信任门、bash 白名单、权限询问 |
| **语音** | 本机 ASR 或可配置云端 ASR API（OpenAI 兼容） |
| **发布链路** | 推送到 main 自动构建 NSIS + DMG（各架构） |

---

## 技术栈

- **运行时**：Electron 39 · Node 22
- **UI**：Vue 3.5 · TypeScript · Naive UI · Vite (electron-vite)
- **编辑器**：Monaco Editor · highlight.js · marked · KaTeX · Mermaid · @viz-js/viz
- **Agent**：[@earendil-works/pi-coding-agent](https://pi.dev) 运行时，运行在 utilityProcess worker 中
- **终端**：node-pty · xterm.js
- **打包**：electron-builder（Windows NSIS · macOS DMG · Linux）

---

## 开始使用

### 下载

从 [Releases](https://github.com/ImYoyoData/pi-desktop/releases) 获取最新安装包（Windows x64 / arm64，macOS Apple Silicon / Intel）。

### 源码构建

```bash
npm install
npm run dev        # 开发
npm run build      # 打包到 out/
npm run dist:win   # 或 dist:mac —— 生成安装包
```

### 首次使用

1. 打开项目文件夹并信任。
2. 选择模型（如需在 **设置 → 模型** 配置 API Key）。
3. 新建会话并描述任务 —— Agent 会自动调研与实现，你可在右侧 Git 面板审阅并提交。
4. 点击麦克风启用语音；首次使用选择 **本地（离线）** 或 **云端 API** 识别。

---

## 项目信息

- 仓库：[github.com/ImYoyoData/pi-desktop](https://github.com/ImYoyoData/pi-desktop)
- 发布：[Releases](https://github.com/ImYoyoData/pi-desktop/releases)
- 问题与建议：[Issues](https://github.com/ImYoyoData/pi-desktop/issues)

## 许可证

[MIT](./LICENSE)
