# Pi Desktop

[English](./README.md)

**Pi Desktop** 是基于 Electron + Vue 3 的 [Pi](https://github.com/badlogic/pi-mono) 编程助手桌面工作区：多会话对话、模型配置、浏览器选元素、终端、文件预览等，集中在一个窗口里完成。

> 当前版本：**v0.0.1**（测试 / 预发布）

## 功能

- 多会话 Pi Agent（侧边栏 + 流式对话）
- 模型 / API Key 与 `~/.pi/agent` 同步
- 右侧面板：变更、文件、浏览器（选元素 → 标签 + 截图）、终端、预览
- 首次启动若无 Pi 配置会自动初始化
- 打包后**单实例**：再次打开会聚焦已有窗口

## 支持平台

| 平台 | 架构 | 安装包 |
|------|------|--------|
| Windows | **x64**、**arm64** | NSIS 安装包 + 便携版（x64） |
| macOS | **x64**、**arm64** | DMG + ZIP |

> **说明：** Electron 39+ 已不再提供 **Windows 32 位 (ia32)** 运行时，64 位系统请使用 x64 包。

## 开发环境

- Node.js 22.x
- npm 10+
- Windows 或 macOS

Pi 数据目录：`~/.pi/agent`（可用环境变量 `PI_CODING_AGENT_DIR` 覆盖）。

## 安装与开发

```sh
git clone https://github.com/ImYoyoData/pi-desktop.git
cd pi-desktop
npm install
npm run icons
npm run dev
```

常用脚本：

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动开发 |
| `npm test` | 单元测试 |
| `npm run typecheck` | 类型检查 |
| `npm run build` | 编译 |
| `npm run dist:win` | 打包 Windows x64 + arm64 |
| `npm run dist:mac` | 打包 macOS x64 + arm64 |

## 分支与发布

- **`dev`**：日常开发分支
- **`main` / `master`**：推送后触发 GitHub Actions，按 `package.json` 版本编译并发布 Release（预发布）
- 标签 `v*` 同样触发发布流程

安装包见仓库 **Releases** 页面。

## 外观

主题默认**跟随系统**。可在标题栏按钮（太阳/月亮/调色盘）或 **设置 → 外观** 中切换亮色/暗色。语言支持：跟随系统 / 中文 / English。

## 首次使用

启动时会自动准备：

- `~/.pi/agent/`
- `models.json`、`auth.json`、`settings.json`
- `sessions/`、`skills/` 等目录

然后在 **设置 → 模型 / API Keys** 中配置供应商即可。

## 许可证

MIT
