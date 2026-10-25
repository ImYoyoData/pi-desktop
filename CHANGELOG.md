# Changelog

## v0.3.6-rc.4 (2026-10-25)

本版重点重做过程区可视化：工具结果按语义分型渲染（文件视图 / 词级 diff / 终端卡 / JSON 树），工作区块展开即为过程时间线，思考行支持 Markdown、字数与实时耗时；同时新增浏览器直连 dev 页面的开发预览桥、内置工具使用偏好引导与流式渲染 0ms 实时档，并修复上一轮过程内容被裁掉、思考过程中停止自动滚动、JSON 树与结构化输出交互、安装器目录修正后快捷方式未同步与运行中会话抢位等问题。

### 新功能 Features

- **过程区可视化重做**：工具行改为「动作+目标 / 状态+结果」两行结构，状态行汇总行数、耗时、改动与图片数；展开工作区块即为过程时间线，小节表头统计思考次数。工具结果按语义分型渲染——读取走文件视图（行号 + 高亮），编辑走 diff（词级标记），命令走终端卡（退出码 / 截断提示 / 完整日志路径），其余走 JSON 树、路径清单或脚本报告；展开体紧跟所属步骤，不再掉到整块底部。嵌套调用（codemode 脚本里发出的工具）缩进列出，每条可展开看参数、结果与失败原因。
- **思考行支持 Markdown、字数与耗时**：思考内容按 Markdown 渲染且可折叠；行尾显示字数与耗时，思考中每秒刷新实时耗时，结束后落回 pi 记录的精确值，历史与快照消息（UI 没赶上思考过程）用 pi 记录的耗时兜底。
- **浏览器直连 dev 页面预览**：新增开发桥（主进程 HTTP + SSE），外部浏览器打开 Vite dev 页面即可作为桌面端操作同一份状态——文件、Git、会话、终端都可用。桌面 API 抽成与传输无关的 `src/shared/api.ts`，preload 与预览共用一份接口定义；共享状态统一走 `state:changed` 通道（偏好、工作区与当前会话、模型与流式渲染、思考语言、重试、运行时、代理设置）；桥端口由 Vite 端口派生（+10000），页面启动校验实例标识，连到别的实例时直接提示；桥提供 `/media` 端点（支持 Range、仅本机来源）显示本地壁纸。
- **流式渲染新增 0ms 实时档**：节流档位加入 0（不节流、逐帧渲染），文案显示「实时」/「Realtime」。
- **内置工具使用偏好**：新增内置扩展 `tool-preference`，在 `before_agent_start` 给 grep / find / ls / read / bash 补 prompt guidelines，把内容搜索、读文件与列目录推回内置工具，bash 留给管道、构建、测试与 git。

- **Process area rebuilt**: tool rows now use an "action + target / status + result" two-line layout, collecting line counts, durations, diff stats and image counts on the status line; expanding a work section turns it into a process timeline and the section header counts thinking passes. Tool results render by kind: reads use a file view (line numbers + highlighting), edits use diffs (word-level marks), commands use a terminal card (exit code / truncation notice / full log path), and everything else falls back to a JSON tree, a path list or a script report; expanded bodies stay attached to their step instead of dropping to the bottom of the block. Nested calls (tools issued inside a codemode script) are listed with indentation, and each one expands to its arguments, result and failure reason.
- **Thinking rows render Markdown and show size and duration**: thinking text is rendered as Markdown and can be collapsed; the row shows character count and duration, refreshing live once per second while thinking and settling on pi's recorded value afterwards, with history and snapshot messages (where the UI missed the thinking pass) falling back to pi's recorded duration.
- **Browser preview wired straight to the dev page**: a new dev bridge (main-process HTTP + SSE) lets an external browser open the Vite dev page and drive the same state as the desktop — files, Git, sessions and terminals all work. The desktop API is now transport-agnostic (`src/shared/api.ts`) and shared by the preload and the preview, shared state flows through a single `state:changed` channel (preferences, workspace and active session, models and streaming render, thinking language, retry, runtime, proxy settings), the bridge port derives from the Vite port (+10000) with an instance id checked on page load so a page connected to another instance is told instead of silently drifting, and a `/media` endpoint (Range-capable, local origin only) serves local wallpapers.
- **0 ms realtime streaming option**: the render throttle choices now include 0 (no throttling, per-frame rendering), shown as "实时" / "Realtime".
- **Built-in tool usage preferences**: a new built-in `tool-preference` extension adds prompt guidelines to grep / find / ls / read / bash from `before_agent_start`, steering content search, file reads and directory listings to the built-in tools and leaving bash for pipelines, builds, tests and git.

### 修复 Fixes

- **修复发送下一句后上一轮工具与思考内容被裁掉**：MessageList 原先把最新 user 之前的工具行与纯思考行直接从渲染序列删除，新消息一发出上一轮就不再是最新一轮，工具卡、思考块与小结条整块消失。现在保留全部过程行，由既有分组/折叠逻辑收成可展开的历史小结条。
- **修复思考过程中有时不再自动滚动**：跟随判定只认滚轮、自身滚动条与中键，不再拿内容长高后的滚动距离当用户意图（原先一次超过 48px 就永久停止跟随）；去掉消息区 120px 贴底门限，滚轮落在思考块等内部滚动区不算浏览历史，拖选文本与中键自动滚动期间先让位。
- **修复 JSON 树与结构化输出交互**：JSON 树折叠失效（改为递归渲染 + 路径派生 id）；没有 `diff --git` 的多文件补丁不再把第二个文件头算成增删行；空 diff 不再渲染出空白；目录列表目标去掉末尾斜杠；失败输出与参数兜底文本不再被误判成路径清单。
- **嵌套调用补上失败原因**：嵌套调用展开可看错误原文；工具卡片标签统一为工具名与耗时本地化，不再显示「已读取 / 已编辑」这类动作标签。
- **修复安装目录修正后快捷方式仍指向旧路径**：`$appExe` 按修正前的目录赋值，快捷方式目标、`DisplayIcon` 与 keepShortcuts 判断都取自它，现于目录修正后重新同步。
- **修复会话排序**：固定（pinned）顺序先于最近顺序；折叠状态下拖拽只重排可见行，其余保持相对顺序；运行中的会话不因活动抢位，状态落回 idle 时再按最近活动归位。
- **修复浏览器预览页误响应关闭事件、连带关掉桌面端窗口**。

- **Fixed tool and thinking rows of the previous turn being dropped**: MessageList deleted tool rows and thinking-only rows that preceded the newest user message, so sending a message made the previous turn stop being the newest one and its tool cards, thinking blocks and summary row vanished. All process rows are now kept and grouped/collapsed into an expandable history summary.
- **Fixed auto-scroll stopping during thinking**: follow mode now keys off the wheel, the scroller's own scrollbar and middle-click only, no longer mistaking content growth for user intent (a single jump past 48px used to stop following for good); the 120px bottom threshold is gone, wheel events inside nested scrollers such as thinking blocks no longer count as browsing history, and text selection plus middle-click auto-scroll take precedence.
- **Fixed JSON tree and structured output interactions**: the JSON tree collapses again (recursive rendering with path-derived ids); a multi-file patch without `diff --git` no longer counts the second file header as added/removed lines; an empty diff no longer renders a blank body; directory targets no longer keep a trailing slash; and failure output or argument fallback text is no longer mistaken for a path list.
- **Nested calls show their failure reason**: expanding a nested call shows the raw error, and card labels are now the tool name with localized durations instead of "read / edited" action labels.
- **Fixed shortcuts pointing at the old path after the install directory is corrected**: `$appExe` was assigned from the pre-correction directory and drives shortcut targets, `DisplayIcon` and the keepShortcuts check, so it is re-synced after the directory is fixed.
- **Fixed session ordering**: pinned sessions sort before recent ones; dragging while collapsed reorders only the visible rows and keeps the rest in order; a running session no longer jumps position on activity and returns to its recent-activity slot once its status falls back to idle.
- **Fixed the browser preview responding to close events and closing the desktop window with it**.

