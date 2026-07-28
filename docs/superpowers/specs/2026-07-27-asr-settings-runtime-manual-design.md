# ASR 独立设置 + 运行时手动安装

日期：2026-07-27  
状态：已确认并实现

## 目标

1. 语音识别（ASR）从「外观」设置中拆出，成为齿轮菜单下的独立设置项。
2. CrispASR **运行时**支持：强制重新下载，或手动选择本地下好的压缩包（zip / tar.gz）。
3. 手动导入的运行时按当前检测到的偏好 GPU 后端打标记（方案 A：不弹后端选择）。

## 非目标

- 不改连续听写 / VAD / 转写队列逻辑。
- 不改 GGUF 模型的 URL / 本地 `.gguf` 导入（保持现有能力，仅搬家到新设置页）。
- 不在本次做多模型切换或非 Qwen3-ASR 后端。

## UI

### 设置入口

- `TitleBar` 齿轮菜单新增「语音识别」/ Speech（建议放在「外观」与「模型」之间，或「关于」之上、分隔线前）。
- 新组件 `AsrSettings.vue`（模式对齐 `AboutSettings` / `AppearanceSettings`）。
- `AppearanceSettings.vue` 删除全部 ASR 区块与相关逻辑。

### 设置页结构

1. **开关**：启用语音输入  
2. **状态**：模型名、已安装/未安装、磁盘/内存估算、推理设备与 backend  
3. **模型区**  
   - 安装模型（未就绪时可点）  
   - 自定义 URL + 从 URL 安装  
   - 选择本地 GGUF  
4. **运行时区**（新增）  
   - 文案：网络不佳时可手动下载官方包后选择压缩包；展示当前偏好后端与建议包名（如 `crispasr-windows-x86_64-vulkan.zip`）  
   - **重新下载运行时**：强制重装 runtime，不碰模型  
   - **选择本地压缩包**：`.zip` / `.tar.gz`  
5. **卸载**：卸载模型 + 运行时（现有行为）  
6. **进度**：复用 `AsrInstallProgress`

按钮可用性：

| 操作 | 条件 |
|------|------|
| 安装模型 | supported 且未 installing；已完整 installed 时禁用（与现网一致） |
| 重新下载运行时 | supported 且未 installing（已安装也可点） |
| 选择本地压缩包 | 同上 |
| 选择本地 GGUF / URL | 同上 |

## 主进程 API

在现有 `asr:*` 上新增：

| Channel | 行为 |
|---------|------|
| `asr:reinstallRuntime` | 删除 `runtime/`，按 `preferredGpuBackend()` 下载并解压；写 backend marker；返回 `AsrStatus` |
| `asr:pickRuntimeArchive` | 打开文件对话框（zip / tar.gz），返回路径或 `null` |
| `asr:importRuntime` | 校验扩展名 → 清空 `runtime/` → 解压 → 校验可找到 binary → 将 marker 写成**当前偏好后端** → 返回 `AsrStatus` |

实现要点：

- 复用 `extractArchive`、`findBinary`、`writeBackendMarker`、`installRuntimeBackend` 中的解压/查找逻辑。
- `reinstallRuntime` = 无视 `runtimeMatchesPreferred()`，始终重下当前偏好后端（可抽 `force` 参数或独立函数）。
- 导入失败时清理半成品 runtime，并报可读错误（ASCII token + 渲染层本地化，与现有下载错误一致）。
- preload / `window.api.asr` / pinia store 同步暴露上述方法。

可选（便于 UI 文案）：`AsrStatus` 增加 `runtimeArchiveHint`（当前偏好后端对应的官方文件名），由 `resolveAsrBinaryAsset` 推导；若不加字段，渲染层用固定 i18n + backend 拼提示亦可。

## 数据与标记

- 运行时目录：`%APPDATA%/pi-desktop/asr/runtime`（现有）  
- Backend marker：现有 `.backend` 文件  
- 手动导入：**一律写入 `preferredGpuBackend()`**，即使用户实际选了 CPU 包而机器偏好 Vulkan——用户应对齐包类型；错误包会导致推理失败，错误信息沿用现有运行时错误路径。

## i18n

中英文新增键（示例）：

- `speech` / `asrSettingsTitle`：语音识别  
- `asrRuntimeTitle`：运行时  
- `asrRuntimeHint`：说明手动下载 + 选择压缩包  
- `asrRuntimeArchiveHint(name)`：建议包名  
- `asrRedownloadRuntime`：重新下载运行时  
- `asrPickRuntimeArchive`：选择本地压缩包  
- `asrRuntimeReady`：运行时已就绪  

## 验收

1. 外观设置中不再出现 ASR。  
2. 齿轮菜单可打开独立语音识别设置。  
3. 「重新下载运行时」会重新拉取并替换 runtime，模型文件仍在。  
4. 手动选官方 zip 后，状态变为可识别（`installed` 在模型已存在时为 true）。  
5. 听写不再因缺 runtime 卡在「准备运行时」；错误包给出明确失败，不静默成功。

## 风险

- 用户选错后端包（如 Vulkan 机选了 CPU zip）仍会标记为偏好后端 → 可能推理慢或失败；用文案提示「请选择与当前设备匹配的包」缓解。  
- Windows 仅 zip；macOS 为 tar.gz——对话框同时允许两种扩展名。
