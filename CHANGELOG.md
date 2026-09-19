# Changelog

## v0.3.4-rc.5 (2026-09-19)

本版重点：设置 → 关于页新增贡献者名单——头像按提交数排名展示，点开可看提交数、仓库内排名与首次/最近提交时间，并可一键打开其 GitHub 主页。

### 新功能 Features

- **关于页新增贡献者名单**（设置 → 关于）：列出仓库贡献者头像与用户名，按提交数排名；点击头像打开详情卡，显示提交数、仓库内排名、首次与最近提交日期，并可打开其 GitHub 主页。头像由主进程走代理拉取并缓存，离线时回退为字母占位。

- **Contributors list on the About page** (Settings → About): lists contributor avatars and usernames ranked by commit count. Clicking an avatar opens a detail card with commit count, repo rank, first and latest commit dates, and a link to the GitHub profile. Avatars are fetched through the configured proxy and cached by the main process, falling back to an initial-letter placeholder when offline.

## v0.3.4-rc.4 (2026-09-19)

本版重点：新增「快捷键」设置页——应用级快捷键都能改键、单独开关，也能用总开关一键停用；同时补齐一份内置快捷键参考清单，并把 `Ctrl+=` 让给「切换模式」。

### 新功能 Features

- **新增「快捷键」设置页**（设置 → 快捷键）：完整列出应用快捷键，支持录制改键（按下组合键即改，`Esc` 取消）、单项启用/禁用、恢复默认，以及**总开关**（关闭后所有快捷键失效、配置保留）；键位与其它快捷键重复时行内标红提示，配置存本地、重启后保留。

- **11 条可自定义快捷键**：新建会话 `Ctrl+N`、修改权限 `Ctrl+M`（循环权限档位）、新建终端 `` Ctrl+` ``、关闭终端 `Shift+Esc`、打开文件 `Ctrl+E`、打开/关闭右侧栏 `Ctrl+Alt+B`、右侧栏文件 `Ctrl+P`、切换模型 `Ctrl+Shift+M`、打开设置 `Ctrl+,`、切换思考程度 `Ctrl+I`、切换模式 `Ctrl+=`（后三条为循环切换）。

- **内置快捷键参考清单**：设置页新增「应用 / 输入框与列表 / 菜单与系统」三组只读清单，把项目自带、不可改键的快捷键一并列出（`Ctrl+Alt+E` 最大化编辑器区、`Ctrl+Alt+L` 详情面板、`Ctrl+S` 保存、`F12`、`Ctrl+Alt+Y` 语音唤醒、`Enter` / `Shift+Enter` / `↑↓` / `Tab` / `Esc`、`Ctrl+Z` / `Ctrl+Y` / `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+A`、`Ctrl+R`、`Ctrl+0` / `Ctrl+-`、`F11`、`Ctrl+W`）。

- **New "Keyboard" settings page** (Settings → Keyboard): lists every application shortcut with record-to-rebind (press the combo, `Esc` to cancel), per-shortcut enable/disable, reset to default, and a **master switch** that turns all shortcuts off while keeping your bindings. Duplicate combinations are flagged inline, and bindings persist locally across restarts.

- **11 rebindable shortcuts**: new session `Ctrl+N`, cycle permission `Ctrl+M`, new terminal `` Ctrl+` ``, close terminal `Shift+Esc`, open file `Ctrl+E`, toggle right pane `Ctrl+Alt+B`, right pane files `Ctrl+P`, switch model `Ctrl+Shift+M`, open settings `Ctrl+,`, cycle thinking level `Ctrl+I`, cycle mode `Ctrl+=`.

- **Built-in shortcut reference**: three read-only groups (App / Composer and lists / Menu and system) listing the shortcuts the app ships with — `Ctrl+Alt+E`, `Ctrl+Alt+L`, `Ctrl+S`, `F12`, `Ctrl+Alt+Y`, `Enter` / `Shift+Enter` / `↑↓` / `Tab` / `Esc`, `Ctrl+Z` / `Ctrl+Y` / `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+A`, `Ctrl+R`, `Ctrl+0` / `Ctrl+-`, `F11`, `Ctrl+W`.

### 变更 Changes

- 主进程菜单的 Zoom In 不再占用 `Ctrl+=`（改为仅菜单点击），把该组合让给「切换模式」；`Ctrl+-` 缩小与 `Ctrl+0` 重置缩放保持不变。

