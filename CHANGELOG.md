# Changelog

## v0.2.2 (2026-08-02)

### 修复 Fixes
- 修复启动蒙版遗留卡死：初始化完成时清除了兜底定时器，导致 worker 事件丢失后永久等待；现增 10 秒硬性兜底 + 3 秒宽限，并移除蒙版 logo、新增进度条
- 修复发布打包脚本：generate-icons.mjs 误用 TS 语法导致 CI 失败
- 所有弹窗统一内部滚动：内容区包裹 .modal-scroll，弹窗高度不超过窗口，右上角 X 可正常点击关闭
- 会话信息弹窗：更换为可靠的内部滚动，并在会话 worker 加载完成后自动刷新
- Windows ARM64 打包：强制 node-pty 跨架构重建
- 扩展名解析：仅信任 node_modules 包根目录的 package.json，本地扩展用文件名
- Boot overlay can no longer stick (the init finally used to clear the failsafe timer, leaving the overlay at 85% forever when the worker-ready event was missed); now 10s hard cap + 3s grace, logo removed, progress bar added.
- Fixed the release packaging script (TypeScript syntax slipped into generate-icons.mjs and broke CI).
- Every modal now scrolls internally (.modal-scroll); dialogs stay within the window and the header X closes reliably.
- Session info modal: reliable internal scroll + auto-refresh when the session worker finishes loading.
- Windows ARM64 packaging forces a node-pty cross-arch rebuild.
- Extension names only trust node_modules/<package> package.json; local extensions use the file stem.

### 新功能 Features
- 新建分支支持选择「基于分支」（本地+远端选项，默认当前分支）
- New-branch dialog lets you pick the base branch (local + remote, defaults to current).

## v0.2.1 (2026-08-02)

### 性能优化 Performance
- 启动提速：窗口创建前不再等待 Pi agent 环境初始化，非关键主机（ASR/TTS/更新/市场/CLI）延后加载；渲染进程首帧后立即淡出启动页，改为应用内轻量加载蒙版，工作区逐步加载（瞬间打开 + 渐进加载）。
- 构建加速约 15%
- 提速 Windows 打包：跳过原生模块重编译，新增 dist:win:fast 快速安装包模式（store 压缩），图标生成恰等性跳过。：主进程跳过压缩、渲染目标锁定现代 Chromium、关闭压缩体积报告。
- Faster startup: the window no longer waits for Pi agent env setup; non-critical hosts (ASR/TTS/update/market/CLI) are deferred. The splash fades right after first paint and a light in-app boot overlay loads the workspace progressively (instant open).
- Build ~15% faster: main process skips minification, renderer targets modern Chromium, compressed-size report disabled. Windows packaging skips native rebuild, adds a dist:win:fast script and idempotent icons.

### 修复 Fixes
- 修复启动卡死在加载界面：启动蒙版引用了未导入的 i18n t，导致首帧渲染报错；并增加 5 秒兕底，蒙版绝不会永久停留。
- 修复 ASR 识别混乱：录音被二次降采样压缩 3 倍（语速变快、音调变尖），现按 16kHz→16kHz 编码，降采样升级为线性插值；空转录不再报错，显示「未识别到语音」。
- 修复聊天过程折叠条展开后消失，现在可随时再次折叠；会话结束后旧轮次的工具调用/思考隐藏，历史只显示用户消息+折叠条+结论。
- 重试键改为静默继续（不再追加「继续」消息气泡）。
- 修复 agent 运行命令时卡顿：流式输出显示级截断，避免每次更新重新解析全量输出。
- Fixed stuck-on-loading screen: the boot overlay referenced an un-imported i18n t so the first render threw; a 5s failsafe now guarantees the overlay always clears.
- Fixed garbled ASR: recorded audio was double-resampled (3x compressed, chipmunk speed); encode is now 16k->16k with linear-interpolation downsampling. Empty transcripts show a friendly “no speech” hint instead of an error.
- The process-summary fold bar no longer disappears after expanding — it can be folded again anytime; finished turns hide tool/thinking rows so history reads as user messages + summary + final answer. The retry button resumes silently without a visible bubble; streamed command output is capped so long-running tools no longer lag the UI.

