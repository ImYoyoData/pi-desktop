import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { MenuProps } from "antd";
import * as prefsApi from "@renderer/utils/prefs";
import { useChatStore } from "@renderer/stores/chat";
import { useComposerStore } from "@renderer/stores/composer";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import {
  DRAFT_PREF_KEY,
  SESSION_PREFS_KEY,
  flatModelOptions,
  forgetPrefKey,
  modelKeyFromState,
  migrateLegacyPrefsToPi,
  parseSessionPrefs,
  prefKeyForBackend,
  resolveThinkingResult,
  serializeSessionPrefs,
  setPrefKey,
  thinkingFromState,
  thinkingLevelsFromWorker,
  type SessionPrefs,
} from "@renderer/utils/session-prefs";
import {
  EMPTY_MODEL_SELECTION,
  filterAvailableModels,
  isSameModelSelection,
  pruneStaleModelSelection,
  type ModelSelection,
} from "../../../../shared/model-selection";
import type { ModelsAvailableEntry } from "../../../../shared/models-settings";
import type { AgentBackend } from "../../../../shared/agent-backend";
import { currentBackend } from "@renderer/utils/current-backend";
import { SELECTED_MODEL_STYLE, buildModelMenu } from "@renderer/model-menu";
import {
  DEFAULT_SUPPORTED_THINKING_LEVELS,
  THINKING_LEVELS,
  clampThinkingLevel,
  isThinkingLevel,
  thinkingLevelLabel,
  type ThinkingLevel,
} from "@renderer/utils/thinking-level";
import { formatLlmError } from "@renderer/utils/llm-error";
import { getLocale } from "@renderer/i18n";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import { useLatest } from "./use-latest";

type ModelSelectOption =
  | {
      type: "group";
      label: string;
      key: string;
      children: { label: string; value: string }[];
    }
  | { label: string; value: string };

/**
 * 首屏读取会话偏好，并顺带做一次旧键迁移（裸会话 id → `pi\0<id>`）。
 *
 * 模块级缓存：组件重挂载时不必重复读写 localStorage。
 */
let cachedInitialPrefs: SessionPrefs | null = null;
function loadInitialPrefs(): SessionPrefs {
  if (cachedInitialPrefs) return cachedInitialPrefs;
  const initial = parseSessionPrefs(prefsApi.getItem(SESSION_PREFS_KEY));
  const migrated = migrateLegacyPrefsToPi(initial);
  if (migrated) {
    prefsApi.setItem(SESSION_PREFS_KEY, serializeSessionPrefs(migrated));
  }
  cachedInitialPrefs = migrated ?? initial;
  return cachedInitialPrefs;
}

type Params = {
  sessionId: string | null;
  /** 草稿首次发送建出真实会话后，把草稿的模型/档位迁移过去。 */
  draftCommitPendingRef: MutableRefObject<boolean>;
};

