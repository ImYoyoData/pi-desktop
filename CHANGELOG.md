# Changelog

## 未发布 / Unreleased

本版重点：局域网网页控制台改名为「远程控制」，默认开启局域网访问（普通 HTTP，无证书警告），公网访问改为 Cloudflare 隧道按需打开并支持绑定自己的域名；网页版移除语音输入但补上浏览器原生朗读；新增回答语言设置；修复 Windows 上 bash 工具不可用。

### 新功能 Features

- 「远程控制」取代原「局域网网页控制台」；标题栏图标、面板文案与网页端标题统一更名。
- 局域网访问默认开启：启动即监听 `http://<本机IP>:18700`，手机/平板浏览器直接可用。
- 登录方式简化为 **9 位数字访问密码**（首次运行自动生成，面板内可查看/复制/一键更换），不再需要用户名密码。
- 新增「公网访问」开关（默认关闭）：打开后由内置 cloudflared 建立 Cloudflare 隧道，生成 `https://<随机名>.trycloudflare.com` 公网地址；TLS 由 Cloudflare 边缘终结，隧道仅转发到 127.0.0.1 的本地端口，并带自动重试与看门狗。
- **支持绑定自己的域名**：填入 Cloudflare 隧道 Token 与公网地址后改用命名隧道，地址固定不变、重启也无需重新分享链接；面板内提供「打开 Cloudflare 隧道页面」按钮与 Token 粘贴，并给出配置步骤。
- 网页版朗读改用**浏览器原生语音合成**（Web Speech API）：零安装、零下载，不占用桌面端语音模型。
- 新增「**回答语言**」设置（设置 → 外观）：20 种语言可选，默认「跟随设备」按系统语言判断；与界面语言相互独立。语言写入系统提示词，避免模型跟着上一条消息的语言漂移。
- 登录失败按来源限速：公网来源 6 次失败锁定 10 分钟，局域网来源独立计数，防止爆破。
- Renamed the LAN web console to **Remote Control**; the titlebar entry, panel copy and web page title follow.
- LAN access now defaults to **on** (`http://<pc-ip>:18700`), so a phone on the same network works out of the box.
- Login is a single **9-digit access PIN** (auto-generated on first run, visible/copyable/rotatable in the panel) instead of username + password.
- New **Public access** switch (off by default): the bundled cloudflared opens a Cloudflare tunnel on demand, publishing a `https://<random>.trycloudflare.com` URL (TLS terminated at Cloudflare's edge). The tunnel only ever forwards to a loopback port, with automatic retry and a watchdog.
- **Bring your own domain**: a Cloudflare tunnel token plus hostname switches to a named tunnel with a fixed address, so nothing has to be re-shared after a restart. The panel links to the Cloudflare tunnels page, offers token paste, and spells out the steps.
- Read-aloud in the web console uses the **browser's own speech synthesis** (Web Speech API) — nothing to install or download, and the desktop voice model is untouched.
- New **Answer language** setting (Settings → Appearance): 20 languages with "Follow device" as the default; independent of the interface language and written into the system prompt so the model does not drift.
- Failed logins are rate limited per client — 6 attempts then a 10-minute lock, counted separately for tunnel traffic.

### 变更 Changes

- 局域网改为普通 HTTP：不再生成自签名证书，手机首次打开没有「证书不受信任」警告；代价是局域网内不加密，请只在可信网络使用。公网地址仍为 HTTPS。
- 隧道进程改由官方 `cloudflared` npm 包托管（二进制仍由应用自行获取并实跑校验），删掉手写的下载/解压逻辑。
- 网页版移除录音/语音输入（麦克风按钮、PCM 采集、`/api/transcribe` 代理与桌面 ASR 调用），桌面端语音输入不受影响；朗读改为浏览器实现保留。
- **回复中发送的内容改为「引导」语义**：不再排队等下一轮，而是立即注入当前这轮，Pi 会在下一个 LLM 调用前看到它并据此继续推理。
- 移除 `selfsigned` 依赖（其 v5 在当前依赖树中无法生成证书）。
- The LAN side now uses plain HTTP: no self-signed certificate is generated and phones see no certificate warning. The trade-off is unencrypted LAN traffic, so use it on a trusted network; the public URL is still HTTPS.
- The tunnel process is now driven by the official `cloudflared` npm package (the app still obtains and executes the binary to verify it), replacing hand-written download/unpack code.
- Removed voice recording from the web console (mic button, PCM capture, the `/api/transcribe` proxy and the desktop ASR call). Desktop voice input is unchanged; read-aloud is kept via the browser.
- Messages sent **while Pi is replying** are now delivered as guidance into the running turn instead of waiting for the next one.
- Dropped the `selfsigned` dependency (its v5 build cannot issue certificates in this dependency tree).

### 修复 Fixes

- **修复 Windows 上 bash 工具完全不可用**（`execvpe(/bin/bash) failed: No such file or directory`）：工具原本退回到 PATH 上的 `bash.exe`，而那其实是 WSL 启动器，未安装 WSL 发行版时必然失败。现在优先寻找真正的 bash（Git Bash 等），找不到就改用内置 PowerShell 工具，并禁止调用不可用的 bash，避免模型反复撞错。
- 修复模型选择器在**新建会话（未发送任何消息）时就被锁死**：判断依据误用了会话摘要里的状态字段，该字段可能滞后残留；现在只依据当前真实的流式状态。
- 修复回复期间发送的内容会从界面"消失"：发送后立即显示为待发送卡片并保留到被处理。
- 修复模型切换下拉框**无法滚动**：模型上百个时菜单撑出窗口，下方模型点不到；现在限制高度（60vh/460px）并内部滚动。
- 修复侧栏偶尔多出一个「空白工作区」：空白路径被 `path.resolve("")` 解析成应用自身的工作目录，于是变成一个没有名字的工作区条目。现在空白/纯空格路径在写入与读取工作区状态时都会被拒绝（同时清理旧版本留下的脏数据），IPC 边界、渲染层 store、局域网网页端与侧栏各自独立过滤，任一层都不再可能渲染出空白工作区。
- 修复公网访问「页面能打开、密码能登录，却一直显示已断开 / 正在连接」：隧道入口没挂 WebSocket，公网 `wss://xxx.trycloudflare.com/ws` 被当成普通 HTTP 请求返回 404。现在局域网与隧道入口两个监听各自挂载 WebSocket，公网长连接正常。
- 修复打包版找不到内置 cloudflared：asar 归档内的路径会被判断为"存在"却无法执行，且打包会压平按架构分的目录；现在同时兼容两种布局，并在使用前实际执行 `--version` 验证。
- 修复开启公网访问时看门狗在 cloudflared 下载途中误判「未在运行」并重试，导致下载被中断、二进制残缺；同时修正重试退避被重置成固定 5 秒的问题。
- 修复中英语言包里重复定义的文案键（构建告警，且重复项会静默覆盖原值），并加上自动化校验防止再犯。
- Fixed the **bash tool being unusable on Windows** (`execvpe(/bin/bash) failed: No such file or directory`): its shell fallback picked `bash.exe` from PATH, which is the WSL launcher. A real bash (Git Bash) is now preferred; otherwise the app switches to the built-in PowerShell tool and denies the broken `bash` tool.
- Fixed the model picker being locked in a **brand-new session that had sent nothing**: it trusted a session-summary status field that can lag; it now follows the live streaming state only.
- Fixed a message sent during a reply appearing to vanish from the UI: it now shows as a pending card until the agent takes it.
- Fixed the model switcher dropdown **not scrolling**: with hundreds of models the menu grew past the window and lower models were unclickable; it is now height-capped (60vh/460px) and scrolls internally.
- Fixed the sidebar occasionally showing an extra blank workspace: a blank path resolved via `path.resolve("")` becomes the app's own working directory, i.e. a nameless workspace entry. Blank/whitespace-only paths are now rejected both when reading and writing workspace state (which also purges leftovers from older builds), and the IPC boundary, renderer store, LAN web panel and sidebar each filter independently, so no layer can render a blank workspace.
- Fixed public access getting stuck on "disconnected / reconnecting" after a successful login: the tunnel origin listener had no WebSocket server attached, so `wss://xxx.trycloudflare.com/ws` fell through to the plain HTTP handler and returned 404. Both listeners (LAN and tunnel origin) now mount their own WebSocket server, so the public connection stays up.
- Fixed packaged builds failing to find the bundled cloudflared: paths inside the app archive report as existing yet cannot be executed, and packaging flattens the per-arch directory. Both layouts are handled and the binary is executed (`--version`) before use.
- Fixed the watchdog declaring cloudflared "not running" while it was still downloading, which aborted the download and left a broken binary; retry backoff no longer collapses into a fixed 5-second loop.
- Fixed duplicated message keys in the locale files (a build warning whose duplicate silently overrode the original) and added automated checks so it cannot come back.

### 优化 / 体验 Improvements

- 端口被占用、页面未构建等启动失败会在面板内说明原因，并在 20 秒后自动重试一次。
- 面板新增公网地址状态（连接中/已就绪/失败原因与重试按钮），标题栏用颜色区分「仅局域网」与「已开公网」；短时间来回开关会保留同一地址。
- 隧道沿用 cloudflared 默认传输协议：实测强制 `--protocol http2` 会让临时地址持续不可达，因此不强制。
- 隧道状态变化（上线/断开/报错及公网地址）写入日志便于排查。
- 启动日志会打印本机实际使用的命令 shell，便于排查命令执行问题。
- Startup failures (busy port, missing build) now explain themselves in the panel and retry once after 20 seconds.
- The panel shows the public URL state (connecting / ready / error with retry); the titlebar dot distinguishes LAN-only from public, and toggling off/on quickly keeps the same address.
- Tunnel traffic uses cloudflared's default transport: forcing `--protocol http2` was measured to make the temporary address unreachable, so it is not forced.
- Tunnel transitions (up / down / error, with the public URL) are logged for diagnosis.
- The startup log prints which command shell was chosen, making shell problems diagnosable.

## v0.3.3 (2026-09-07)

本版重点：修复长摘要/超大输出卡屏；输入与拖入 URL 显示为纯文本。

### 修复 Fixes

- 修复摘要过长卡屏：超大工具输出/长思考的折叠展开不再逐帧动画（原会对上万个 DOM 节点每帧重排冻结界面），改为直接瞬切，并限制重排范围。
- 修复旧代码引起的崩溃。
- Fixed the UI freeze on oversized summaries: fold/unfold of huge tool-output/thinking sections no longer animates grid-rows (which re-laid-out tens of thousands of DOM nodes every frame) — it snaps instantly with relayout contained locally.
- Fixed a crash triggered by legacy rendering code.

### 优化 / 体验 Improvements

- 输入 URL 显示纯文本：粘贴/拖放的 http(s) URL 直接以纯文本插入光标处，不再自动生成链接卡片。
- 移除思考块上的耗时显示，过程展示更简洁。
- Pasting/dropping an http(s) URL now inserts plain text at the caret instead of creating a URL chip.
- Removed the elapsed-time readout on thinking blocks.

### 新功能 Features

- 离开未使用的空白会话时自动清理：从未聊天也未重命名的「新会话」在切换工作区或关闭窗口时自动删除，不再残留。
- Blank "新会话" sessions you never chatted in nor renamed are auto-discarded when leaving a workspace or closing the window.

## v0.3.2 (2026-09-07)

本版重点：消息区 UI 与渲染优化；新增待办与文件更改显示。

### 新功能 Features

- 新增待办和文件更改的显示。
- 内置 Pi 版本更新至 0.85.1。
- Added display of todos and file changes in the message area.
- Bundled Pi updated to 0.85.1.

### 优化 / 体验 Improvements

- 优化消息区 UI 样式。
- 优化消息区渲染速度。
- 移除启动时的加载页和打开会话的加载页。
- Refined message-area UI styling.
- Faster message-area rendering.
- Removed the startup loading page and the session-open loading page.

### 修复 Fixes

- 修复模型输出时向上滚动消息区会被拉回。
- 修复对话轮数计算。
- 修复消息区渲染问题。
- Fixed the message area being pulled back while scrolling during model output.
- Fixed conversation turn-count calculation.
- Fixed message-area rendering issues.

## v0.3.1 (2026-09-04)

本版重点：全局网络代理；会话排序与折叠；启动提速与恢复旧会话稳定性。

### 新功能 Features

- **网络代理**：新增全局代理设置面板，代理注入 agent worker 与 git 操作，支持 http/https，TitleBar 快捷入口（解决 #8）。
- **会话排序**：侧栏会话按「置顶 + 最近修改」排序并持久化，新建会话自动置顶。
- **会话列表折叠**：会话数超过 7 个自动折叠，显示「查看全部 N 个」展开按钮。
- Global proxy settings (http/https) applied to agent workers and git operations (closes #8).
- Sessions sorted by pinned + recently modified (persisted); new sessions pin to top.
- Session list auto-collapses beyond 7 items with a "view all" expander.

### 修复 / 体验 Fixes

- 修复程序后台运行时 IPC 任务队列积压：会话事件在页面隐藏时合并缓冲、恢复可见后批量消费，避免主进程事件堆积导致卡顿。
- 修复 `MessageList.vue` 虚拟滚动逻辑：跟随底部改为滚动事件同步判定，上滑读历史时不再被排队中的自动贴底强制拉回。
- 压缩上下文按钮默认不再显示，可在通用设置中重新开启。
- 修复上下文用量百分比估算：按模型真实上下文窗口计算，并展示真实会话成本（原为固定成本线估算）。
- 修复打开旧会话加载首 token 慢或偶发失败：上下文用量统计改为 sidecar 落盘（`.timing.json`），恢复旧会话不再重复计算或丢失统计。
- 修复侧栏「卡住恢复」按钮不显示：终止/重启按钮原本放在不存在的 footer 插槽永不渲染，已移入默认插槽。
- 修复/补全 Vue 类型环境：`env.d.ts` 改为模块增强并引入 `@vue/typescript-plugin`，消除全项目 `vue has no exported member` 假报错。
- Hidden-window IPC backlog: session events now buffer while the page is hidden and bulk-flush on restore, so the queue never piles up in the background.
- Fixed `MessageList.vue` virtual scrolling: follow-bottom is decided synchronously on scroll and queued auto-snaps are cancelled when you scroll up to read history.
- The compact-context button now stays hidden by default (re-enable in General settings).
- Context usage percent now measures against the model's real context window (was a flat 300k cost line), with the real session cost shown instead of an estimate.
- Old-session open no longer stalls or miscounts: context stats now persist via a sidecar `.timing.json`.
- "Recover stuck" buttons now render (moved from a non-existent slot).
- Vue type environment fixed via module augmentation + `@vue/typescript-plugin` (no more false `vue has no exported member`).

### 性能优化 Performance

- 会话列表改为 worker 线程轻量扫描（仅读首行 + 标题 + 首条消息 + mtime），不再整读会话 jsonl，避免阻塞主进程事件循环。
- ASR GPU 探测（nvidia-smi / vulkaninfo 等）移入独立 worker 线程，Pi CLI 工作区扫描同样 worker 化。
- 新增启动全链路埋点（`PI_DESKTOP_STARTUP_TIMING=1` 输出到 userData/startup-timing.log），便于回归监控。
- 运行开关：`PI_DESKTOP_NO_WATCH`（跳过文件监听）、`PI_DESKTOP_NO_SPELLCHECK`、`PI_DESKTOP_USER_DATA`；LAN 控制台延迟启动且可用 `PI_DESKTOP_NO_LAN` 跳过。
- Session list summaries built by a worker-thread light scan instead of full jsonl reads.
- ASR GPU probes and workspace scans moved off the main event loop.
- Startup timing instrumentation behind `PI_DESKTOP_STARTUP_TIMING=1`.

## v0.2.9 (2026-08-17)

### 修复 / 体验 Fixes

- 暗色主题代码高亮改用 `github-dark`，不再误用浅色配色（#5）。
- 代码块行号与内容对齐：只保留外层滚动，行号 sticky，避免双滚动错位（#6）。
- 非视觉模型发图：发送前校验 vision、失败回滚毒化消息，编辑重发真正替换，避免会话卡死（#7）。
- 粘贴 Word/网页富文本时剥离格式，只插入纯文本；图片与 URL 粘贴行为不变（#9）。
- 打包后 Codex / Anthropic / Copilot 等 OAuth 动态模块打进 asar chunk，修复缺少 `openai-codex.js`（#10）。
- Dark theme code highlight uses `github-dark` instead of light styles (#5).
- Code-block line numbers stay aligned: single scrollport + sticky gutters (#6).
- Non-vision image sends: gate vision, roll back poisoned messages, edit-resend replaces in place (#7).
- Paste from Word/web strips formatting to plain text; image/URL paste unchanged (#9).
- Packaged OAuth flows (Codex / Anthropic / Copilot, …) are statically chunked into asar — no missing `openai-codex.js` (#10).

## v0.2.8 (2026-08-09)

### 新功能 Features

- 自定义模型：拉取模型与保存分离；「测试连接」发极短请求测延迟/连通；删除 Provider 立即写入磁盘。
- 移除工作区：清除 Pi 会话与配置，**不删除**项目文件夹；关闭仅移入已关闭列表。
- Custom models: Fetch models vs Save are separate; Test sends a tiny probe for latency; deleting a provider persists immediately.
- Remove workspace: purge Pi sessions/config without deleting the project folder; Close only dismisses to the closed list.

### 修复 / 体验 Fixes

- 录音确认与云端 ASR：WAV/base64 与云转写移出主进程，避免整窗冻结；唤醒流改用 Int16 PCM。
- 启动与切会话：侧栏先出 Desktop 列表、Pi 扫描后台合并；历史分页只物化当前页图片，降低大会话切换成本。
- 录音波形：接近上下边界 85% 时自动压缩增益，避免顶死、更跟手。
- Recording confirm / cloud ASR: WAV/base64 and cloud transcribe off the main process so windows stay responsive; wake stream uses Int16 PCM.
- Startup & session switch: Desktop-first sidebar list with background Pi merge; history pages only materialize images for the window, cutting large-session switch cost.
- Voice waveform: auto-compress when nearing 85% of the canvas so bars stay lively.

## v0.2.7 (2026-08-09)

### 新功能 Features

- 局域网网页复用桌面消息组件：思考块、读写文件等工具卡、Markdown/代码高亮；WebSocket 实时推送，边生成边显示。
- 会话模型与推理强度与桌面端同步；打开会话后读取 worker 状态，网页修改写回桌面。
- 连接门禁：登录后先显示「正在连接」界面，WS 握手并拿到工作区列表后再进入主界面；断线自动重连。
- 语音识别超过 4 秒显示取消；侧边栏会话预取/缓存，抽屉打开更快。
- 局域网地址选择：优先 Wi‑Fi/`192.168`，可选手动指定 IP；静态资源 gzip。
- LAN web reuses desktop MessageList: thinking blocks, read/write tool cards, Markdown/code highlight; WebSocket streams tokens live.
- Session model + thinking level sync with the desktop worker; web changes write back.
- Connect gate: after login, show a connecting screen until WS hello + workspace list succeed; auto-reconnect on drop.
- ASR cancel after 4s of converting; sidebar session prefetch/cache for faster drawer open.
- Smarter LAN IP pick (prefer Wi‑Fi / `192.168`, optional manual IP); gzip for static assets.

### 修复 / 体验 Fixes

- 桌面端点击录音卡顿：预热 AudioWorklet、点击先出 UI；低性能机关闭重型麦处理、降波形帧率，录音中不再每帧 resample。
- 桌面启动与侧边栏体感优化：减少启动阻塞、会话列表更轻。
- Desktop mic-click jank: prewarm AudioWorklet, paint UI first; on low-power machines disable heavy AEC/NS/AGC, lower waveform FPS, and stop per-frame resample while recording.
- Snappier desktop boot and session sidebar.

## v0.2.6 (2026-08-03)

### 新功能 Features

- 局域网网页控制台（默认关闭）：标题栏左侧远程图标入口，账号密码登录，发放 6 小时会话 token（刷新免重登）。
- 手机/PC 浏览器访问：响应式界面、Vue + Naive UI（与桌面同款组件库），工作区手风琴展开会话、聊天、发送消息。
- 语音识别：网页录音 → HTTP 代理 → 桌面配置的识别方式（本地/云端），PC 点击录音、再点识别，含「正在转换」加载效果。
- 安全：HTTPS 自签证书（EC P-256，手机握手更快），token 鉴权，开关状态持久化、重启自动开启。
- 性能：历史刷新合并防抖、渲染去重、WS 保活心跳，移动端连接与体验更流畅。
- LAN web console (off by default): remote icon in the title bar, username/password login with a 6-hour session token (refresh stays logged in).
- Responsive Vue + Naive UI page (same component library as the desktop): accordion workspaces with inline sessions, chat, and message sending.
- Voice: record in the browser, proxy through /api/transcribe, recognize with the desktop's configured ASR (local or cloud); click to record, click again to convert with a converting overlay.
- Security: HTTPS with a self-signed EC P-256 cert (faster mobile handshake), token auth, switch state persists and auto-starts on launch.
- Performance: coalesced history refreshes, render de-duplication, WS keepalive; smoother mobile connection and UX.

## v0.2.5 (2026-08-02)

### 新功能 Features

- **上下文成本可见性**：Composer 底部上下文百分比改为按 30 万 token 成本参考线计算（原按模型 100 万窗口算，长会话永远显示健康）；悬浮面板显示估算成本（$）与 token 绝对值，超过参考线时「压缩上下文」按钮变红脉冲提醒。
- **待办面板自动计时**：本轮待办总用时由面板层墙钟计时（从首次出现到全部完成），不再依赖扩展的时长后缀，切换/重启后仍准确。
- **已关闭工作区折叠区**：侧边栏新增已关闭工作区分组，支持重新打开；工作区菜单增加「关闭」项。
- **文件树过滤项灰色展示**：被过滤（@ 查询/忽略）的文件以深灰斜体弱化显示，不再与正常文件混淆。
- **聊天 tag 输入优化**：添加聊天标签追加到输入框末尾（不再插入光标处）；用户消息卡片上的 tag 移到内容后方展示。
- **@ 查询精确化**：去掉点开头文件的宽泛过滤，只排除明确的忽略项（SEARCH_SKIP），dotfile 搜索更准确。
- Context-cost visibility: the composer's context ring now measures against a 30k-token cost-health line (the 1M model window always looked healthy); hover shows an estimated $ cost plus raw tokens, and the compact button pulses red past the line.
- Todo panel auto-timing: total round duration is wall-clocked by the panel layer (first appearance → all done), independent of extension duration suffixes.
- Closed-workspace collapsible section in the sidebar with reopen support, plus a Close action in the workspace menu.
- Filtered tree rows render faint/italic so excluded files no longer look identical to normal ones.
- Chat tag chips append at the end of the input (not at the caret); user-message tags moved after the content.
- @ search no longer broadly hides dotfiles — only explicit SEARCH_SKIP entries are excluded.

### 修复 Fixes

- 修复新任务时旧待办残留：agent 从不主动调用 `todo clear`（实测 54 次 add / 0 次 clear），扩展内存里的旧项会在新任务第一次 add 时混入；现在新任务启动时记录旧列表 baseline，后续 setWidget/工具结果自动过滤旧项，只显示新任务的待办；agent 真正 clear 后恢复正常。
- 修复长会话 token 消耗：强化工具结果裁剪（触发阈值 20k→8k token、单结果保留 2k→800 字符），旧工具结果更早被截断，降低缓存未命中时的全量重发体积。
- Fixed stale todos leaking into a new task: the agent rarely calls `todo clear`, so the extension's in-memory list leaked in; the desktop now captures a baseline on each new task and filters stale rows from widget/tool pushes, restoring full lists once the agent actually clears.
- Stronger tool-result pruning (threshold 20k→8k tokens, per-result keep 2k→800 chars) to shrink full re-sends on cache misses.

### 兼容性 Compatibility

- 全部改动使用跨平台 API，Windows/macOS/Linux 通用；未改动任何全局扩展与 skill。
- All changes use cross-platform APIs (Windows/macOS/Linux); no global extensions or skills were modified.

## v0.2.4 (2026-08-02)

### 新功能 Features

- **无 Node 环境完整支持**：Pi Desktop 内置 npm 包 + Electron Node 运行时，用户电脑没有 Node/npm/pi 命令也能安装扩展、初始化全局 pi 配置。检测优先级：系统 pi CLI > 系统 npm/pnpm/bun > 内置 npm——有环境的用户行为不变，无环境用户自动走内置路径。
- 撤回按钮状态持久化：checkpoint 摘要（状态+文件数）落盘，切换会话/重启后历史消息的撤回按钮仍可恢复显示。
- Changes 面板：推送/拉取/拉取更新按钮操作时显示加载中 spinner，不再看起来像卡住。
- Full support for machines without Node/npm: the app ships a bundled npm package and runs it with Electron's bundled Node, so extension installs and global Pi config init work with no system Node. Priority is system pi CLI > system npm/pnpm/bun > bundled npm — existing setups keep today's behavior, Node-less machines get the bundled path automatically.
- Revert-button state is persisted (status + file count), so history keeps its revert button across session switches / app restarts.
- Changes panel: fetch/pull/push buttons show a spinner while the operation runs.

### 修复 Fixes

- 修复吸顶时机不准：吸顶判断改用真实 DOM 测量（原来用估算高度，消息只滚出一半就提前吸顶），现在整条用户消息完全滚出视口才吸顶。
- 修复待办扩展因字符串引号嵌套语法错误导致 `Tool todo not found`：扩展加载失败时 todo 工具缺失；已修复并回滚待办扩展到基础版（批量/计时/总用时等增强不再依赖全局扩展，遵守“不改全局扩展”原则）。
- Fixed sticky-pin timing: uses real measured layout offsets (the estimate over-counted card height, pinning half-scrolled messages); now the whole user row must be fully above the viewport.
- Fixed `Tool todo not found` caused by a quote-nesting syntax error in the global todo extension; the extension was also rolled back to its baseline (batch/timing enhancements no longer live in global extensions).

### 兼容性 Compatibility

- 全部改动使用跨平台 API，Windows/macOS/Linux 通用；有系统 Node 的环境完全不受影响。
- All changes use cross-platform APIs (Windows/macOS/Linux); systems with Node keep today's behavior unchanged.

## v0.2.3 (2026-08-02)

### 修复 Fixes

- 修复会话信息弹窗「读取的文件」统计不显示：解析工具卡片时参数传错导致异常被吞，现正确解析 read 工具调用并去重展示，点击可预览
- 修复启动时 Chromium 缓存目录被锁报错（"Unable to move the cache: access denied"）：启动早期自动清理不可用的缓存目录；dev 版改用独立 userData 目录（与打包版共存不再互锁）；打包版保留单实例锁
- 修复聊天过程折叠逻辑：中间含文本时不再断折，最新回合从用户消息到最后一个工具/思考行之间的全部内容（含过程文本）统一折叠，只保留最终答案
- 修复待发送队列编辑后出现双套消息、意外撤回按钮、agent 卡死：编辑队列项不再把输入框残留内容误入队；同一会话的 prompt 严格串行发送，杜绝并发打乱 worker 状态与 checkpoint 关联
- 修复撤回按钮误显示：没有修改文件时不再出现撤回按钮（checkpoint 关联错误已随串行发送解决）
- 修复用户消息重新编辑后发送丢失后续内容：编辑后作为新消息追加发送，历史保留
- 修复录音后光标丢失：录音/停止/取消/确认按钮全部改为不夺焦（mousedown.prevent），转写完成后光标回到编辑框；转写文本插入光标位置（无光标则末尾）
- 修复 Running 面板终端空白：命令回显到终端（$ command），无输出的命令也能看到执行内容，且不污染 LLM 工具结果
- 修复测试在带 PI_DESKTOP_PI_CLI_PATH 环境变量时失败：测试显式传空环境，不再依赖宿主环境
- 修复待办最后一项不更新：agent 回合结束时自动完成仍进行中的项并计时（注：工具层增强随扩展回滚移除）
- Fixed the session-info “files read” stat not rendering (tool-card args were passed wrong, exception swallowed); read calls are now parsed, deduped and previewable.
- Fixed startup “Unable to move the cache: access denied” (locked Chromium cache dirs): unusable cache dirs are reset early; dev builds get their own userData dir so they coexist with the packaged app; packaged builds keep the single-instance lock.
- Fixed process folding breaking when mid-process text existed — the whole latest turn (tools + thinking + interleaved text) now folds to one summary, keeping only the final answer.
- Fixed duplicate sends / stray revert buttons / frozen agent after editing a queued item: editing no longer re-enqueues stray composer content, and prompts are strictly serialized per session so the worker and checkpoint state can't race.
- Fixed stray revert buttons on user bubbles that never modified files (checkpoint association is now safe under serialized sends).
- Fixed re-edit of a user message wiping later history: the edited text is sent as a new appended message.
- Fixed caret loss after dictation: mic/stop/cancel/confirm buttons never steal focus (mousedown.prevent), transcript is inserted at the caret (fallback: end), then focus returns to the editor.
- Fixed empty Running-panel terminals: the command is echoed into the terminal ($ command) even when it produces no stdout, without polluting the LLM's tool result.
- Fixed tests failing when PI_DESKTOP_PI_CLI_PATH is set in the host environment (tests now pass an explicit empty env).
- Fixed the last todo never updating: agent_end auto-completes any still-active item and records its duration (tool-layer enhancement later removed with the extension rollback).

### 新功能 Features

- 会话结束卡片显示统计：用时 · 总 token · token/秒（行内紧凑显示，悬停看完整信息，i18n 中英文案）
- 用户消息改为明显的右侧卡片（恢复卡片化），长内容可展开/收起；吸顶时整卡吸顶同样支持展开
- 待办面板 UI 升级：编号显示、进行中 spinner、已完成/未完成混排（注：批量/计时/总用时等工具层增强随扩展回滚移除）
- 聊天列表布局优化：行类型化间距 + 工具行左侧缩进竖线弱化，思考/工具/正文层次清晰
- 流式回答文本 shimmer 高亮扫过动画（尊重 prefers-reduced-motion）
- Turn stats on the finished assistant card: duration · total tokens · tokens/sec (compact inline, full info on hover, i18n).
- User messages are now clear right-aligned cards again with expand/collapse for long content; the sticky header pins the whole card and folds too.
- Todo panel UI upgrade: numbered rows, in-progress spinner, mixed open/done order (tool-layer batch/timing enhancements later removed with the extension rollback).
- Chat list layout: typed row spacing + indented tool rows with a left rule so thinking/tools/answer read cleanly.
- Streaming answers get a soft shimmer sweep (respects prefers-reduced-motion).

### 兼容性 Compatibility

- 全部改动使用跨平台 API，Windows/macOS/Linux 通用；既有 macOS 适配保持不变。
- All changes use cross-platform APIs (Windows/macOS/Linux); existing macOS adaptations are unchanged.

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