### 变更 Changes

- **工具步骤行**：度量（行数、耗时等）紧跟目标显示，展开箭头仍贴行尾；去掉重复的待办进度与重复耗时（耗时只在步骤行展示），步骤标题不可选中。
- **diff 统一为 unified**：pi 的 display diff 在解析时归一化成 unified，渲染层只认一种格式——原先优先取 display diff 会让整张卡片退化成纯文本预览；diff 底色改走主题变量，词级改动加深。
- **codemode 卡片标题改用调用概况**：显示「N 个调用」，不再拿脚本首行代码当标题。

### 变更 Changes (English)

- **Tool step rows**: metrics (line counts, durations) now sit right after the target while the expand chevron stays at the row end; the duplicated todo progress and duration are gone (duration shows on the step row only), and step titles are no longer selectable.
- **Diffs normalized to unified**: pi's display diff is parsed into unified form so the renderer knows one shape only — preferring the display diff used to degrade the whole card into a plain-text preview. Diff backgrounds moved to theme variables and word-level changes are darker.
- **codemode card titles use the call summary**: the title shows "N calls" instead of the script's first code line.

## v0.3.6-rc.2 (2026-10-14)

本版重点：升级 pi SDK 到 1.2.0，适配 `before_agent_start` 新签名，并把按密钥的 OpenRouter 模型列表接进模型页（打开时联网刷新目录）；同时带来 OpenRouter 负价格、MCP 带资源服务器工具注册延迟、上下文压缩可能失败等一批上游修复。另新增联网搜索服务器配置面板、扩展 Hook 事件列表与思考语言设置，会话历史改为分页加载，并修复会话事件流随组件卸载永久中断、桌面端安装包/dev 偏好分家与粘贴文本被改写；移除权限确认网关与命令输出临时文件清理。

### 新功能 Features

- **联网搜索服务器配置**：设置新增「联网搜索」页，可读写 pi 的 `web-search.json` 服务器配置（对应 pi 1.2.0 前置的 web_search 工具链）；代理变更时同步写入该文件的 proxy 字段。
- **扩展 Hook 事件列表**：自定义 → Hooks 页除桌面自身的 Hook 外，列出扩展订阅的 pi 生命周期事件，并按事件名归并订阅的扩展。
- **思考语言设置**：自定义 → 通用页新增思考语言设置。
- **会话历史展示上下文压缩与分支摘要**：消息列表现在解析并展示上下文压缩（compaction）与分支摘要，对应 pi 的 `compaction_end` 事件。
- **配置文件写入 pi 官方 JSON Schema**（pi 1.2.0）：桌面端写入的 `settings.json` / `models.json` 补上 pi 发布的 `$schema` 字段，编辑器可据此校验与补全；用户已写的 `$schema` 保持不动。
- **OpenRouter 按密钥列出可用模型**（pi 1.2.0）：配了 OpenRouter 密钥后，模型列表只列出该密钥有权使用的模型，并带上该密钥的上下文长度、最大输出与价格（含在 `models.json` 里设为 base URL 的区域端点），列表会保存下来离线可用。桌面端按 pi 的做法接入：只有「设置 → 模型」页会联网刷新目录，输入框切模型、消息列表取显示名等高频路径用已缓存目录，保存/删除后重载也不重复联网；刷新沿用 SDK 自带的 4 小时目录缓存，同一分钟内来回切页只请求一次，等待上限 5 秒（超时不影响已刷到的部分）；离线模式（`PI_OFFLINE`）下不联网，失败或超时静默降级。

- **Web search server configuration**: a new "Web search" settings page reads and writes pi's `web-search.json` server config (feeding pi 1.2.0's web_search tooling). The proxy field is kept in sync when the app proxy changes.
- **Extension hook event list**: Settings → Hooks now lists the pi lifecycle events extensions subscribe to, grouped by event name alongside the desktop's own hooks.
- **Thinking language setting**: a thinking-language setting is added to Settings → General.
- **Compaction and branch summaries in chat history**: the message list now parses and shows context compaction and branch summaries from pi's `compaction_end` event.
- **Config files carry pi's published JSON Schema** (pi 1.2.0): `settings.json` / `models.json` written by the desktop get pi's `$schema` field so editors can validate and complete them; a `$schema` the user already wrote is kept.
- **Per-key OpenRouter model lists** (pi 1.2.0): with an OpenRouter key configured, the model list shows only the models that key may use, with that key's context size, max output and prices (including regional endpoints set as the base URL in `models.json`). The list is saved and used offline. The desktop follows pi's approach: only Settings → Models refreshes the catalog over the network, while high-frequency paths such as switching models in the composer or reading display names in the message list use the cached catalog, and reloads after save/delete do not re-fetch. The refresh keeps the SDK's own 4-hour catalog cache and requests at most once per minute, with a 5s wait cap (a timeout still keeps whatever was already fetched). Offline mode (`PI_OFFLINE`) skips the network, and failures or timeouts fall back silently.

### 修复 Fixes

- **修复安装包与 dev 偏好分家**：同一台机器上安装包与 `npm run dev` 的背景图、消息预览、会话排序、各类界面开关各不相同，消息预览关掉后下次启动又变回开启。根因是这些偏好存在渲染进程 localStorage，而它同时绑在 Electron userData 与页面 origin 两个维度上（安装包是 file://，dev 是 http://localhost:5173），两边双重隔离各存一份。现统一改存 `~/.pi/agent/desktop-prefs.json`（原子写 + 串行读改写队列），安装包与 dev 共用同一份偏好，一端修改在另一端下次启动生效。
- **聊天历史改为分页加载**：打开会话原本一次性灌入全部尾部历史（上限 100 万条），超长会话会把海量消息与大工具输出一次性压进渲染堆，是内存崩溃的主要来源。现在每次只加载最近 500 条，MessageList 顶部提供「加载更早的历史」按页前插并平移渲染窗口，视口不跳；切回被驱逐过的会话同样从最近一页开始。
- **修复会话事件流永久中断**：会话事件由主进程单向推送，渲染端无法补发，而三个 store 的 IPC 订阅各自绑在组件生命周期上，ChatPanel 被 `v-if` 销毁重建（切到拉取请求视图）即解绑，叠加 hidden-event-buffer 的 dispose 后 push 变成永久 no-op，两者叠加使事件流一旦中断就再也恢复不了——worker 与模型都正常，界面却永远停在「等待模型响应」。现改为进程级订阅在应用启动时统一注册，hidden-event-buffer 的 stop 后 push 退化为直通而非 no-op，并在聊天视图重新可见时用 sessions.status 对账补回丢失的收尾。
- **治理渲染进程常驻内存**：session bySession 加 LRU 上限 8（运行中的会话永不驱逐），切走但没删的会话不再带着全量历史永久常驻堆；clearSession 扩成完整清理，checkpoint 按 sessionId 前缀一并清除。
- **修复待办清单不按进度回写、收尾时被伪造成「一次性全完成」**：模型常把待办攒到最后一次更新，而回合结束时面板会把所有未完成项自动标成完成、并盖同一个完成时间，于是「哪一步没被确认」在界面上完全看不出来。根因是三层叠加：待办规则全是自然语言软约束、没有任何机制提醒；每次回写要独占一整轮模型调用（实测平均 14~44 次工具调用才回写一次）；最后面板的自动补完成再把缺口抹平。现在：回合结束时仍未回写的项保持未完成并标为「未回写」（虚线问号 +「N 项模型未回写」），面板不再伪造完成；新增内置扩展 `todo-reminder`——每 3 次工具调用在下一次请求的上下文末尾注入一行进度摘要（不写进工具结果、不影响界面），回合即将结束时若仍挂着 in_progress 项，则注入一条隐藏提醒并请求模型再回写一次（每轮最多一次，中止/出错不触发）；`todo_write` 的结果文本与系统提示同步改成「收尾前必须回写」；回合以错误结束时同样按此收尾（用户主动停止仍保持暂停列表）。
- **修复粘贴到消息框内容被改写**：粘贴文本开头总会多出一个空格；开头本来有多个空格时会被压成单个；剪贴板只有空格时则什么都粘贴不出来。根因是自绘输入框的插入路径有三处叠加改写：`normalizeInsertedText` 用 `trim()` 砍掉首尾空白、`needsLeadingSpace` 在插入点前有文字时无条件补一个空格、`Composer.vue` 的 `!plain.trim()` 判定把纯空白剪贴板整条丢弃（而剪贴板里的 `text/plain` 确实是那些空格）。现在粘贴逐字还原：首尾空白与内容原样落进输入框，纯空格剪贴板照常插入；「补分隔空格」的启发式只保留给拖放 URL 使用，两条路径互不影响（#36）。