- The menu's Zoom In no longer binds `Ctrl+=` (menu click only) so the combination is free for "switch mode"; `Ctrl+-` and `Ctrl+0` still work as before.

## v0.3.4-rc.3 (2026-09-19)

本版重点：更新下载改为并行分片，安装包下载速度提升一个量级并支持随时取消；同时补齐代理设置的生效范围——主进程派生的 npm / git / Pi CLI 等子进程此前会绕过代理直连。

### 新功能 Features

- **更新下载可以取消**：下载中「下载并安装」按钮变为「取消下载」，点击后立即中止（实测 26 毫秒返回），未完成的 `.part` 文件自动清理；取消后按钮回到可重新下载的状态。

- **Cancel an in-flight update download**: while downloading, "Download & install" turns into "Cancel download". Clicking it aborts immediately (measured 26 ms), the partial `.part` file is removed automatically, and the button returns to a fresh download.

### 性能优化 Performance

- 安装包下载改为 **32 路并行分片**（HTTP Range）：各连接写入自己的文件偏移、逐片校验长度，小文件自动减少分片；实测 138 MB 安装包从单连接的 0.7 MB/s 提升到 15 MB/s 左右。

- Installer downloads now use **32 parallel range requests**: each connection writes its own offset, every segment is length-checked, and small files automatically use fewer segments. A real 138 MB package measured about 15 MB/s, up from 0.7 MB/s on a single connection.

### 修复 Fixes

- 修复代理设置对部分请求不生效：此前只有 Chromium 侧的请求和会话 worker 走代理，主进程派生的 npm / git / Pi CLI / 插件安装等子进程会直连；现在启动与设置变更时都会把代理写入主进程环境、子进程直接继承，MCP 连接测试也改走 Chromium 网络栈。
- 修复更新下载取消后卡住数秒：中止时立即停止写盘与进度广播、立刻断开所有分片连接，等分片收尾后再清理临时文件（取消耗时实测从约 3 秒降到 26 毫秒）。
- 修复取消后进度条显示成 100%：取消后不再渲染进度条与字节数，只保留「已取消下载」提示。
- 更新下载的 Node 侧分片请求同样遵循代理设置，socks 代理自动回退为单连接下载。

- Fixed proxy settings not covering every request: only Chromium-side requests and session workers used to honor the proxy, while subprocesses spawned by the main process (npm, git, the Pi CLI, plugin installs) went direct. The proxy is now written into the main process environment on startup and on every change so subprocesses inherit it, and the MCP connection test goes through the Chromium network stack.
- Fixed the update download hanging for seconds after cancellation: aborting now stops disk writes and progress broadcasts at once, tears the segment connections down immediately, and waits for segments to settle before removing the temporary file (about 3 s down to 26 ms).
- Fixed the progress bar jumping to 100% after cancelling: the bar and byte counter are no longer rendered once cancelled, only the "Download cancelled" line remains.
- Node-side segment requests for the updater now honor the proxy too, with socks proxies falling back to a single-connection download.

## v0.3.4-rc.2 (2026-09-18)

本版重点：流式输出链路优化——回答渲染改为增量分块、会话事件按帧合并，长回答不再越写越卡；并新增「流式渲染」设置（设置 → 外观 → 界面），可开关该优化并单独调节渲染节流间隔。

### 新功能 Features

- **新增「流式渲染」设置**（设置 → 外观 → 界面）：开关默认关闭（关闭时完全走旧版渲染路径），并可单独调节 markdown 渲染节流间隔（40 / 60 / 90 / 120 / 200 毫秒，默认 90）。开关与参数改完即时生效，已打开的会话无需重启。

- **问答卡片支持折叠**：agent 的「向用户提问」卡片头部改为可点击的折叠开关，右侧箭头指示展开状态；收起后只保留标题栏与进度，问题选项与操作按钮一并隐藏，新的提问到来时会自动展开。

- **标题栏显示运行身份**：设置 → 界面新增「显示权限级别」开关（仅 Windows 显示，默认关闭）。开启后标题栏在应用名后显示当前进程的运行身份：普通用户为系统账户名（如 `(MIAN)`），管理员为 `(Admin)`，SYSTEM 账户为 `(System)`。

- **New "Streaming render" settings** (Settings → Appearance → Interface): the switch is off by default (off keeps the legacy render path), with a separate markdown render throttle (40 / 60 / 90 / 120 / 200 ms, default 90). Both apply immediately, including to sessions that are already open.