export function useComposerModels({
  sessionId,
  draftCommitPendingRef,
}: Params) {
  const t = useI18n();
  const messageApi = useMessage();
  const agentBackend = useWorkspaceStore((s) => s.backend);

  const availableModels = useLatest<ModelSelectOption[]>([]);
  /** 模型 → 真实可用思考档位；未加载的模型回退到 Pi 默认档位。 */
  const modelThinkingLevels = useLatest<Record<string, ThinkingLevel[] | undefined>>({});
  const selectedModel = useLatest<string | null>(null);
  const thinking = useLatest<ThinkingLevel>("medium");
  // 只读一次：导入引擎隔离的旧偏好（裸会话 id）同步升为 `pi\0<id>`，
  // 否则升级后各会话的模型选择会全部丢失。模块级缓存保证跨渲染只跑一次。
  const prefs = useLatest<SessionPrefs>(loadInitialPrefs());
  const modelMenuOpen = useLatest(false);

  const appliedModelForSessionRef = useRef<string | null>(null);
  /** 模型菜单最近一次关闭的时刻：用来吞掉双击的后半段。 */
  const modelMenuClosedAtRef = useRef(0);
  const prevSessionIdRef = useRef<string | null>(null);
  /** 上一次渲染时的引擎：换引擎要当作一次全新的会话绑定（模型/档位都不同）。 */
  const prevBackendRef = useRef<AgentBackend | null>(null);
  const sessionWatchReadyRef = useRef(false);

  function currentSessionId(): string | null {
    return useSessionsStore.getState().activeId;
  }

  /**
   * 模型/档位偏好的存储键。带引擎前缀：同一个会话 id 在 pi / omp 下的模型
   * 互不相通，切引擎后不会拿另一侧的 `provider/id` 去发 set_model。
   */
  function currentPrefsKey(): string | null {
    const state = useSessionsStore.getState();
    const raw = state.activeId ?? (state.draftRoot ? DRAFT_PREF_KEY : null);
    return raw ? prefKeyForBackend(currentBackend(), raw) : null;
  }

  /** 指定会话 id 的偏好键（用于跨会话继承模型）。 */
  function prefsKeyOf(sessionId: string): string {
    return prefKeyForBackend(currentBackend(), sessionId);
  }

  function persistSessionPrefs(next: SessionPrefs): void {
    prefsApi.setItem(SESSION_PREFS_KEY, serializeSessionPrefs(next));
  }

  function updatePrefs(next: SessionPrefs): void {
    prefs.set(next);
    persistSessionPrefs(next);
  }

  /**
   * 界面档位写入偏好；worker 会按模型能力 clamp 后回传实际档位。
   * `key` 是**带引擎前缀的完整偏好键**（currentPrefsKey / prefsKeyOf 的返回值）。
   */
  function adoptThinking(level: ThinkingLevel, key: string | null = currentPrefsKey()): void {
    thinking.set(level);
    if (key) writeThinkingPref(key, level);
  }

  /**
   * worker 会按模型能力 clamp 档位（模型未映射 xhigh/max 时回落到 high）。
   * 实际值不等于请求值就说明被 clamp，界面改成实际档位，避免显示与实际不符。
   */
  function adoptThinkingResult(
    requested: ThinkingLevel,
    result: unknown,
    key: string | null = currentPrefsKey(),
  ): void {
    const modelKey = selectedModel.ref.current;
    const levels = thinkingLevelsFromWorker(result, isThinkingLevel);
    if (levels && modelKey) {
      modelThinkingLevels.set({ ...modelThinkingLevels.ref.current, [modelKey]: levels });
    }
    // worker 未回传实际值时不动界面，只按用户选择记忆。
    const { actual, clamped } = resolveThinkingResult(requested, result, isThinkingLevel);
    if (!clamped) {
      if (key) writeThinkingPref(key, requested);
      return;
    }
    adoptThinking(actual, key);
  }

  /** 当前模型的真实可用档位；数据缺失时按 Pi 默认，空集合按 off 处理。 */
  function allowedThinkingLevels(model: string | null): ThinkingLevel[] {
    const allowed = model ? modelThinkingLevels.ref.current[model] : undefined;
    if (allowed === undefined) return [...DEFAULT_SUPPORTED_THINKING_LEVELS];
    return allowed.length ? allowed : ["off"];
  }

  /** 写入完整偏好键（已带引擎前缀）。 */
  function writeModelPref(fullKey: string, modelKey: string): void {
    updatePrefs(setPrefKey(prefs.ref.current, "models", fullKey, modelKey));
  }

  function writeThinkingPref(fullKey: string, level: ThinkingLevel): void {
    updatePrefs(setPrefKey(prefs.ref.current, "thinking", fullKey, level));
  }

  /** 按原始会话 id 记住当前引擎下的模型 / 档位（内部加引擎前缀）。 */
  function rememberModel(sessionId: string, modelKey: string): void {
    writeModelPref(prefsKeyOf(sessionId), modelKey);
  }

  function rememberThinking(sessionId: string, level: ThinkingLevel): void {
    writeThinkingPref(prefsKeyOf(sessionId), level);
  }

  /** 清掉某个记忆键（带引擎前缀的完整键），避免草稿转正后残留悬挂偏好。 */
  function forgetPrefs(fullKey: string): void {
    const next = forgetPrefKey(prefs.ref.current, fullKey);
    if (next === prefs.ref.current) return;
    updatePrefs(next);
  }

  const thinkingOptions = thinkingLevelsFor(selectedModel.value);
  const effectiveThinking = clampThinkingLevel(
    thinking.value,
    thinkingOptions.map((option) => option.value),
  );
  const thinkingMenu: MenuProps["items"] = thinkingOptions.map((o) => ({
    label: o.label,
    key: o.value,
    style: o.value === effectiveThinking ? SELECTED_MODEL_STYLE : undefined,
  }));

  const thinkingLabel = thinkingLevelLabel(effectiveThinking) ?? "Medium";

  const modelMenu = buildModelMenu(availableModels.value, selectedModel.value);

  const modelLabel =
    flatModelOptions(availableModels.value).find(
      (o) => o.value === selectedModel.value,
    )?.label ?? t.modelPlaceholder;

  async function onThinkingChange(value: string | number): Promise<void> {
    const level = String(value);
    if (!isThinkingLevel(level)) return;
    if (!allowedThinkingLevels(selectedModel.ref.current).includes(level)) return;
    const previous = thinking.ref.current;
    const key = currentPrefsKey();
    adoptThinking(level, key);
    const id = currentSessionId();
    if (!id) return;
    let result: unknown;
    try {
      result = await useSessionsStore.getState().sendCommand(id, {
        type: "set_thinking_level",
        level,
        persist: true,
      });
    } catch (err) {
      adoptThinking(previous, key);
      const text = err instanceof Error ? err.message : String(err);
      messageApi.error(formatLlmError(text, getLocale()));
      return;
    }
    const { actual } = resolveThinkingResult(level, result, isThinkingLevel);
    adoptThinkingResult(actual, result, key);
    try {
      // Pi 的首次 persist 记录请求值；再用实际档位覆盖一次。
      const persisted = await useSessionsStore.getState().sendCommand(id, {
        type: "set_thinking_level",
        level: actual,
        persist: true,
      });
      adoptThinkingResult(actual, persisted, key);
    } catch {
      // 档位已生效，仅默认值未保存；不回滚界面。
    }
  }

  /**
   * 取当前引擎自己的模型目录。
   *
   * pi 与 omp 的配置互不相干（models.json vs models.yml），模型 id 也只在各自
   * 后端里成立。把 pi 的 provider/id 发给 omp worker 的 set_model 只会得到
   * `Model not found` —— 切引擎后首条消息报错就是这么来的。
   */
  async function loadAvailableModels(): Promise<{
    available: ModelsAvailableEntry[];
    selection: ModelSelection;
  }> {
    if (currentBackend() === "omp") {
      // omp 运行时没有「桌面端筛选」这层：worker 返回的就是它认得的一切。
      const available = await window.api.ompModels.list();
      return { available, selection: EMPTY_MODEL_SELECTION };
    }
    const data = await window.api.models.get();
    const stored = data.modelSelection ?? EMPTY_MODEL_SELECTION;
    // Honour the Settings → Models curation so a 300-model provider does not
    // flood the menu; providers without a curation pass through untouched.
    //
    // Prune first. A curation whose ids were all renamed/replaced upstream would
    // otherwise filter the provider's *new* models away and leave the menu empty —
    // which reads as "this session has no model config". Persist the pruned
    // selection so the stale entry does not come back on the next launch.
    const selection = pruneStaleModelSelection(stored, data.available);
    if (!isSameModelSelection(stored, selection)) {
      try {
        await window.api.models.setSelection(selection);
      } catch {
        // Self-heal is best-effort: an unwritable store must not break the menu.
      }
    }
    return { available: data.available, selection };
  }

  async function refreshModels(): Promise<void> {
    try {
      // 引擎在请求期间可能被切走：回来时对不上就丢弃这次结果，免得把 pi 的
      // 模型写进 omp 的菜单（反之亦然）。
      const backendAtStart = currentBackend();
      const loaded = await loadAvailableModels();
      const available = loaded.available;
      if (currentBackend() !== backendAtStart) return;
      const selected = filterAvailableModels(available, loaded.selection);
      const byProvider = new Map<string, { label: string; value: string }[]>();
      const levelsByModel: Record<string, ThinkingLevel[] | undefined> = {};
      for (const m of selected) {
        const list = byProvider.get(m.provider) ?? [];
        const label = (m.name && m.name.trim()) || m.id;
        list.push({ label, value: `${m.provider}/${m.id}` });
        byProvider.set(m.provider, list);
        levelsByModel[`${m.provider}/${m.id}`] = m.thinkingLevels;
      }
      const groups: ModelSelectOption[] = [...byProvider.entries()].map(
        ([provider, children]) => ({
          type: "group",
          label: provider,
          key: provider,
          children,
        }),
      );
      availableModels.set(groups);
      modelThinkingLevels.set(levelsByModel);
      await syncSessionModelAndThinking();
    } catch (err) {
      // Keep whatever list we already had: blanking it turns a transient failure
      // into a dead model button with no way back.
      console.warn("[composer] failed to refresh models", err);
    }
  }

  async function syncSessionModelAndThinking(): Promise<void> {
    const realId = currentSessionId();
    const key = currentPrefsKey();
    const flat = flatModelOptions(availableModels.value);
    if (!key) {
      selectedModel.set(flat[0]?.value ?? null);
      return;
    }

    // Instant UI from per-session (or draft) memory
    const remembered = prefs.ref.current.models[key];
    if (remembered && flat.some((o) => o.value === remembered)) {
      selectedModel.set(remembered);
    }
    const rememberedThinking = prefs.ref.current.thinking[key];
    if (rememberedThinking) {
      thinking.set(rememberedThinking);
    }

    // New session with no saved prefs: inherit model + thinking level from the
    // workspace's first session (sidebar top) so new chats match the user's setup.
    if (!remembered && !rememberedThinking) {
      const first = useSessionsStore.getState().sessions[0];
      if (first && first.id !== realId) {
        const firstKey = prefsKeyOf(first.id);
        const firstModel = prefs.ref.current.models[firstKey];
        const firstThinking = prefs.ref.current.thinking[firstKey];
        if (firstModel && flat.some((o) => o.value === firstModel)) {
          selectedModel.set(firstModel);
        }
        if (firstThinking) thinking.set(firstThinking);
      }
    }

    // 草稿没有 worker 可查，选定模型/等级就位后直接返回。
    if (!realId) {
      if (
        !selectedModel.ref.current ||
        !flat.some((o) => o.value === selectedModel.ref.current)
      ) {
        selectedModel.set(flat[0]?.value ?? null);
      }
      const desired = clampThinkingLevel(
        thinking.ref.current,
        allowedThinkingLevels(selectedModel.ref.current),
      );
      if (desired !== thinking.ref.current) adoptThinking(desired, key);
      return;
    }

    // Prefer live worker state when agent is already running (never cold-start here).
    let workerKey: string | null = null;
    let workerThinking: ThinkingLevel | null = null;
    let workerLevels: ThinkingLevel[] | null = null;
    try {
      const state = await useSessionsStore.getState().tryCommand(realId, {
        type: "get_state",
      });
      if (state !== undefined) {
        workerKey = modelKeyFromState(state);
        workerThinking = thinkingFromState(state, isThinkingLevel);
        workerLevels = thinkingLevelsFromWorker(state, isThinkingLevel);
        useSessionsStore.getState().applyContextFromState(realId, state);
      }
    } catch {
      // ignore sync failures
    }

    if (workerKey && flat.some((o) => o.value === workerKey)) {
      selectedModel.set(workerKey);
      rememberModel(realId, workerKey);
    } else if (remembered && flat.some((o) => o.value === remembered)) {
      selectedModel.set(remembered);
    } else if (
      !selectedModel.ref.current ||
      !flat.some((o) => o.value === selectedModel.ref.current)
    ) {
      selectedModel.set(flat[0]?.value ?? null);
    }

    // Only push model to a live worker — first prompt cold-starts the agent.
    if (selectedModel.ref.current && workerKey !== null) {
      const token = `${realId}::${selectedModel.ref.current}`;
      if (workerKey !== selectedModel.ref.current || appliedModelForSessionRef.current !== token) {
        appliedModelForSessionRef.current = null;
        await applySelectedModel({ allowStart: false });
      } else {
        appliedModelForSessionRef.current = token;
        rememberModel(realId, selectedModel.ref.current);
      }
    }

    // 界面与 worker 各自保留档位；不一致（如会话切换）时把界面值同步过去。
    if (rememberedThinking) {
      thinking.set(rememberedThinking);
    } else if (workerThinking) {
      adoptThinking(workerThinking, prefsKeyOf(realId));
    }
    const modelKeyNow = selectedModel.ref.current;
    if (workerLevels && modelKeyNow && workerKey === modelKeyNow) {
      modelThinkingLevels.set({ ...modelThinkingLevels.ref.current, [modelKeyNow]: workerLevels });
    }
    const desired = clampThinkingLevel(
      thinking.ref.current,
      allowedThinkingLevels(modelKeyNow),
    );
    if (desired !== thinking.ref.current) adoptThinking(desired, prefsKeyOf(realId));
    if (workerThinking !== null && workerThinking !== desired) {
      try {
        const result = await useSessionsStore.getState().tryCommand(realId, {
          type: "set_thinking_level",
          level: desired,
        });
        adoptThinkingResult(desired, result, prefsKeyOf(realId));
      } catch {
        // ignore thinking sync failures
      }
    }
  }

  async function applySelectedModel(opts?: { allowStart?: boolean }): Promise<void> {
    const sessionsState = useSessionsStore.getState();
    const id = sessionsState.activeId;
    const value = selectedModel.ref.current;
    if (!id || !value) return;
    // Session must be registered in the broker (present in live sessions list).
    if (!sessionsState.sessions.some((s) => s.id === id)) return;
    const slash = value.indexOf("/");
    if (slash <= 0) return;
    const token = `${id}::${value}`;
    if (appliedModelForSessionRef.current === token) return;
    const allowStart = opts?.allowStart === true;
    try {
      const command = {
        type: "set_model" as const,
        provider: value.slice(0, slash),
        modelId: value.slice(slash + 1),
      };
      if (allowStart) {
        await useSessionsStore.getState().sendCommand(id, command);
      } else {
        const applied = await useSessionsStore.getState().tryCommand(id, command);
        if (applied === undefined) {
          // No live worker yet — keep UI selection; first prompt will apply.
          rememberModel(id, value);
          return;
        }
      }
      appliedModelForSessionRef.current = token;
      rememberModel(id, value);
    } catch (err) {
      appliedModelForSessionRef.current = null;
      const text = err instanceof Error ? err.message : String(err);
      // Startup race / cold worker / post-auth reload: don't toast transient noise.
      if (/unknown session|Model not found/i.test(text)) return;
      messageApi.error(formatLlmError(text, getLocale()));
    }
  }

  /**
   * 模型菜单的开关：打开由按钮自己决定，关闭交给 antd（点按钮、点菜单项、点外部）。
   * 关闭后短时间内再点按钮不重开——那是双击的后半段，否则会出现「点开之后再点一次
   * 不是关闭而是重新打开」。
   */
  function onModelMenuToggle(): void {
    if (modelMenuOpen.value) return;
    if (Date.now() - modelMenuClosedAtRef.current < 250) return;
    modelMenuOpen.set(true);
  }

  function onModelMenuOpenChange(next: boolean): void {
    // 关闭一律跟随 antd 的判定（点按钮、点菜单项、点外部都走这里）。
    if (next) return;
    modelMenuClosedAtRef.current = Date.now();
    modelMenuOpen.set(false);
  }

  async function onModelChange(value: string | number): Promise<void> {
    // Switching models while Pi is replying is allowed. The worker applies it to
    // the live session immediately (and when no worker is warm the choice is
    // remembered for the next prompt), so the picker must not silently swallow
    // the click.
    const key = String(value);
    const requested = thinking.ref.current;
    selectedModel.set(key);
    appliedModelForSessionRef.current = null;
    const prefsKeyValue = currentPrefsKey();
    if (prefsKeyValue && key) writeModelPref(prefsKeyValue, key);
    await applySelectedModel({ allowStart: false });
    const desired = clampThinkingLevel(requested, allowedThinkingLevels(key));
    adoptThinking(desired, prefsKeyValue);
    const id = currentSessionId();
    if (!id) return;
    try {
      const result = await useSessionsStore.getState().tryCommand(id, {
        type: "set_thinking_level",
        level: desired,
      });
      if (result !== undefined) adoptThinkingResult(desired, result, prefsKeyValue);
    } catch {
      // 保持本地选择；下一次发送会重新下发。
    }
  }

  /** 快捷键：循环到下一个模型 / 思考等级。 */
  const cycleModel = useCallback((): void => {
    const options = flatModelOptions(availableModels.ref.current);
    if (!options.length) return;
    const index = options.findIndex((o) => o.value === selectedModel.ref.current);
    const next = options[(index + 1) % options.length];
    if (next) void onModelChange(next.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与原实现一致：只依赖 latest 容器
  }, [availableModels, selectedModel]);

  /** 思考档位菜单只列当前模型真实可用的档位。 */
  function thinkingLevelsFor(model: string | null): { value: ThinkingLevel; label: string }[] {
    const allowed = allowedThinkingLevels(model);
    return THINKING_LEVELS.filter((level) => allowed.includes(level.value));
  }

  const cycleThinking = useCallback((): void => {
    const levels = thinkingLevelsFor(selectedModel.ref.current);
    const current = clampThinkingLevel(
      thinking.ref.current,
      levels.map((o) => o.value),
    );
    const index = levels.findIndex((o) => o.value === current);
    const next = levels[(index + 1) % levels.length];
    if (next) void onThinkingChange(next.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与原实现一致：只依赖 latest 容器
  }, [thinking, selectedModel]);

  function onModelsChanged(): void {
    void refreshModels();
  }

  useEffect(() => {
    useKeybindingsStore.getState().register("cycle-model", cycleModel);
    useKeybindingsStore.getState().register("cycle-thinking", cycleThinking);
    return () => {
      useKeybindingsStore.getState().unregister("cycle-model");
      useKeybindingsStore.getState().unregister("cycle-thinking");
    };
  }, [cycleModel, cycleThinking]);

  useEffect(() => {
    useComposerStore.getState().bindSession(useSessionsStore.getState().activeId);
    void refreshModels();
    window.addEventListener("pi-models-changed", onModelsChanged);
    return () => {
      window.removeEventListener("pi-models-changed", onModelsChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时执行，与原实现一致
  }, []);

  useEffect(() => {
    const id = sessionId;
    const backend = currentBackend();
    const prev = prevSessionIdRef.current;
    const prevBackend = prevBackendRef.current ?? backend;
    const backendChanged = prevBackend !== backend;
    if (!sessionWatchReadyRef.current) {
      sessionWatchReadyRef.current = true;
      prevSessionIdRef.current = id;
      prevBackendRef.current = backend;
      return;
    }
    prevSessionIdRef.current = id;
    prevBackendRef.current = backend;
    if (useChatStore.getState().pendingUserEdit) {
      useChatStore.getState().cancelEditUser();
    }
    useComposerStore.getState().bindSession(id);

    // 草稿首次发送成功建出真实会话：把草稿的模型/思考选择迁移过去。
    if (id && !prev && draftCommitPendingRef.current) {
      draftCommitPendingRef.current = false;
      const draftKey = prefKeyForBackend(backend, DRAFT_PREF_KEY);
      const draftModel = prefs.ref.current.models[draftKey];
      const draftThinking = prefs.ref.current.thinking[draftKey];
      if (draftModel) rememberModel(id, draftModel);
      if (draftThinking) rememberThinking(id, draftThinking);
      forgetPrefs(draftKey);
    }

    // 离开上一个会话时保存选择。
    //
    // 切引擎时 `prev` 属于**另一个后端**：pi 的模型 id 在 omp 里根本不存在，
    // 不能写到新引擎的偏好键下——那正是切到 omp 后首条消报 Model not found 的
    // 原因之一。这时按旧引擎的键写回，当前这次选择也一并丢弃。
    if (prev && !backendChanged) {
      if (selectedModel.ref.current) rememberModel(prev, selectedModel.ref.current);
      rememberThinking(prev, thinking.ref.current);
    }
    // 切会话（或切引擎）后 worker 里的模型对不上了，允许重新下发。
    appliedModelForSessionRef.current = null;
    if (backendChanged) {
      // 旧引擎的模型 key 在新菜单里不成立：清掉选中值与整个菜单，
      // 等下面 refreshModels 拉回新引擎的列表。否则旧列表仍可点，
      // 点下去就是一次注定失败的 set_model。
      selectedModel.set(null);
      availableModels.set([]);
      modelThinkingLevels.set({});
    }
    // Restore remembered UI immediately before async sync
    const nextKey = id ? prefsKeyOf(id) : null;
    if (nextKey && prefs.ref.current.models[nextKey]) {
      selectedModel.set(prefs.ref.current.models[nextKey]);
    }
    if (nextKey && prefs.ref.current.thinking[nextKey]) {
      thinking.set(prefs.ref.current.thinking[nextKey]);
    } else if (id) {
      // 新会话没有记忆时沿用当前档位，不因 worker 默认值回退。
      rememberThinking(id, thinking.ref.current);
    }
    void refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖会话与引擎，函数每轮重建
  }, [sessionId, agentBackend]);

  return {
    availableModels,
    selectedModel,
    thinking,
    prefs,
    modelMenuOpen,
    modelMenu,
    modelLabel,
    thinkingMenu,
    thinkingLabel,
    onModelMenuToggle,
    onModelMenuOpenChange,
    onModelChange,
    onThinkingChange,
    cycleModel,
    cycleThinking,
    applySelectedModel,
    adoptThinking,
    adoptThinkingResult,
    allowedThinkingLevels,
    currentPrefsKey,
    prefsKeyOf,
  };
}