- **Desktop preferences were split between the installed app and dev**: background image, message preview, session ordering and the various UI switches differed between the installed build and `npm run dev` on the same machine, and turning the message preview off appeared to revert on next launch. The root cause is that these preferences lived in renderer localStorage, which is keyed by both the Electron userData dir and the page origin (file:// for the app, http://localhost:5173 for dev), so each side kept its own copy. They now live in a single `~/.pi/agent/desktop-prefs.json` (atomic write plus a serialized read-modify-write queue); the installed app and dev share them, and a change on one side takes effect on the other at next launch.
- **Chat history is now paged**: opening a session used to load its entire tail in one go (limit was 1,000,000 entries), and a very long session pushed a flood of messages and large tool outputs into the renderer heap at once, the main source of out-of-memory crashes. It now loads only the most recent 500 entries, with a persistent "load earlier history" control at the top of MessageList that prepends a page and shifts the render window so the viewport does not jump; evicted sessions also resume from the most recent page.
- **Fixed session event streams stopping permanently**: session events are pushed one-way from the main process and cannot be replayed, yet three stores subscribed over IPC bound to component lifetimes — a ChatPanel destroyed and rebuilt by `v-if` (e.g. switching to the pull-request view) unsubscribed, and hidden-event-buffer's dispose turned push into a permanent no-op. Once interrupted the stream never recovered: worker and model were fine but the UI sat at "waiting for model response" forever. Subscriptions are now process-level, registered once at startup; after stop the buffer passes push through instead of no-op; and when the chat view becomes visible again it reconciles against sessions.status to restore missing tail work.
- **Renderer memory kept growing**: the bySession map gained an LRU cap of 8 (sessions with live turns are never evicted), so a session that was navigated away from without being deleted no longer kept its full history resident; clearSession now does a full cleanup, and checkpoint entries are dropped by sessionId prefix.
- **Fixed todos not being written per step and being faked into "all done at the end"**: models often batch todo updates, and when a turn ended the panel completed every remaining item on its own with one shared completion time, so which step was never confirmed became invisible. Three causes stacked: the todo rules were soft prose with no mechanism behind them; each write cost a whole model round (measured: one update per 14–44 tool calls); and the panel papered over the gap. Now items the model never reported stay open and are marked "not reported" (dashed question mark plus an "N not reported by the model" sub-label); a new built-in `todo-reminder` extension injects a one-line progress digest into the next request's context every third tool call (tool results and UI stay untouched) and, when an `in_progress` item is still open as the turn settles, injects a hidden reminder and asks the model once more to write the list (at most once per run, skipped on abort/error); `todo_write`'s result text and the system prompt now state the write-before-you-finish requirement; a turn that ends in an error settles the same way, while a user stop still keeps the paused list.
- **Fixed pasted text being rewritten in the composer**: pasting always added a leading space, an original run of leading spaces collapsed into one, and a clipboard holding nothing but spaces pasted nothing at all. Three rewrites stacked in the hand-rolled editor's insert path: `normalizeInsertedText` trimmed leading and trailing whitespace, `needsLeadingSpace` unconditionally added a space when text preceded the caret, and `Composer.vue`'s `!plain.trim()` test dropped a whitespace-only clipboard outright (while the clipboard's `text/plain` really did hold those spaces). Pasting now restores the text verbatim — leading and trailing whitespace land in the editor as-is and a whitespace-only clipboard pastes normally; the "insert a separator space" heuristic is kept for dropped URLs only, so the two paths no longer interfere (#36).

### 随 pi 1.2.0 升级获得的上游修复 Upstream fixes via pi 1.2.0

以下均为 pi SDK 内部行为，升级后自动生效，桌面端无对应代码改动。

- **OpenRouter 路由模型负价格归零**：`openrouter/auto` 这类路由模型原先在模型页显示 `$-1000000/M` 之类的负价格（OpenRouter 的占位负价被直接透出），现归零。
- **带资源的 MCP 服务器不再延迟注册工具**：pi 连接时不再预先列举全部资源（列举大目录可能很慢），改为按需列举；此前要等所有资源列完才注册工具。
- **上下文压缩不再因请求过大而失败**：会话序列化（压缩、分支摘要、bug 报告）跳过 thinking 块——回放的 thinking 往往不在模型实时上下文里，带上它会让摘要请求比要总结的上下文还大。
- **Anthropic 拒绝严格工具集时自动重试**：因语法大小、工具数量或联合类型上限被拒时，改用非严格模式重试一次，不再整轮失败。
- **provider 错误纳入可重试**：「The upstream provider returned an error」现在按可重试的 provider 错误处理。

- **OpenRouter router models no longer show a negative price**: router models such as `openrouter/auto` used to render a price like `$-1000000/M` in the model list (OpenRouter's negative placeholder prices were passed through); they are now 0.
- **MCP servers with resources register their tools right away**: pi no longer lists resources when connecting (listing a large drive can be slow) and lists them on demand, so a server that offers resources no longer waits for every resource to be listed.
- **Compaction no longer fails outright**: `serializeConversation()` (compaction, branch summaries, bug reports) omits thinking blocks — replayed thinking is often not part of the model's live context, so including it could make the summarization request larger than the context it summarizes.
- **Anthropic rejecting the strict tool set retries once**: when the strict tool set is rejected for grammar size, tool count or union limits, pi retries once with preferred tools non-strict instead of failing the turn.
- **Provider errors are retried**: "The upstream provider returned an error" is now treated as a retryable transient provider error.

### 变更 Changes

- **升级 pi SDK 到 1.2.0**：`@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@earendil-works/pi-durable` 从 1.1.0 升到 1.2.0（pi-codemode / pi-mcp / pi-tui / pi-telemetry / chord 同步）。适配 pi 1.2.0 的 `before_agent_start` 新签名：事件按 `messageType` 区分用户提交与扩展触发的运行，agent-worker 预热扩展 hook 时改传 `{ messageType: "user", prompt: "" }`，保持「空 prompt 不写用户事件」的原有语义；其余 SDK API 与构建期扩展加载器补丁均与 1.2.0 兼容，无需调整。
- **移除权限确认网关与命令输出临时文件清理**：桌面端不再代理 pi 的工具权限询问与项目信任设置，权限确认交回 pi CLI 自身；命令输出临时文件清理由外部工具负责，移除 temp-cleanup 的 IPC、设置面板与定时器。
- **依赖调整**：终端迁移到 `@xterm/xterm` 6.0.0 与 `@xterm/addon-web-links` 0.12.0（上游已废弃 xterm 5.x）；移除零引用的 qrcode；`ws` 仅供 CDP 调试脚本使用，从 dependencies 移入 devDependencies。
- **codemode 工具声明补上输入约束**（pi 1.2.0）：codemode 里的工具声明现在把 integer、最小/最大值、长度、pattern、默认值以 `@` 标记写在属性注释上，脚本能直接看到约束而不用工具在描述里重复一遍。

### 变更 Changes (English)

- **Upgraded pi SDK to 1.2.0**: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` and `@earendil-works/pi-durable` moved from 1.1.0 to 1.2.0 (pi-codemode / pi-mcp / pi-tui / pi-telemetry / chord follow). Adapted to pi 1.2.0's new `before_agent_start` signature: the event now distinguishes user-submitted from extension-triggered runs via `messageType`, and the agent worker's hook warm-up passes `{ messageType: "user", prompt: "" }` to keep the original "empty prompt writes no user event" semantics. The remaining SDK API and the build-time extension-loader patch stay compatible with 1.2.0 unchanged.
- **Removed the permission gateway and temp-file cleanup**: the desktop no longer proxies pi's tool permission prompts or project-trust settings — permission confirmation goes back to the pi CLI itself — and command-output temp-file cleanup is left to external tooling, so temp-cleanup's IPC, settings panel and timers are removed.
- **Dependency changes**: the terminal moves to `@xterm/xterm` 6.0.0 and `@xterm/addon-web-links` 0.12.0 (upstream deprecated xterm 5.x); the unreferenced qrcode package is removed; `ws` is only used by the CDP debug script and moved from dependencies to devDependencies.
- **Codemode tool declarations show input constraints** (pi 1.2.0): codemode's tool declarations now spell out integer, minimum/maximum, length, pattern and default as `@` tags on property comments, so scripts see the constraints without the tool repeating them in its description.

## v0.3.6-rc.1 (2026-10-11)

本版重点：跟进 pi 1.1.0（含 1.0.1–1.0.4）的全部变更，升级 SDK，适配 azure 更名、工具耗时记录、取消态与 MCP 客户端注册方式，并在界面上接入采样参数、MCP 项目覆盖、内置工具与提示模板管理，终端改用 pi 原生运行状态；并修复退出后进程残留。

### 新功能 Features

- **模型可编辑采样参数**：自定义模型编辑表单新增「采样参数」折叠区，直接编辑 `samplingParams`（如 `temperature`、`top_p`）与 `samplingParamsByThinkingLevel`（按 off/minimal/low/medium/high/xhigh/max 分档覆盖），对应 pi 1.0.2 的按思考档采样设置（仅 openai-completions / openai-responses / azure 生效）。
- **MCP 服务器支持项目覆盖**：设置 → MCP 的用户级服务器新增「此项目」三态选择（跟随全局 / 在此项目启用 / 在此项目禁用），写入 `<工作区>/.pi/mcp.json` 的覆盖条目（无 command/url，只改启用态），对应 pi 1.0.1 的项目级覆盖；切换后立即通知工作区内的会话重载 MCP 配置。
- **工具页覆盖全部内置工具**：内置工具开关从 codemode / tool_search 扩展到 pi 全部可切换工具（read / bash / powershell / edit / write / grep / find / ls / codemode / tool_search），grep / find / ls / powershell 不用再手写 settings.json。
- **MCP 支持按工具暴露**：MCP 服务器编辑新增「按工具暴露（toolExposure）」，按工具名或通配符覆盖服务器的 exposure（codemode / deferred / direct / hidden），hidden 服务器也能只放行个别工具。
- **思考档与模型设置**：「运行」设置新增「思考档与模型」节：默认启动思考档（defaultThinkingLevel）、按模型启动思考档（modelThinkingLevels，provider/modelId: 档位）、启用模型循环列表（enabledModels 模式，如 anthropic/*）、隐藏思考块开关（hideThinkingBlock）。
- **消息投递方式**：新增「消息投递」节，引导与追问队列可选全部投递或逐条投递（steeringMode / followUpMode）。
- **传输方式与 npm 命令**：环境节新增 provider 传输方式（transport：auto / sse / websocket / websocket-cached）与 npm 命令（npmCommand）设置。
- **提示模板管理页**：设置页恢复「提示模板」分组（与智能体/技能同级），列出用户级 `~/.pi/agent/prompts/` 与工作区 `.pi/prompts/` 的模板，支持新建（文件名即 `/` 命令名，带 description / argument-hint 模板）、编辑、启停与删除。
- **终端改用 pi 原生运行状态**：终端面板解析 pi 上报的 OSC 7501（Program Status Protocol），tab 标签显示运行状态点（运行中呼吸点 / 等待输入 / 已完成 / 出错），tooltip 带会话名或错误首行；并应答协议的支持查询，pi 开始正式上报状态。
- **内置扩展补齐 llama.cpp**：设置 → 工具的「内置扩展」现在列出 pi 全部四个内置扩展（llama.cpp / codemode / tool-search / mcp），之前缺少 llama.cpp，无法在桌面里启停本地 llama.cpp 模型与分类器支持。

- **Editable sampling params for custom models**: the model editor gains a collapsible "Sampling params" section for `samplingParams` (e.g. `temperature`, `top_p`) and `samplingParamsByThinkingLevel` (per off/minimal/low/medium/high/xhigh/max level), following pi 1.0.2's sampling-by-thinking-level support (openai-completions / openai-responses / azure only).
- **MCP project overrides**: user-level MCP servers gain an "In this project" selector (follow global / enable in this project / disable in this project) that writes an override entry (no command/url, enable state only) into `<workspace>/.pi/mcp.json`, following pi 1.0.1's project overrides; sessions in the workspace reload MCP config right away.
- **Built-in tool switches cover every tool**: the tool page now toggles all switchable pi tools (read / bash / powershell / edit / write / grep / find / ls / codemode / tool_search), so grep / find / ls / powershell no longer need hand-edited settings.json.
- **Per-tool MCP exposure**: MCP server editing gains "Per-tool exposure (toolExposure)" to override the server exposure per tool name or wildcard (codemode / deferred / direct / hidden); even a hidden server can release individual tools.
- **Thinking level and model settings**: the Runtime page gains a "Thinking level and models" section — default thinking level, per-model thinking level (`provider/modelId: level`), enabled model patterns (e.g. `anthropic/*`), and a hide-thinking-blocks switch.
- **Message delivery**: a new "Message delivery" section chooses whether queued steering and follow-ups are delivered all at once or one at a time.
- **Transport and npm command**: the Environment section gains provider transport (auto / sse / websocket / websocket-cached) and npm command settings.
- **Prompt templates page**: Settings restores the "Prompt templates" group alongside agents and skills, listing user (`~/.pi/agent/prompts/`) and workspace (`.pi/prompts/`) templates with create (file name becomes the `/` command), edit, enable/disable and delete.
- **Terminals use pi's native run status**: the terminal parses pi's OSC 7501 (Program Status Protocol) reports, showing a status dot on the tab (working / waiting / done / error) with the session name or error line in the tooltip, and answers the protocol's support query so pi starts reporting.
- **Built-in extensions list completed with llama.cpp**: Settings → Tools now lists all four of pi's built-in extensions (llama.cpp / codemode / tool-search / mcp); llama.cpp was missing, so local llama.cpp models and classifier support could not be toggled from the desktop.

### 修复 Fixes

- **修复退出后进程残留**：退出前未回收 node-pty 终端，ConPTY 管道句柄与 shell 子进程（pwsh / conhost）卡住主进程退出，窗口关掉后 electron 主进程经常残留。现在退出时统一回收全部 pty，关闭窗口后进程树完整退出；只要开过终端（标签页会持久化并在启动时自动重建 pty）就会触发，故此前“经常”残留。
- **修复 models.json 文本报错不友好**：粘贴非法 JSON 时现在报 `Invalid models.json: …`，而不是裸的解析器异常。
- **修复功能裁剪遗留的问题**：恢复被清理误删的四个 i18n 键（`marketLoadMore` / `marketLoadingMore` / `marketEnd` / `scrollToLatest`）与 preload 的 `contributors.avatar`（写法归一为单行）、修复 Composer 模板在移除语音输入后缺少的闭合标签（此前会中断构建）、移除未使用的 NModal 导入。

- **Fixed processes left behind after quit**: node-pty terminals were never reclaimed on quit, so ConPTY pipe handles and shell children (pwsh / conhost) stalled the main process and electron.exe often lingered after the window closed. All ptys are now disposed on quit and the whole process tree exits; terminal tabs persist and auto-recreate the pty on launch, which is why it used to happen "often".
- **Friendlier models.json parse errors**: pasting invalid JSON now reports `Invalid models.json: …` instead of a raw parser error.
- **Fixed issues left by the feature removal**: restored the four i18n keys accidentally deleted during cleanup (`marketLoadMore` / `marketLoadingMore` / `marketEnd` / `scrollToLatest`) and the preload `contributors.avatar` (normalized to one line), fixed the Composer template's missing closing tag after the voice input removal (which had broken the build), and dropped the unused NModal import.

### 变更 Changes

- **接入官方预览包 pi-durable**：新增依赖 `@earendil-works/pi-durable` 1.1.0（官方 durable 会话/任务/文档运行时，Experimental，连带 `@earendil-works/chord` 1.1.0）。本轮仅打通依赖与类型/构建，行为不变；后续可基于其 Harness / 任务图能力做崩溃续跑等集成。
- **升级 pi 到 1.1.0**：`@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 从 1.0.0 升到 1.1.0（pi-codemode / pi-mcp / pi-tui / pi-telemetry 同步）。构建期扩展加载器补丁与打包时附带的 pi 文档资源均与 1.1.0 兼容，无需调整。
- **azure provider 更名自动迁移**（pi 1.0.3 破坏性变更）：pi 把 `azure-openai-responses` 更名为 `azure`。启动时自动把 `auth.json`、`models.json`、`settings.json`（`defaultProvider` / `enabledModels` / `modelThinkingLevels`）、`mcp.json`（`auth.provider`）里的旧 id 改名为新 id，Azure 凭据与设置不用手动搬；平台目录与图标映射同步改名，历史遗留 id 仍解析到 Azure 图标。
- **工具耗时改用 pi 记录的执行时间**（pi 1.1.0）：`tool_execution_end` 与工具结果现在带记录的执行耗时（单调时钟）。工具卡片优先显示该耗时，历史会话也能还原每个工具的实际耗时，嵌套调用同步；未记录时回退原有实时计时。工具卡片与历史会话的耗时展示无需改动，数据到位后自动显示。
- **取消与自然完成可区分**（pi 1.1.0）：`agent_settled` 事件现在带 `aborted`。取消落在工具执行中、没留下任何回答时，补一张「已取消」卡，回合不再默默消失。
- **MCP OAuth 支持客户端注册方式**（pi 1.0.1）：MCP 服务器的「OAuth 高级设置」新增客户端注册方式，可选动态注册（DCR，默认）或客户端 ID 元数据文档（CIMD，`oauth.clientRegistration: "cimd"`）；CIMD 用 pi.dev 上的文档识别 pi，授权服务器可按 URL 放行，不再依赖动态注册。
- **依赖全面更新**：@types/node 26.6.5、@vitejs/plugin-vue 6.0.10、@viz-js/viz 3.31.0、@vue/typescript-plugin 3.3.13、dompurify 3.4.16、electron 44.7.0、marked 18.1.0、mermaid 12.1.0、monaco-editor 0.57.0、npm 12.2.0、typebox 1.3.36、undici 8.11.2、vite 7.3.7、vitest 5.0.3、vue-tsc 3.3.13、ws 8.22.0。受上游 peer 约束暂不升级：vite 8（electron-vite 5.0.0 仅支持到 vite 7）、TypeScript 7（vue-tsc 3.3.13 无法解析 TS 7 的 exports 变化）、katex 0.19（marked-katex-extension 5.1.13 peer 限制 <0.19）。

### 变更 Changes (English)

- **Upgraded pi to 1.1.0**: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` moved from 1.0.0 to 1.1.0 (pi-codemode / pi-mcp / pi-tui / pi-telemetry follow). The build-time extension-loader patch and the packaged pi docs both stay compatible with 1.1.0 unchanged.
- **Automatic migration for the azure provider rename** (pi 1.0.3 breaking change): pi renamed `azure-openai-responses` to `azure`. On launch the old id is rewritten to the new one in `auth.json`, `models.json`, `settings.json` (`defaultProvider` / `enabledModels` / `modelThinkingLevels`) and `mcp.json` (`auth.provider`), so Azure credentials and settings keep working without manual edits; the platform catalog and icon mapping follow, and legacy ids still resolve to the Azure mark.
- **Tool durations now come from pi's recorded execution time** (pi 1.1.0): `tool_execution_end` and tool results carry the recorded duration (monotonic clock). Tool cards prefer it, history restores the real duration of every tool, nested calls follow, and the live wall-clock estimate remains as a fallback.
- **Cancelled runs are told apart from finished ones** (pi 1.1.0): `agent_settled` now carries `aborted`. When a cancel lands during a tool call and no reply was produced, a "Cancelled" card is added instead of the turn silently vanishing.
- **MCP OAuth client registration mode** (pi 1.0.1): the MCP server "OAuth advanced settings" gain a client registration mode — dynamic registration (DCR, default) or Client ID Metadata Document (CIMD, `oauth.clientRegistration: "cimd"`). CIMD identifies pi by the document on pi.dev so authorization servers can allow it by URL instead of dynamic registration.
- **Dependencies refreshed**: @types/node 26.6.5, @vitejs/plugin-vue 6.0.10, @viz-js/viz 3.31.0, @vue/typescript-plugin 3.3.13, dompurify 3.4.16, electron 44.7.0, marked 18.1.0, mermaid 12.1.0, monaco-editor 0.57.0, npm 12.2.0, typebox 1.3.36, undici 8.11.2, vite 7.3.7, vitest 5.0.3, vue-tsc 3.3.13, ws 8.22.0. Held back by upstream peer constraints: vite 8 (electron-vite 5.0.0 supports up to vite 7), TypeScript 7 (vue-tsc 3.3.13 cannot resolve TS 7's changed exports), and katex 0.19 (marked-katex-extension 5.1.13 peers `<0.19`).

## v0.3.5-rc.4 (2026-10-02)

本版重点：跟进 pi 1.0.0（SDK 从 0.99.2 升级），修复 MCP OAuth 凭据的读写，打包时附带 pi 的文档资源，并接入 1.0.0 的两项新能力。

### 新功能 Features

- **MCP OAuth 支持授权服务器元数据地址**：服务器发布的 OAuth 授权服务器元数据地址不符合规范、或未发布时，可在 MCP 服务器的「OAuth 高级设置」里填写 `authServerMetadataUrl`，登录直接使用该地址，不再依赖自动探测。
- **工具结果里的图片会显示出来**：codemode 生成图（`image()` / `models.generateImages()`）等工具返回的图片块，现在会在工具卡片中直接渲染（最多 8 张，随卡片展开）。

- **Authorization server metadata URL for MCP OAuth**: when a server advertises a wrong OAuth authorization server metadata document (or none), set `authServerMetadataUrl` in the MCP server's OAuth advanced settings so sign-in uses that address instead of discovery.
- **Images from tool results are shown**: image blocks returned by tools such as codemode generation (`image()` / `models.generateImages()`) now render inside the tool card (up to 8, when expanded).

### 变更 Changes

- **升级 pi 到 1.0.0**：`@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 从 0.99.2 升到 1.0.0。

- **Upgraded pi to 1.0.0**: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` moved from 0.99.2 to 1.0.0.

### 修复 Fixes

- **修复 MCP OAuth 登录状态显示未认证、登出无效**：pi 1.0.0 把 MCP OAuth 凭据改为按「服务器名 + URL」存储，旧的单参数调用按 URL 读不到新凭据。现在按服务器名与 URL 读写，1.0.0 的首个使用同一 URL 的服务器也会自动接管旧凭据（旧凭据不会丢）。
- **修复打包版里模型读不到 pi 文档**：1.0.0 的 codemode 提示词只保留一行摘要，细节引导模型去读 `docs/codemode.md`（models API、图像生成等），而 asar 打包会排除所有 `.md`，模型读到的路径不存在。现在打包时把 pi 的 `package.json`、`README.md`、`CHANGELOG.md`、`docs/`、`examples/` 作为 extraResources 附带到 `resources/pi-package`，并让 `PI_PACKAGE_DIR` 指向它。

- **Fixed MCP OAuth showing "not authenticated" and logout doing nothing**: pi 1.0.0 stores MCP OAuth credentials per server name and URL, so the old single-argument calls keyed by URL alone could not read the new credentials. Reads and writes now pass both, and the first server using a URL takes over credentials stored by older versions (nothing is lost).
- **Fixed the packaged app being unable to read pi's docs**: pi 1.0.0's codemode prompt keeps only a one-line summary and points the model at `docs/codemode.md` (models API, image generation, …), but the asar excludes every `.md`, so the model was given a path that does not exist. The build now ships pi's `package.json`, `README.md`, `CHANGELOG.md`, `docs/` and `examples/` as extraResources under `resources/pi-package`, with `PI_PACKAGE_DIR` pointing there.

## v0.3.5-rc.2 (2026-09-23)

本版重点：修复 pi 0.87 升级后插件工具在 Agent 会话与设置-工具页全部消失的问题；此外重做了工具调用的折叠体验（默认折叠 + 分类次数小结）、修好了 Windows 上的 bash 工具，并大幅改善了「停止」时的卡顿，并修好了自定义提供商「拉取模型」拉不到模型的问题。

### 新功能 Features

- **工具调用默认折叠 + 设置开关**：读取/写入文件、执行命令等工具卡片默认**全部折叠**，长回合不再被 diff 和文件内容淹没。设置 → 外观新增「展开工具调用详情」开关，打开后恢复原来的行为（写入/编辑/命令/清单在流式时自动展开，读取始终折叠）。
- **折叠后显示分类次数小结**：折叠起来的过程行汇总成一行，例如「查看了 2 个文件 · 执行了 1 条命令 · 更新了 1 次清单」，明确告诉你这一轮做了什么、各做了几次，而不是只挑一个文件名。
- **进行中显示当前所有操作**：回合还在跑时标题显示**所有正在进行的步骤**（并行操作并列展示，各占一段），收尾后自动换成上面的分类小结 —— 运行中能看清"现在在干嘛"，结束后只留结论。
- **引导内容不再"消失"**：回复期间发送的内容，之前会有一段时间在界面上完全看不到（引导是立即注入的，但 Pi 要等当前工具调用跑完才把它写进会话记录）。现在发送后立刻显示为「引导中」卡片，直到真正出现在聊天记录里。
- **「回答语言」设置**：设置 → 外观可为 Pi 的回复指定语言（20 种，默认「跟随设备」按系统语言判断），与界面语言相互独立 —— 界面英文而 Pi 用中文回答是可以的。语言写入系统提示词，避免模型跟着上一条消息的语言漂移。

- **Tool calls collapsed by default, with a toggle**: file reads/writes and command cards now start folded, so a long turn is no longer buried under diffs and file dumps. Settings → Appearance gains an "Expand tool call details" switch that restores the previous per-kind behaviour (write/edit/bash/todo expand while streaming, reads stay folded).
- **Per-category counts in the folded summary**: a folded process section now reads like "Reviewed 2 files · Ran 1 command · Updated todos 1 time" — what happened and how many times, instead of naming a single file.
- **Live view of everything in flight**: while a turn runs, the header lists every step currently running (parallel steps each get their own segment), then swaps to the count summary once it settles.
- **Guidance no longer appears to vanish**: text sent while Pi was replying used to be invisible for a while (steering is injected immediately, but Pi only writes it into the session after the current tool calls finish). It now shows as a "Guiding" card from the moment it is sent until it lands in the transcript.
- **Answer language setting**: Settings → Appearance lets you pin the language Pi replies in (20 options, defaulting to "follow the device"). Independent of the interface language, and written into the system prompt so the model does not drift into whatever language the last message used.

### 变更 Changes

- **标题栏改为半透明**：顶栏颜色改为 74% 不透明并加毛玻璃模糊，启用壁纸时透出壁纸、未启用时透出窗口底色，不再是实心色块；拖动窗口的行为不受影响。
- **输入框与聊天区域同宽**：输入框去掉了自己独立的 748px 宽度上限，改为与消息内容共用同一个列盒子（同一个「消息宽度」设置 + 同样的内边距），左边缘严格对齐；`ask_user` 卡片、权限弹窗、扩展 UI 也一并统一。拖动「消息宽度」时输入框会跟着一起变。消息列表同时固定预留滚动条槽位，避免滚动条出现/消失时整列左右跳动。

- **Semi-transparent title bar**: the bar is now 74% opaque with a backdrop blur, showing the wallpaper through it when one is set (and the window backing colour otherwise) instead of a solid block.
- **Composer now matches the chat column width**: the input no longer has its own 748px cap and instead shares the message content's column box (same "message width" setting and the same padding), so the left edges line up exactly. The ask_user card, permission dialog and extension UI were unified the same way. The message list also reserves its scrollbar gutter so the column no longer shifts when a scrollbar appears.

### 修复 Fixes

- **修复插件工具在 Agent 会话与设置-工具页全部消失**：pi 0.87 的扩展加载器改为按 `usesEmbeddedModules` 三分支选择解析方式，构建期 Electron 补丁的正则不再匹配，打包产物回落到 `getAliases()`；CJS 下 `import.meta.resolve` 退化为 `require.resolve`，而 Pi 各包是 ESM-only（exports 只有 `import` 条件），解析必然抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，所有扩展加载失败。现将兜底分支替换为 `virtualModules`，扩展改用产物内已打包的模块解析，插件工具在会话与设置页恢复。

- **Fixed plugin tools vanishing from Agent sessions and Settings → Tools**: pi 0.87's extension loader now picks its resolution strategy through a three-branch `usesEmbeddedModules`, so the build-time Electron patch regex no longer matched and the bundle fell back to `getAliases()`. Under CJS `import.meta.resolve` degrades to `require.resolve`, and since the Pi packages are ESM-only (exports expose only the `import` condition) this always throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, failing every extension load. The fallback branch is now replaced with `virtualModules`, resolving extensions against the modules already bundled into the output, restoring plugin tools in sessions and Settings.

- **修复 Windows 上 bash 工具不可用**（`execvpe(/bin/bash) failed: No such file or directory`）：工具原本退回到 PATH 上的 `bash.exe`，而那其实是 WSL 启动器，未安装 WSL 发行版时必然失败。现在会从 PATH 上的 `git` 反推真正的 bash（例如 Git 装在 D 盘、`%ProgramFiles%` 在 C 盘这种情况也能找到），找不到才改用内置 PowerShell 工具，并禁止调用不可用的 bash，避免模型反复撞错。
- **修复点「停止」时的卡顿与假死**：停止是一次等待 worker 回应的 RPC，而 force-kill 兜底时限原本是 **30 秒** —— worker 若正忙于同步的工具调用或大文件写盘，界面就会一直没有任何反馈，看起来像卡死。现在兜底降到 8 秒，并且点击瞬间按钮就变成「正在停止…」的加载态，即使 worker 要过几秒才腾出手，也能立刻知道请求已收到。
- **修复「新建会话」不输入内容仍会残留空会话文件**：点「新建会话」会预热一个会话（界面立刻可用、不落侧栏），但退出时只清理了"已激活但未使用"的会话，**预热草稿**那条路径没有释放，于是磁盘上留下一个永远不出现在侧栏的空 jsonl。现在退出时会同时释放预热草稿与未使用的会话，实测点「新建会话」→ 不输入 → 退出后文件不再残留。
- **修复权限弹窗比输入框宽**：权限卡、ask_user 卡与扩展 UI 之前不跟随聊天列宽度，会横跨整个面板；现在与输入框使用同一列几何。

- **Fixed the bash tool being unusable on Windows** (`execvpe(/bin/bash) failed: No such file or directory`): its shell fallback picked `bash.exe` from PATH, which is the WSL launcher and fails whenever no WSL distribution is installed. A real bash is now derived from the `git` found on PATH — which also covers Git installed on a different drive than `%ProgramFiles%` — and only when none exists does the app switch to the built-in PowerShell tool and deny the broken `bash` tool.
- **Fixed the stall and dead-feeling UI when pressing Stop**: stopping is an RPC that waits for the worker, and the force-kill fallback was **30 seconds** — if the worker was busy in a synchronous tool call or a large session write, the UI showed nothing for the whole wait. The fallback is now 8 seconds, and the button switches to a "Stopping…" spinner the moment it is clicked.
- **Fixed abandoned "new session" drafts leaving an empty session file on disk**: clicking 新建会话 pre-warms a session (usable immediately, never shown in the sidebar), but quit-time cleanup only handled the active-but-unused case and never released the *prepared draft*, so an empty jsonl stayed on disk while being hidden from the sidebar. Quit now releases both; verified that new session → type nothing → quit leaves no file behind.
- **Fixed the permission dialog being wider than the input box**: the permission card, ask_user card and extension UI did not follow the chat column and spanned the whole panel; they now share the composer's column geometry.

- **修复自定义提供商「拉取模型」/测速报 `Response is not JSON`**：模型发现、地址测速与「测试模型」这三个请求走的是主进程 undici（`globalThis.fetch`），不经过 Chromium 网络栈 —— 既不遵循应用里设置的代理，也没有 Chrome 的请求特征，网关把它们当作异常客户端、返回拦截页时就只能失败。现三个请求统一改走 `netFetch`（Chromium 栈），与更新、市场、ASR 等其它网络功能一致；响应不是 JSON 时错误里会同时给出状态码与响应片段，便于直接看出返回了什么。

- **Fixed "Fetch Models" / latency test failing with `Response is not JSON`**: model discovery, base-URL latency probing and "Test model" all went through the main process's undici (`globalThis.fetch`) instead of the Chromium network stack — so they ignored the configured proxy and carried no Chrome request fingerprint, and failed whenever the gateway answered such a request with its interception page. All three now go through `netFetch` (the Chromium stack), matching updates, market, ASR and every other network feature; a non-JSON response now reports the status code and a response snippet so the cause is visible at a glance.

### 优化 / 体验 Improvements

- **折叠/展开更顺滑**：按分段内容体量决定是否做动画，超大分段的折叠改为瞬时切换，避免逐帧重排海量节点造成卡顿。
- **输入框跟随「消息宽度」设置**：调整消息宽度时输入框同步变化，两者不会再脱节；消息列固定预留滚动条槽位，列宽不再随内容长短跳动。

- **Smoother folding**: whether a fold animates is decided by the section's content size, and oversized sections snap instead of re-laying out thousands of nodes every frame.
- **The composer follows the message-width setting** and the chat column reserves its scrollbar gutter, so the two never drift apart and the column width no longer jumps with content length.

## v0.3.5-rc.1 (2026-09-22)

本版重点：依赖全面升级——pi-agent 三件套升到 0.87.0、electron 升到 44，工具链同步升级并完成 API 适配；设置新增「重试」面板（自动重试、网络请求、卡死恢复档位），并修复 electron 44 下 dev 启动即报 `Electron uninstall` 的问题。

### 新功能 Features

- **「重试」设置页**：设置 → 通用新增「重试」面板，三组档位——自动重试（Pi SDK 回合层：开关、次数、指数退避基准间隔）、网络请求（HTTP 层重试次数、最大等待、请求超时）、卡死恢复（恢复次数上限、软挂起与卡死判定时长）。设置写入 `~/.pi/agent/settings.json` 的 `retry` 段，保存后热重载给活跃 worker 并同步所有窗口，卡死判定阈值即时在主进程生效。

- **Retry settings page**: a new "Retry" panel under Settings → General with three groups — auto retry (Pi SDK turn layer: toggle, count, backoff base delay), network requests (HTTP-level retries, max retry delay, request timeout) and stuck recovery (recover attempts, soft-hang / stall silence). Values persist to the `retry` section of `~/.pi/agent/settings.json`, hot-reload into live workers on save, sync across windows, and apply the stall threshold in the main process immediately.

### 变更 Changes

- **依赖全面升级**：`@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` 0.85.1 → 0.87.0，electron 39 → 44，vue、vite、typescript、undici、electron-builder、node-pty 等同步升级到当前最新。

- **electron 44 适配**：剪贴板写图改走 `ClipboardItem` + `write()`——旧 `writeImage` 已从 `Clipboard` 移除，新 API 为 W3C 风格异步接口。

- **pi-coding-agent 0.87 适配**：`emitBeforeAgentStart` 签名变更（不再单独传系统提示），系统提示改经 `BuildSystemPromptOptions` 传递。

- **构建工具链取舍**：typescript 钉在 6.0.3（vue-tsc 尚不支持 TS 7 的原生 tsgo）、vite 钉在 7.x（electron-vite 5 的 peer 上限）；`tsconfig.web.json` 移除已废弃的 `baseUrl`，`paths` 改为相对路径。

- **Dependencies upgraded across the board**: pi-agent-core / pi-ai / pi-coding-agent 0.85.1 → 0.87.0, electron 39 → 44, plus vue, vite, typescript, undici, electron-builder and node-pty to their latest.

- **Electron 44 adaptation**: clipboard image writes now use `ClipboardItem` + `write()` — the old `writeImage` API was removed in favor of the W3C-style async clipboard API.

- **pi-coding-agent 0.87 adaptation**: `emitBeforeAgentStart` changed its signature (the system prompt is no longer a standalone argument) and now receives it through `BuildSystemPromptOptions`.

- **Build toolchain pins**: typescript stays at 6.0.3 (vue-tsc does not support the native tsgo-based TS 7 yet) and vite at 7.x (the peer range of electron-vite 5); `tsconfig.web.json` drops the deprecated `baseUrl` and resolves `paths` relatively.

### 修复 Fixes

- **修复升级 electron 44 后 `npm run dev` 启动即报 `Electron uninstall`**：electron 44 的 npm 包不再自带 `postinstall` 下载脚本，`npm install` 后 `node_modules/electron/dist` 缺失；现 `postinstall` 链首显式执行 `node node_modules/electron/install.js`（沿用 `.npmrc` 镜像配置），全新安装与既有安装都能自动补齐二进制。

- **Fixed `npm run dev` failing with `Electron uninstall` after the Electron 44 upgrade**: the electron 44 npm package no longer ships a `postinstall` download hook, so `npm install` left `node_modules/electron/dist` missing. The `postinstall` chain now runs `node node_modules/electron/install.js` first (using the `.npmrc` mirror config), so both fresh and existing installs fetch the binary automatically.

## v0.3.4-rc.8 (2026-09-21)

本版重点：侧栏「选择」模式补上退出键——多选状态下按 `Esc` 等同点击工具条「取消」，清空选中退回普通列表，与设置窗口的 `Esc` 行为一致。

### 新功能 Features

- **选择模式下 `Esc` 退出**：会话多选时按 `Esc` 等同点击工具条「取消」，清空选中并退回普通列表；设置页内置快捷键清单同步列出 `Esc`。焦点在输入框或有弹层打开时不触发，`Shift+Esc`（关闭终端）不受影响。

- **`Esc` exits select mode**: with sessions multi-selected, `Esc` acts like the toolbar's Cancel button — it clears the selection and returns to the normal list, and is listed under Settings → Keyboard. Text inputs and open overlays keep their own `Esc` handling, and `Shift+Esc` (close terminal) is unaffected.

## v0.3.4-rc.7 (2026-09-21)

本版重点：侧栏「选择」模式拿到专属快捷键——`Ctrl+P` 从「右侧栏文件」改为进入选择模式；并修好选择模式下 `Del` 一直没反应的问题，设置窗口的 `Esc` 一并恢复。

### 新功能 Features

- **`Ctrl+P` 改为进入选择模式**：原「右侧栏文件」取消默认键位（功能保留，可在设置 → 快捷键里自行绑定），`Ctrl+P` 现在等同侧栏菜单里的「选择」，进入会话多选；设置页快捷键清单同步改名为「选择会话」。

- **`Ctrl+P` enters select mode**: the former "right pane files" shortcut no longer has a default binding (the action is still there and can be rebound under Settings → Keyboard), so `Ctrl+P` now matches the sidebar's "Select" entry. The settings list shows it as "Select sessions".

### 修复 Fixes

- **修复选择模式下 `Del` 删除会话无反应**：判断「是否有弹窗打开」时用的是 `.n-modal-container`，但 naive-ui 的模态容器由 `LazyTeleport` 承载，只要显示过一次就永久留在 DOM，判断因此恒为真、每次按键都被丢弃；改为检测真正随开关渲染与销毁的遮罩。

- **修复设置窗口 `Esc` 关不掉**：同一条恒真判断让「页面内有弹窗时不关窗口」变成了永远不关，一并改用遮罩检测。

- **Fixed `Del` doing nothing in select mode**: the open-overlay check used `.n-modal-container`, but naive-ui keeps that container in the DOM forever once shown (`LazyTeleport`), so the guard was always true and every keypress was dropped. It now checks the mask, which renders and unmounts with the modal.

- **Fixed the settings window not closing on `Esc`**: the same always-true check turned "don't close while an overlay is open" into "never close"; it now uses the mask check too.

## v0.3.4-rc.6 (2026-09-19)

本版重点：贡献者头像落盘缓存到安装目录，取回一次后本地读取，离线也能显示；另新增两条键盘捷径——确认对话框按 `Enter` 即点确定，选择模式下按 `Del` 即点删除。

### 新功能 Features

- **贡献者头像缓存到安装目录**：头像取回后写入安装目录的 `resources/Avatar/`（开发期写入仓库 `resources/Avatar/`），下次启动直接读本地，不再重复联网；安装目录只读时自动降级为进程内缓存，离线首次启动仍回退字母占位。

- **Contributor avatars are cached on disk** in the install directory (`resources/Avatar/`): fetched once through the configured proxy, then loaded from local files on later launches. A read-only install directory falls back to the in-process cache, and a first offline launch still shows the initial-letter placeholder.

- **确认对话框按 `Enter` 快速确定**：任意确认对话框弹出时，按 `Enter` 等同点击「确定」，多弹层时取最上层。对话框内输入框的 `Enter` 仍由输入框自己处理（如重命名提交），输入法组合中不触发。

- **选择模式下按 `Del` 快速删除会话**：会话多选（选择模式）下选中会话后，按 `Del` 等同点击工具条「删除」，仍会弹出确认框；焦点在输入框、已有弹层打开、或按住 `Ctrl` / `Alt` / `Win` 时不触发。

- **内置快捷键清单同步**：设置 → 快捷键的内置清单新增 `Enter`（确认对话框）与 `Del`（选择模式删除）两条只读展示。

- **`Enter` confirms dialogs**: while any confirm dialog is open, `Enter` clicks its OK button (the topmost dialog wins). Inputs inside a dialog keep their own `Enter` handling (e.g. rename submit), and IME composition is ignored.

- **`Del` deletes in select mode**: with sessions multi-selected, `Del` acts as the toolbar's Delete button and the confirmation dialog still appears. Text inputs, open overlays and `Ctrl` / `Alt` / `Win` combinations are left untouched.

- **Built-in shortcut list** now lists `Enter` (confirm dialog) and `Del` (delete in select mode) under Settings → Keyboard.

### 修复 Fixes

- 修复工作区「移动到分类」点击无反应：菜单里的各个分类是子项，其 key（`group-default` / `group:<名称>`）与父项 `move-group` 不同，处理函数一直在等父项 key，点击因此被静默丢弃；现在按 key 前缀解析分类名，右键菜单与省略号菜单都能正常归类，选内置「Default」即清除分类。

- **Fixed "Move to category" doing nothing**: the entries under the submenu are leaves whose keys (`group-default` / `group:<name>`) never equal the parent `move-group` key the handler waited for, so a click was silently dropped. The key is now resolved by prefix, so both the context menu and the ellipsis menu move a workspace, and picking the built-in "Default" clears its category.

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