- **Collapsible "Ask user" card**: the clarification card header is now a clickable toggle with a chevron; collapsing it keeps only the title bar and progress, hiding the question and its buttons, and the card expands again automatically when a new question arrives.

- **Run identity in the title bar**: a new "Show privilege level" switch in Settings → Interface (Windows only, off by default). When enabled, the title bar shows the current process identity after the app name: the system account name for a standard user (like `(MIAN)`), `(Admin)` when elevated, or `(System)` under the SYSTEM account.

### 性能优化 Performance

- 流式回答改为**增量分块渲染**：已完成的段落只解析一次，仅最后一段随内容增长重解析，不再每次刷新都对整篇回答重跑 markdown + 代码高亮 + 消毒；渲染范围与旧版逐帧一致，所见内容不变。
- 会话 worker 的流式快照**按帧合并**（开关开启时生效）：每 40ms 只发最新一帧，不再每个 token 都把整段累积内容跨进程传输三遍。

- Streaming answers now use **incremental block rendering**: finished paragraphs are parsed once and only the last paragraph is re-parsed as it grows, instead of re-running markdown + syntax highlighting + sanitizing over the whole answer on every tick. The rendered range matches the legacy behaviour frame by frame.
- Session workers **coalesce streaming snapshots** (when the switch is on): only the newest frame is sent every 40 ms, instead of shipping the whole accumulated message across process boundaries for every token.

### 修复 Fixes

- 修复待办面板点「继续任务」后聊天里出现两条提示词：按钮现在直接把「继续任务」四个字发给 agent，不再额外构造一段独立指令——气泡与 agent 实收内容一致，回显不会再重复成第二条。

- Fixed the todo panel's "Continue task" button producing two prompts: it now sends the "Continue task" text itself instead of a separately built instruction, so the bubble matches what the agent receives and the echo is no longer duplicated as a second message.

### 打包与体积 Packaging

- 修复安装包夹带本地文件：`.pi-glla`（会话与 owner 数据）、`scratch_*`、自定义打包输出目录、工作区源码等此前会被打进 `app.asar`，现已全部排除。
- 安装包瘦身：剔除仅供渲染进程使用、且已随前端一并打包的重复依赖（mermaid 的传递依赖，约 14 MB）；编辑器内置语言定义只保留实际用到的 21 种。
- 新增快速打包命令：`npm run dist:win:x64:fast`（低压缩出包，明显更快）与 `npm run pack:win:x64`（跳过重新构建，仅打包）。
- 修复打包时 `release/**/app.asar` 被运行中的应用锁住导致 EBUSY：工作区扫描、每轮对话的检查点快照、文件预览、Git 面板与编辑器保存此前都会让 Electron 打开并缓存这些 asar 归档的句柄，现在工作区文件访问一律绕过 asar 层，且打包输出目录 `release/` 不再参与文件树、搜索、文件监听与检查点扫描，构建产物不再被锁定。