### 新功能 Features
- 云端 ASR：首次使用选择弹窗、本地/云端 Tab、接口格式自动适配（小米 MiMo 走 chat/completions + input_audio，中文默认 language=zh）、录制音频自动上传、语音设置弹窗重新布局。
- 聊天：粘贴图片融合进图片（不再额外 tag）、删除时清理缓存、右键复制/另存、切换会话图片与标签还原。
- 更改面板：文件暂存/取消暂存、提交历史查看文件列表、软/硬重置、单文件 diff 与恢复、右键过滤文件写入 .gitignore。
- 扩展：卸载同步移除于提示词扩展；安全设置信任工作区列表折叠化；侧栏新增「打开工作区」按钮；@ 提及支持绝对路径/盘符匹配。
- 每个会话可点击信息按钮查看已加载的工具、扩展、Skills 与读取的文件。
- Cloud ASR: first-use backend chooser, local/cloud tabs, auto API format (Xiaomi MiMo uses chat/completions + input_audio, Chinese defaults to language=zh), recorded audio uploads automatically, redesigned voice settings dialog.
- Chat: pasted images merge into the image (no extra tag) with cache cleanup on remove, right-click copy/save, images/tags restore across session switches.
- Changes panel: stage/unstage, commit file list, soft/hard reset, per-file diff & restore, right-click filter writes .gitignore rules.
- Extensions: uninstall also removes the module from prompt extensions; security settings fold trusted workspaces; sidebar “Open workspace” button; @ mentions match absolute/drive-letter paths. A per-session info button shows loaded tools/extensions/skills and files read.

### 兼容性 Compatibility
- 全部改动使用跨平台 API，Windows/macOS/Linux 通用；macOS 媒体权限、Dock 图标、隐藏标题栏、Homebrew PATH 等既有适配保持不变。
- All changes use cross-platform APIs (Windows/macOS/Linux); existing macOS media permissions, Dock icon, hidden title bar and Homebrew PATH handling are unchanged.

## v0.2.0 (2026-08-01)

### 性能优化 Performance
- **启动提速**：主进程把 Pi agent 环境初始化延后到窗口创建之后；渲染进程懒加载 Composer / MessageList / MarkdownView / RightPane / SessionSidebar / 设置弹窗等重型模块，katex、monaco、mermaid、xterm、viz 等不再阻塞首屏，低配 CPU 打开应用明显更快、不卡顿。
- **ASR 不再冻结界面**：语音识别前的 PCM 编码（合并/重采样/转 16bit）移入 Web Worker，并改为通过 IPC 直接传原始 Int16 PCM（去掉原来在主线程 base64 编码几 MB 音频导致的卡死）。
- **会话切换秒发首条消息**：打开会话时后台异步预热 Pi agent worker（带并发去重），首次发送不再等待冷启动。
- **历史图片有界**：从会话文件恢复图片时按 24MB 预算“最新优先”保留，避免大会话把几十 MB base64 通过 IPC 塞给渲染进程。

### 修复 Fixes
- **ask_user 未作答时 agent 不再继续执行**：ask_user 工具标记为顺序执行，同批其他工具不会在等待用户回答时并行运行。
- **待办列表不再跨轮累积**：每轮新任务开始时重置待办，上一轮的待办不会叠加到本轮。
- **切换会话后图片/标签不丢失**：会话历史现在会恢复用户消息中的图片，并把标签（文件/链接/元素）通过会话旁 sidecar 持久化后还原。
- **粘贴图片 URL 自动下载**：粘贴的图片 URL（或位图）会下载/写入该会话的缓存目录（`<session>.jsonl.attachments/`），聊天消息带上图片的本地地址，视觉模型收 base64、文本模型可通过路径找到文件。
- **删除会话先停止再清理**：删除会话时先停掉 agent worker，再删除会话文件及其缓存目录。

### 新功能 Features
- 图片点击放大：消息里的图片改为自定义灯箱，支持右键复制图片到系统剪贴板、另存为文件。
- 待办面板重做：图标徽章、进度 pill、渐变进度条、进行中/已完成分组、条目过渡动画、手动收起。
- 图片缓存按会话隔离，随会话删除自动清理。

### 兼容性 Compatibility
- 本轮改动均使用跨平台 API（fs / fetch / clipboard / Web Worker / IPC），Windows、macOS、Linux 通用；macOS 的媒体权限、Dock 图标、隐藏标题栏、Homebrew PATH 等既有适配保持不变。
- 平台相关的 taskkill / GPU 探测 / 终端 Shell 均有平台守卫。