- Fixed the installer shipping local files: `.pi-glla` (session and owner data), `scratch_*`, custom packaging output directories and workspace sources used to be packed into `app.asar`; all of them are excluded now.
- Smaller installer: duplicated dependencies used only by the renderer (mermaid's transitive deps, about 14 MB) are gone, and the editor ships only the 21 built-in languages it actually maps.
- New fast packaging commands: `npm run dist:win:x64:fast` (low-compression, much faster) and `npm run pack:win:x64` (packaging only, no rebuild).
- Fixed packaging failing with EBUSY on `release/**/app.asar`: workspace scans, per-turn checkpoint snapshots, file previews, the Git panel and editor saves used to make Electron open and cache handles on those archives. Workspace file access now bypasses the asar layer, and the packaging output directory `release/` no longer takes part in the file tree, search, watcher or checkpoints, so build outputs are no longer locked.

## v0.3.4-rc.1 (2026-09-18)

本版重点：界面上的悬停提示统一改由应用内浮层渲染（不再使用系统原生 `title`），并修复壁纸模式下浮层文字被磨砂层糊掉、下拉菜单先闪一帧清晰背景的问题。

### 新功能 Features

- **统一悬停提示**：新增全局 `AppHoverTip`，接管控件上的 `title` 并改由应用内浮层显示——跟随元素定位、350ms 延迟（贴近系统原生节奏），指针移出或元素消失时把 `title` 原样还原。

- **Unified hover tips**: a new global `AppHoverTip` takes over `title` attributes and renders them through one in-app tooltip — anchored to the element, shown after a 350 ms delay (matching the native feel), and restored untouched when the pointer leaves.

### 修复 Fixes

- 修复壁纸模式下提示 / 下拉菜单 / 选择菜单的文字被磨砂层一起糊掉：模糊伪元素现在落在文本之下（`z-index: -1` 配合 `isolation: isolate`）。
- 修复壁纸模式下浮层先闪一帧清晰壁纸再变磨砂：浮层的淡入与缩放过渡在壁纸模式下直接以最终形态出现。

- Fixed wallpaper mode blurring the text of tooltips, dropdown menus and select menus: the blur pseudo-element now sits below the content (`z-index: -1` with `isolation: isolate`).
- Fixed popovers in wallpaper mode flashing a clear wallpaper frame before the frosted layer landed: their fade/scale transitions now start at the final state.
## v0.3.4 (2026-09-18)

本版重点：设置页全面重做（通用 / 外观 / 模型 / 智能体 / 技能 / 指令 / 挂钩 / MCP / 插件 / 工具 / 关于）；「局域网网页控制台」改名「远程控制」并默认开启局域网访问，公网访问改用 Cloudflare 隧道且支持绑定自己的域名；新增底部多标签终端、派生对话会话树、四档权限模式与自定义外观（背景图 / 透明度 / 消息区宽度）；修复 Windows 上 bash 工具不可用、虚拟滚动错位等一系列问题。

### 新功能 Features

- **「远程控制」取代原「局域网网页控制台」**：入口移入 设置 → 通用，标题栏图标、面板文案与网页端标题统一更名。
- 局域网访问**默认开启**：启动即监听 `http://<本机IP>:18700`，手机/平板浏览器直接可用。
- 登录方式简化为 **9 位数字访问密码**（首次运行自动生成，面板内可查看/复制/一键更换），不再需要用户名密码。
- 新增「公网访问」开关（默认关闭）：打开后由内置 cloudflared 建立 Cloudflare 隧道，生成 `https://<随机名>.trycloudflare.com` 公网地址；TLS 由 Cloudflare 边缘终结，隧道仅转发到 127.0.0.1 的本地端口，并带自动重试与看门狗。
- **支持绑定自己的域名**：填入 Cloudflare 隧道 Token 与公网地址后改用命名隧道，地址固定不变、重启也无需重新分享链接；面板内提供「打开 Cloudflare 隧道页面」按钮与 Token 粘贴，并给出配置步骤。
- 网页版朗读改用**浏览器原生语音合成**（Web Speech API）：零安装、零下载，不占用桌面端语音模型。
- 新增「**思考语言**」设置（设置 → 通用）：自动 / 中文 / 英文，只影响可见思考文本。默认「自动」按界面语言判断——中文界面注入中文思考指令，英文界面不注入。指令作为每轮用户消息的临时块注入，不改动系统提示词。
- 登录失败按来源限速：公网来源 6 次失败锁定 10 分钟，局域网来源独立计数，防止爆破。
- **底部终端面板**：新增底部多标签终端，可选 PowerShell / bash / zsh 等本机 shell，支持新建、切换与关闭标签；已打开的终端在面板折叠与会话切换之间保持，不再每次重开。
- **派生对话**：可从任一用户消息派生出新会话，侧栏以树状嵌套展示父子对话（带连接线与子会话计数，可收起展开），派生标题取自分叉点消息。
- **设置页重做**：分为 通用 / 外观 / 模型 / 智能体 / 技能 / 指令 / 挂钩 / MCP / 插件 / 工具 / 关于；主界面左下角新增外观、模型、MCP、技能、插件、设置快捷入口。
- **定制项编辑**：技能、智能体、指令与提示按空模板新建，支持改名、删除、启停与保存，未保存时给出提示；技能保存前校验 `name` / `description` 写法，不合规直接报错；指令文件支持删除与热重载静音；智能体与技能列表标记当前工作区并列出最近工作区。
- **模型管理**：提供商与模型设置重做并内置平台图标，「挑选模型」弹窗支持点击整行勾选/取消，支持从提供商拉取模型列表与测速，思考等级新增 max 档。
- **MCP 与插件管理**：MCP 服务器支持新增、编辑、删除与可用性测试（含 SSE）；插件页显示本地与最新版本，支持检查更新、并发升级（带进度）、启停开关与打开安装目录，并兼容 npm 12 的 URL 依赖与安装脚本策略。
- **自定义外观**：新增自定义背景图（图片 / GIF / WebP / 视频）、遮罩透明度与模糊、输入框 / 卡片 / 设置页 / 工具卡片透明度、消息区宽度档位（默认 75%）；配色对齐 VS Code 2026 Dark/Light。
- **四档权限模式**：输入框底部在 **Ask / Edits / Auto / Yolo** 间切换，取代旧的权限设置与工作区信任对话框；危险命令仍需确认，工具被拦截时给出可读提示。
- **工作区分类与会话归档**：工作区支持自定义分类（新建 / 重命名 / 删除 / 移动到分类）；会话支持归档（含「超过 N 天」批量归档）与已归档列表（可搜索、可恢复）；会话列表支持多选与 Shift 范围选择，可批量删除。
- **草稿模式**：新建会话进入草稿即后台预热 worker，首条消息不再等冷启动；草稿在切换会话或反复新建后保留，草稿上下文栏可切换工作区与分支。
- **每轮文件改动汇总**：每轮对话结束展示本轮实际改动的文件与数量，更改面板拆分为独立更改页签与 diff 编辑器。
- 问答（ask_user）改为对话内问答卡片：单选 / 多选 / 按钮与可选自定义输入，切换会话再回来保持答题进度。
- 外观新增「会话详细显示」「消息预览」「消息预览图片」开关；工具输出预览截断可选行数。
- 编辑器与预览跟随工作区外文件实时刷新，Monaco 增加当前行高亮与右键菜单。

- Renamed the LAN web console to **Remote Control**, now living under Settings → General; the panel copy and web page title follow.
- LAN access now defaults to **on** (`http://<pc-ip>:18700`), so a phone on the same network works out of the box.
- Login is a single **9-digit access PIN** (auto-generated on first run, visible/copyable/rotatable in the panel) instead of username + password.
- New **Public access** switch (off by default): the bundled cloudflared opens a Cloudflare tunnel on demand, publishing a `https://<random>.trycloudflare.com` URL (TLS terminated at Cloudflare's edge). The tunnel only ever forwards to a loopback port, with automatic retry and a watchdog.
- **Bring your own domain**: a Cloudflare tunnel token plus hostname switches to a named tunnel with a fixed address, so nothing has to be re-shared after a restart. The panel links to the Cloudflare tunnels page, offers token paste, and spells out the steps.
- Read-aloud in the web console uses the **browser's own speech synthesis** (Web Speech API) — nothing to install or download, and the desktop voice model is untouched.
- New **Thinking language** setting (Settings → General): Auto / Chinese / English, affecting visible reasoning text only. "Auto" follows the UI language — a Chinese UI injects a Chinese reasoning instruction, an English UI injects nothing. The instruction is sent as a transient per-turn user-message block; the system prompt is untouched.
- Failed logins are rate limited per client — 6 attempts then a 10-minute lock, counted separately for tunnel traffic.
- **Bottom terminal panel**: a multi-tab terminal with PowerShell / bash / zsh and friends, supporting new / switch / close tabs; open terminals survive collapsing the panel and switching sessions instead of being recreated.
- **Forked conversations**: fork a new session from any user message; the sidebar nests parent and child conversations as a tree (connector lines, child counts, collapse/expand), and the fork title comes from the branching message.
- **Rebuilt settings**: General / Appearance / Models / Agents / Skills / Instructions / Hooks / MCP / Plugins / Tools / About, plus quick entries for appearance, models, MCP, skills, plugins and settings in the bottom-left corner.
- **Editable customizations**: skills, agents, instructions and prompts start from a blank template, with rename, delete, enable/disable and save plus an unsaved-changes hint; skill saves validate the `name` / `description` format and report errors instead of writing garbage; instruction files can be deleted and hot-reloaded silently; agent and skill lists mark the current workspace and list recent workspaces.
- **Model management**: provider and model settings rebuilt with built-in platform icons, a model picker that toggles by clicking the whole row, model fetching from the provider, latency/speed probes, and a new `max` thinking level.
- **MCP and plugin management**: MCP servers can be added, edited, deleted and tested for availability (including SSE); the plugin page shows local vs latest version, supports update checks, concurrent upgrades with progress, enable/disable switches and opening the install directory, and works with npm 12's URL dependency and install-script policy.
- **Custom appearance**: background image (picture / GIF / WebP / video), veil opacity and blur, input / card / settings / tool-card transparency and message-area width presets (75% default); colors follow VS Code 2026 Dark/Light.
- **Four permission modes**: pick **Ask / Edits / Auto / Yolo** at the bottom of the composer, replacing the old permission settings and workspace trust dialog; dangerous commands still need confirmation and blocked tools explain themselves.
- **Workspace groups and session archiving**: workspaces support custom groups (create / rename / delete / move), sessions can be archived (including "older than N days" in bulk) and reviewed in an archived list with search and restore, and the session list supports multi-select with Shift ranges for bulk delete.
- **Draft mode**: a brand-new session pre-warms its worker while still a draft, so the first message no longer waits for a cold start; drafts survive session switches and repeated new-session clicks, and the draft context bar switches workspace and branch.
- **Per-turn change summary**: every finished turn lists the files it actually changed, and the changes panel is split into its own tab with a diff editor.
- The ask_user prompt is now a card inside the conversation (single / multi / button choices plus optional custom input) and keeps its progress across session switches.
- New "session details", "message preview" and "preview images" switches in appearance; tool-output preview truncation takes a configurable line count.
- Editors and the preview pane follow external file changes live, and Monaco gains current-line highlight and a context menu.

### 变更 Changes

- 局域网改为普通 HTTP：不再生成自签名证书，手机首次打开没有「证书不受信任」警告；代价是局域网内不加密，请只在可信网络使用。公网地址仍为 HTTPS。
- 隧道进程改由官方 `cloudflared` npm 包托管（二进制仍由应用自行获取并实跑校验），删掉手写的下载/解压逻辑。
- 网页版移除录音/语音输入（麦克风按钮、PCM 采集、`/api/transcribe` 代理与桌面 ASR 调用），桌面端语音输入不受影响；朗读改为浏览器实现保留。
- **回复中发送的内容改为「引导」语义**：不再排队等下一轮，而是立即注入当前这轮，Pi 会在下一个 LLM 调用前看到它并据此继续推理。
- 移除 `selfsigned` 依赖（其 v5 在当前依赖树中无法生成证书）。
- 移除「回答语言」设置，只保留「思考语言」。
- 移除工作区「关闭」功能：菜单项、已关闭工作区区块与相关状态一并删除；工作区菜单去掉「打开文件夹」，改为「重新定位」与「重命名项目」。
- 移除标题栏的远程控制、打开工作区与主题切换按钮，移除侧栏左下角文件列表与添加工作区按钮。
- 底部终端面板不再默认打开。
- 移除设置中的提示页与部分说明文案，精简关于面板（移除作者信息与更新入口）。
- 文件图标改用字形映射，移除独立的文件类型图标组件。
- 切换界面语言改为静默切换，不再显示加载页。

- The LAN side now uses plain HTTP: no self-signed certificate is generated and phones see no certificate warning. The trade-off is unencrypted LAN traffic, so use it on a trusted network; the public URL is still HTTPS.
- The tunnel process is now driven by the official `cloudflared` npm package (the app still obtains and executes the binary to verify it), replacing hand-written download/unpack code.
- Removed voice recording from the web console (mic button, PCM capture, the `/api/transcribe` proxy and the desktop ASR call). Desktop voice input is unchanged; read-aloud is kept via the browser.
- Messages sent **while Pi is replying** are now delivered as guidance into the running turn instead of waiting for the next one.
- Dropped the `selfsigned` dependency (its v5 build cannot issue certificates in this dependency tree).
- Removed the "response language" setting; only "thinking language" remains.
- Removed the workspace "close" feature (menu item, closed-workspace section and state); the workspace menu drops "open folder" in favor of "relocate" and "rename project".
- Removed the titlebar remote-control, open-workspace and theme buttons, and the file list plus add-workspace button in the sidebar footer.
- The bottom terminal panel no longer opens by default.
- Removed the settings hint page and several explanatory blurbs, and trimmed the About panel (no author info or update entry).
- File icons come from a glyph map instead of a dedicated file-type icon component.
- Switching the UI language is now silent — no loading page.

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
- 修复长「摘要/工作过程折叠块」**收起后原地留下一大片空白**（长摘要尾部折叠后渲染高度骤降，虚拟滚动把视口留在了 spacer 估算出的空白区，严重时整屏发白）：贴底挂载窗口现在按估算高度一直向上补到能盖住视口，行高变化（折叠/展开）后立即把视口所在的 spacer 区域补挂成真实行；收起后**滑到消息区最顶部不再被 spacer 空白顶住**（窗口裁剪只在被裁的行完全离开视口时才执行，且每次窗口变化后都继续补挂到视口被真实内容盖住）。
- 修复虚拟滚动**上滑读历史时被自动拉回底部**：窗口变更后的位置补偿原本用「总高度差」，会把窗口内其它行的内容增长（流式输出、异步 Markdown）和 spacer 高度估算误差一起算进来，于是每展开一段历史、每来一段输出，视口就往下漂一段。现在按视口内首/尾锚点行的真实位移补偿，实测零漂移；同时上滑意图覆盖滚轮、键盘、触摸和拖动滚动条，会话切换的自动贴底在用户上滑时整体取消。
- 修复派生对话：父子关系与分叉内容取错，且对话进行中无法派生；现在可从任一用户消息派生，派生标题取自分叉点消息，还原检查点改为回退到本轮结束。
- 修复思考程度切换后会自动改回 high；修复会话 running 卡死导致检查点 / 派生按钮消失（重载时用主进程状态校准）。
- 修复「等待模型响应…」状态下停止按钮无法点击，以及模型思考/输出过长时会话卡顿、界面无法交互。
- 修复历史消息耗时显示 0.0s 与 token/s 异常：改用落盘时间为账号计算轮次时长，重启后耗时与 token 统计不再丢失。
- 修复文件更改数据显示不准确：改为展示本轮实际更改数而非累计值。
- 修复输入框选中文本后粘贴无法替换选区，以及隐藏 API Key 时无法输入。
- 修复 Monaco 主题未生效导致编辑器回退白色、编辑器背景未应用主题。
- 修复设置页打开文件显示为空，以及智能体设置页列表被撑出窗口后整页空白。
- 修复问答卡片普通选项被强制填写自定义内容、切换会话再回来进度重置为第 1 题，以及待办「继续任务」点击后不生效。
- 修复插件检查更新状态在切换页面或退出设置后丢失，以及升级后整页刷新、列表加载报错。
- 修复代理未生效：Node 侧 fetch 与下载请求统一走代理，代理变更后回收 worker。
- 修复禁用提供商无效；修复 Ctrl+Z 对 Ctrl+V 粘贴内容无效。

- Fixed the **bash tool being unusable on Windows** (`execvpe(/bin/bash) failed: No such file or directory`): its shell fallback picked `bash.exe` from PATH, which is the WSL launcher. A real bash (Git Bash) is now preferred; otherwise the app switches to the built-in PowerShell tool and denies the broken `bash` tool.
- Fixed the model picker being locked in a **brand-new session that had sent nothing**: it trusted a session-summary status field that can lag; it now follows the live streaming state only.
- Fixed a message sent during a reply appearing to vanish from the UI: it now shows as a pending card until the agent takes it.
- Fixed the model switcher dropdown **not scrolling**: with hundreds of models the menu grew past the window and lower models were unclickable; it is now height-capped (60vh/460px) and scrolls internally.
- Fixed the sidebar occasionally showing an extra blank workspace: a blank path resolved via `path.resolve("")` becomes the app's own working directory, i.e. a nameless workspace entry. Blank/whitespace-only paths are now rejected both when reading and writing workspace state (which also purges leftovers from older builds), and the IPC boundary, renderer store, LAN web panel and sidebar each filter independently, so no layer can render a blank workspace.
- Fixed public access getting stuck on "disconnected / reconnecting" after a successful login: the tunnel origin listener had no WebSocket server attached, so `wss://xxx.trycloudflare.com/ws` fell through to the plain HTTP handler and returned 404. Both listeners (LAN and tunnel origin) now mount their own WebSocket server, so the public connection stays up.
- Fixed packaged builds failing to find the bundled cloudflared: paths inside the app archive report as existing yet cannot be executed, and packaging flattens the per-arch directory. Both layouts are handled and the binary is executed (`--version`) before use.
- Fixed the watchdog declaring cloudflared "not running" while it was still downloading, which aborted the download and left a broken binary; retry backoff no longer collapses into a fixed 5-second loop.
- Fixed duplicated message keys in the locale files (a build warning whose duplicate silently overrode the original) and added automated checks so it cannot come back.
- Fixed a long work-section summary leaving **a large blank area after collapsing** (a folded long section drops most of its rendered height, and the virtual scroller left the viewport inside a spacer-sized gap — sometimes the whole view). The bottom-pinned window now mounts rows upward until it covers the viewport, and any row-height change (fold/unfold) immediately backfills the spacer region the viewport sits in. Scrolling to the **very top after collapsing no longer parks the viewport on a spacer**: the window only trims rows that are fully outside the viewport, and every window mutation keeps backfilling until real rows cover the view.
- Fixed virtual scrolling **yanking the viewport back to the bottom while reading history**: window mutations were compensated from the total scrollHeight delta, which folds in unrelated height changes inside the window (streaming output, async markdown) plus spacer estimate errors — so every expansion and every streamed chunk pushed the viewport further down. Compensation now follows the first/last visible row's real displacement (measured zero drift); the scroll-up intent now covers wheel, keyboard, touch and scrollbar drags, and a session's auto bottom-snap is cancelled when the user scrolls up.
- Fixed forked conversations: parent/child links and the forked content were resolved incorrectly and forking was blocked mid-turn; forking now works from any user message, the fork title comes from the branching message, and restoring a checkpoint rewinds to the end of that turn.
- Fixed a thinking-level change silently snapping back to high, and sessions stuck in `running` making the checkpoint / fork buttons disappear (state is calibrated against the main process on reload).
- Fixed the stop button being unclickable while "waiting for the model", and the UI freezing when the model reasons or streams an unusually long answer.
- Fixed history showing `0.0s` duration and wrong tokens/sec: turn duration now derives from persisted timestamps, and duration/token stats survive restarts.
- Fixed inaccurate file-change counts: the turn's actual changed files are shown instead of a running total.
- Fixed paste not replacing the selected text in the composer, and the API key field refusing input while the key is hidden.
- Fixed the Monaco editor falling back to a white background because the theme was not applied.
- Fixed the settings file viewer opening empty, and the agent settings page rendering blank after its list grew past the window.
- Fixed ask_user forcing custom input for plain options, the card resetting to question 1 after a session switch, and the todo "continue task" button not driving the agent.
- Fixed plugin update state being lost when leaving the settings page, and a whole-page refresh plus list-loading error after upgrading.
- Fixed the proxy not taking effect: Node-side fetch and download requests now both honour it, and the worker is recycled when the proxy changes.
- Fixed disabling a provider having no effect, and Ctrl+Z not undoing pasted content.

### 优化 / 体验 Improvements

- 端口被占用、页面未构建等启动失败会在面板内说明原因，并在 20 秒后自动重试一次。
- 面板新增公网地址状态（连接中/已就绪/失败原因与重试按钮）；短时间来回开关会保留同一地址。
- 隧道沿用 cloudflared 默认传输协议：实测强制 `--protocol http2` 会让临时地址持续不可达，因此不强制。
- 隧道状态变化（上线/断开/报错及公网地址）写入日志便于排查。
- 启动日志会打印本机实际使用的命令 shell，便于排查命令执行问题。
- 新会话不再被 worker 冷启动阻塞：进入草稿即后台预热，模型解析走可用快照，扩展钩子提前预热。
- 切换工作区不再卡顿：工作区根目录先切换，最近工作区列表改为后台刷新。
- 设置页加载优化：快照磁盘缓存 + 启动预热。
- 侧栏会话标签用颜色区分运行 / 等待回答 / 刚结束三态；展开收起按钮改为悬停时占位显示并带会话数；点击工作区文件夹不再自动打开第一个会话。
- 更改列表文件名优先展示；压缩按钮文案改为「显示上下文压缩按钮」。
- 壁纸模式下终端区、编辑器区域与运行面板输出区跟随面板色透明，下拉浮层模糊改由伪元素承担。

- Startup failures (busy port, missing build) now explain themselves in the panel and retry once after 20 seconds.
- The panel shows the public URL state (connecting / ready / error with retry), and toggling off/on quickly keeps the same address.
- Tunnel traffic uses cloudflared's default transport: forcing `--protocol http2` was measured to make the temporary address unreachable, so it is not forced.
- Tunnel transitions (up / down / error, with the public URL) are logged for diagnosis.
- The startup log prints which command shell was chosen, making shell problems diagnosable.
- New sessions are no longer blocked by a cold worker: the draft pre-warms in the background, model resolution uses an available snapshot, and extension hooks pre-warm early.
- Switching workspaces no longer stutters: the workspace root switches first and the recent-workspace list refreshes in the background.
- The settings page loads faster thanks to a cached snapshot plus startup pre-warming.
- Sidebar session chips are colour-coded for running / waiting-for-answer / just-finished; the expand-collapse button only takes space on hover and shows the session count; clicking a workspace folder no longer auto-opens its first session.
- The changes list leads with the file name, and the compact button is labelled "show context compact button".
- With a wallpaper the terminal, editor and running-panel output follow the panel colour and go transparent, and dropdown blur moved onto a pseudo-element.

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
