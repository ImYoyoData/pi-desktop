import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, InputNumber, Select, Spin } from "antd";
import { EyeOffOutline, EyeOutline } from "@renderer/components/icons/ionicons";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import ToggleButton from "@renderer/components/ToggleButton";
import ModelPickModal from "@renderer/components/customize/ModelPickModal";
import ProviderLogin from "@renderer/components/customize/ProviderLogin";
import type {
  ModelsAvailableEntry,
  ModelsQuotaResult,
  ModelsProviderAuth,
} from "../../../../shared/models-settings";
import {
  CUSTOM_MODEL_APIS,
  emptyCustomProvider,
  listEditableProviders,
  mergeDiscoveredIntoDraft,
  newModelEntry,
  parseModelsConfigText,
  removeCustomProvider,
  renameCustomProvider,
  stringifyModelsConfig,
  upsertCustomProvider,
  validateCustomProvider,
  type CustomModelEntry,
  type CustomProviderDraft,
} from "../../../../shared/custom-models";
import {
  normalizeProviderBaseUrl,
  type DiscoveredModel,
} from "../../../../shared/model-discover";
import {
  EMPTY_MODEL_SELECTION,
  isProviderDisabled,
  withProviderDisabled,
  type ModelSelection,
} from "../../../../shared/model-selection";
import { useDialog, useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CustomizeModels.module.css";

export function CustomizeModels(): ReactNode {
  const message = useMessage();
  const dialog = useDialog();
  const t = useI18n();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [oauthOpen, setOauthOpen] = useState(false);
  const [providers, setProviders] = useState<CustomProviderDraft[]>([]);
  /** 通过 OAuth 登录的内置提供商（凭据在 auth.json，不在 models.json）。 */
  const [oauthSignedIn, setOauthSignedIn] = useState<ModelsProviderAuth[]>([]);
  /** 目录中当前可用的模型（含 OAuth 提供商），详情面板只读展示。 */
  const [available, setAvailable] = useState<ModelsAvailableEntry[]>([]);
  /** 当前在详情区展示的 OAuth 提供商。 */
  const [selectedOAuthId, setSelectedOAuthIdState] = useState<string | null>(null);
  /** 桌面端策展状态：仅存于本地配置，不写 models.json。 */
  const [modelSelection, setModelSelection] = useState<ModelSelection>(EMPTY_MODEL_SELECTION);

  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<CustomProviderDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<CustomProviderDraft | null>(null);
  /** API Key 默认以等长 * 掩码展示，点眼睛才显示明文。 */
  const [keyVisible, setKeyVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  /** 正在测试的模型行 key（同时只测一个）。 */
  const [testingRow, setTestingRow] = useState<string | null>(null);
  /** 正在测试提供商地址连通性/延迟。 */
  const [testingBaseUrl, setTestingBaseUrl] = useState(false);
  const [formError, setFormError] = useState("");

  /** 「拉取模型」结果弹窗：手动勾选后再合并进模型列表。 */
  const [pickOpen, setPickOpen] = useState(false);
  const [pickRows, setPickRows] = useState<DiscoveredModel[]>([]);

  /** 模型行用稳定 key，删除行时不串输入框。 */
  const [modelRowKeys, setModelRowKeys] = useState<string[]>([]);
  const rowKeySeq = useRef(0);

  const [samplingOpen, setSamplingOpen] = useState<Record<string, boolean>>({});

  const [quota, setQuota] = useState<ModelsQuotaResult | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);

  const modelsText = useRef("");
  const selectedIdRef = useRef<string | null>(null);
  const selectedOAuthIdRef = useRef<string | null>(null);

  const apiOptions = CUSTOM_MODEL_APIS.map((api) => ({ label: api, value: api }));

  function setSelectedId(next: string | null): void {
    selectedIdRef.current = next;
    setSelectedIdState(next);
  }

  function setSelectedOAuthId(next: string | null): void {
    selectedOAuthIdRef.current = next;
    setSelectedOAuthIdState(next);
  }

  const dirty = Boolean(
    draft && savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft),
  );

  const keyMasked = "*".repeat(draft?.apiKey.length ?? 0);

  const existingModelIds = draft?.models.map((model) => model.id.trim()).filter(Boolean) ?? [];

  const providerId = selectedId ?? draft?.id.trim() ?? "";
  const providerDisabled = Boolean(providerId) && isProviderDisabled(modelSelection, providerId);

  useEffect(() => {
    void load(null, { refreshCatalog: true });
  }, []);

  function cloneDraft(src: CustomProviderDraft): CustomProviderDraft {
    return { ...src, models: src.models.map((model) => ({ ...model })) };
  }

  function nextRowKey(): string {
    rowKeySeq.current += 1;
    return `m-${rowKeySeq.current}`;
  }

  function resetRowKeys(count: number): void {
    const keys: string[] = [];
    for (let i = 0; i < count; i += 1) keys.push(nextRowKey());
    setModelRowKeys(keys);
  }

  /**
   * 加载模型页数据。仅进入页面时联网刷新目录（让 OpenRouter 等按当前密钥
   * 列出模型与价格）；保存、删除、登出后的重载用已缓存目录，避免多余网络往返。
   */
  async function load(
    preferId?: string | null,
    options?: { refreshCatalog?: boolean },
  ): Promise<void> {
    setLoading(true);
    setLoadError("");
    try {
      const data = await window.api.models.get(options);
      const list = listEditableProviders(parseModelsConfigText(data.modelsText));
      const signedIn = data.providers.filter((p) => p.oauth && p.configured);
      modelsText.current = data.modelsText;
      setModelSelection(data.modelSelection ?? EMPTY_MODEL_SELECTION);
      setProviders(list);
      setAvailable(data.available);
      setOauthSignedIn(signedIn);
      const currentOauth = selectedOAuthIdRef.current;
      if (currentOauth && !signedIn.some((p) => p.id === currentOauth)) {
        setSelectedOAuthId(null);
      }
      const currentId = selectedIdRef.current;
      const nextId =
        (preferId && list.some((p) => p.id === preferId) ? preferId : null) ??
        (currentId && list.some((p) => p.id === currentId) ? currentId : null) ??
        list[0]?.id ??
        null;
      if (nextId) {
        const row = list.find((p) => p.id === nextId);
        applyProviderSelection(row ?? null, nextId);
      } else {
        clearDraft();
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function clearDraft(): void {
    setSelectedId(null);
    setIsNew(false);
    setKeyVisible(false);
    setFormError("");
    setDraft(null);
    setSavedDraft(null);
    resetRowKeys(0);
  }

  function applyProviderSelection(row: CustomProviderDraft | null, id: string | null): void {
    if (!row) {
      clearDraft();
      return;
    }
    setSelectedId(id);
    setIsNew(false);
    setKeyVisible(false);
    setFormError("");
    setDraft(cloneDraft(row));
    setSavedDraft(cloneDraft(row));
    resetRowKeys(row.models.length);
  }

  function selectProvider(id: string): void {
    const row = providers.find((p) => p.id === id);
    if (!row) return;
    applyProviderSelection(row, id);
  }

  function beginAdd(): void {
    const blank = emptyCustomProvider({ baseUrl: "" });
    setSelectedId(null);
    setIsNew(true);
    setKeyVisible(false);
    setFormError("");
    setDraft(cloneDraft(blank));
    setSavedDraft(cloneDraft(blank));
    resetRowKeys(blank.models.length);
  }

  /** 有未保存修改时先确认，再执行切换（新增 / 选择其它提供商）。 */
  function confirmDiscard(run: () => void): void {
    if (!dirty) {
      run();
      return;
    }
    dialog.warning({
      title: t.modelsCustomDirty,
      content: t.modelsCustomDiscardConfirm,
      positiveText: t.modelsCustomReset,
      negativeText: t.cancel,
      onPositiveClick: run,
    });
  }

  function onSelectProvider(id: string): void {
    if (id === selectedId && !isNew && !selectedOAuthId) return;
    confirmDiscard(() => {
      setSelectedOAuthId(null);
      selectProvider(id);
    });
  }

  /** OAuth 提供商在详情区只读展示，不进入草稿编辑流程。 */
  function onSelectOauth(id: string): void {
    if (id === selectedOAuthId) return;
    confirmDiscard(() => {
      setSelectedOAuthId(id);
      clearDraft();
      void loadQuota(false, id);
    });
  }

  async function signOutOauth(id: string): Promise<void> {
    try {
      await window.api.models.oauthLogout(id);
      message.success(t.providerAuthLoggedOut);
      window.dispatchEvent(new Event("pi-models-changed"));
      setSelectedOAuthId(null);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function oauthModelCount(id: string): number {
    return available.filter((m) => m.provider === id).length;
  }

  const selectedOauth =
    oauthSignedIn.find((p) => p.id === selectedOAuthId) ?? null;

  const oauthProviderDisabled = selectedOauth
    ? isProviderDisabled(modelSelection, selectedOauth.id)
    : false;

  /** OAuth 提供商同样走桌面端策展：关闭后其模型从选择器中隐藏，不动 auth.json。 */
  async function setOauthProviderDisabled(value: boolean): Promise<void> {
    const id = selectedOauth?.id ?? "";
    if (!id) return;
    const next = withProviderDisabled(modelSelection, id, value);
    setModelSelection(next);
    try {
      await window.api.models.setSelection(next);
      message.success(value ? t.modelsCustomDisabled : t.modelsCustomEnable);
    } catch (err) {
      setModelSelection((prev) => withProviderDisabled(prev, id, !value));
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  /** 每百万 token 价格；免费模型返回 null。 */
  function priceLabel(rate: number): string | null {
    if (!rate) return null;
    return `$${rate}/M`;
  }

  function costLabel(entry: ModelsAvailableEntry): string | null {
    const input = priceLabel(entry.cost.input);
    const output = priceLabel(entry.cost.output);
    if (!input && !output) return t.modelsAuthFree;
    return [input ? `${t.modelsAuthIn} ${input}` : null, output ? `${t.modelsAuthOut} ${output}` : null]
      .filter(Boolean)
      .join(" · ");
  }

  function formatTokenCount(value: number): string {
    return value.toLocaleString();
  }

  function modalLabel(entry: ModelsAvailableEntry): string {
    const labels: string[] = [];
    if (entry.input.includes("text")) labels.push(t.modelsAuthModalText);
    if (entry.input.includes("image")) labels.push(t.modelsAuthModalImage);
    return labels.join(" + ");
  }

  const oauthModels = selectedOauth
    ? available.filter((m) => m.provider === selectedOauth.id)
    : [];

  function formatUsd(value: number): string {
    return `$${value.toFixed(2)}`;
  }

  const QUOTA_WINDOW_LABELS = {
    primary: () => t.modelsAuthQuotaPrimary,
    secondary: () => t.modelsAuthQuotaSecondary,
    total: () => t.modelsAuthQuotaTotal,
    onDemand: () => t.modelsAuthQuotaOnDemand,
    premium: () => t.modelsAuthQuotaPremium,
    chat: () => t.modelsAuthQuotaChat,
  } as const;

  /** 余额型（OpenRouter credits）文案。 */
  const balanceLine = (() => {
    const q = quota;
    if (!q?.supported) return "";
    if (q.remaining !== undefined) {
      return q.total !== undefined
        ? t.modelsAuthQuotaRemaining(formatUsd(q.remaining), formatUsd(q.total))
        : t.modelsAuthQuotaRemaining(formatUsd(q.remaining));
    }
    if (q.used !== undefined && !q.windows?.length) {
      return t.modelsAuthQuotaSpent(formatUsd(q.used));
    }
    return "";
  })();

  /** 逐周期用量文案；主进程只给结构化数据，文案在此按当前语言生成。 */
  const quotaLines = (quota?.windows ?? []).map((window) => {
    const name = QUOTA_WINDOW_LABELS[window.kind]();
    const reset = window.resetAt ? window.resetAt.slice(0, 10) : undefined;
    if (window.limit === undefined) {
      return t.modelsAuthQuotaUsedNoLimit(name, formatTokenCount(window.used), reset);
    }
    const percent = Math.max(0, Math.min(100, (window.used / window.limit) * 100));
    return t.modelsAuthQuotaUsed(
      name,
      percent.toFixed(0),
      formatTokenCount(window.used),
      formatTokenCount(window.limit),
      reset,
    );
  });

  async function loadQuota(force = false, providerIdOverride?: string): Promise<void> {
    const id = providerIdOverride ?? selectedOauth?.id ?? "";
    if (!id) return;
    if (quotaLoading) return;
    if (!force && quota?.providerId === id) return;
    setQuotaLoading(true);
    try {
      setQuota(await window.api.models.fetchQuota(id));
    } catch (err) {
      setQuota({
        providerId: id,
        supported: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setQuotaLoading(false);
    }
  }

  function onAddProvider(): void {
    confirmDiscard(beginAdd);
  }

  function resetDraft(): void {
    if (!draft || !savedDraft) return;
    const count = savedDraft.models.length;
    setDraft(cloneDraft(savedDraft));
    setKeyVisible(false);
    setFormError("");
    resetRowKeys(count);
  }

  function updateDraft(patch: Partial<CustomProviderDraft>): void {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function updateModel(index: number, patch: Partial<CustomModelEntry>): void {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        models: prev.models.map((model, i) => (i === index ? { ...model, ...patch } : model)),
      };
    });
  }

  function addModelRow(): void {
    const key = nextRowKey();
    setDraft((prev) => (prev ? { ...prev, models: [...prev.models, newModelEntry()] } : prev));
    setModelRowKeys((prev) => [...prev, key]);
  }

  function removeModelRow(index: number): void {
    const current = draft;
    if (!current) return;
    const models = current.models.filter((_, i) => i !== index);
    let keys = modelRowKeys.filter((_, i) => i !== index);
    if (!models.length) {
      models.push(newModelEntry());
      keys = [...keys, nextRowKey()];
    }
    setModelRowKeys(keys);
    setDraft({ ...current, models });
  }

  function setModelNumber(
    index: number,
    key: "contextWindow" | "maxTokens",
    value: number | null,
  ): void {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        models: prev.models.map((model, i) => {
          if (i !== index) return model;
          const next = { ...model };
          if (value === null || !Number.isFinite(value) || value <= 0) delete next[key];
          else next[key] = Math.floor(value);
          return next;
        }),
      };
    });
  }

  function samplingRowKey(index: number): string {
    return modelRowKeys[index] ?? String(index);
  }

  function toggleSampling(index: number): void {
    const key = samplingRowKey(index);
    setSamplingOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function onApiKeyInput(value: string): void {
    updateDraft({ apiKey: value });
  }

  function setCompat(
    key: "supportsDeveloperRole" | "supportsReasoningEffort",
    value: boolean,
  ): void {
    updateDraft({ [key]: value });
  }

  /** 开关桌面端的提供商禁用状态（只影响本应用，不写 models.json）。 */
  async function setProviderDisabled(value: boolean): Promise<void> {
    const id = (selectedId ?? draft?.id.trim() ?? "").trim();
    if (!id) {
      message.warning(t.modelsCustomIdRequired);
      return;
    }
    const next = withProviderDisabled(modelSelection, id, value);
    setModelSelection(next);
    try {
      await window.api.models.setSelection(next);
      message.success(value ? t.modelsCustomDisabled : t.modelsCustomEnable);
    } catch (err) {
      setModelSelection((prev) => withProviderDisabled(prev, id, !value));
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function providerHint(provider: CustomProviderDraft): string {
    if (!provider.baseUrl) return provider.api;
    try {
      return new URL(provider.baseUrl).host;
    } catch {
      return provider.baseUrl;
    }
  }

  function providerModelCount(provider: CustomProviderDraft): number {
    return provider.models.filter((model) => model.id.trim()).length;
  }

  function localValidationError(current: CustomProviderDraft): string {
    const id = current.id.trim();
    if (!id) return t.modelsCustomIdRequired;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) return t.modelsCustomIdInvalid;
    if (!current.baseUrl.trim()) return t.modelsCustomBaseUrlRequired;
    try {
      // eslint-disable-next-line no-new
      new URL(normalizeProviderBaseUrl(current.baseUrl) || current.baseUrl.trim());
    } catch {
      return t.modelsCustomBaseUrlInvalid;
    }
    if (providers.some((p) => p.id === id && p.id !== selectedId)) {
      return t.modelsCustomIdExists(id);
    }
    const modelIds = current.models.map((model) => model.id.trim()).filter(Boolean);
    if (!modelIds.length) return t.modelsCustomModelsRequired;
    if (new Set(modelIds).size !== modelIds.length) return t.modelsCustomModelsDuplicate;
    return "";
  }

  function normalizedDraft(): CustomProviderDraft | null {
    const current = draft;
    if (!current) return null;
    const baseUrl = normalizeProviderBaseUrl(current.baseUrl);
    if (baseUrl === current.baseUrl) return current;
    const next = { ...current, baseUrl };
    setDraft(next);
    return next;
  }

  async function save(): Promise<void> {
    const current = normalizedDraft();
    if (!current || saving) return;
    const localError = localValidationError(current);
    if (localError) {
      setFormError(localError);
      message.error(localError);
      return;
    }
    const id = current.id.trim();
    setSaving(true);
    try {
      const doc = parseModelsConfigText(modelsText.current);
      const invalid = validateCustomProvider(current, {
        editingId: isNew ? null : selectedId,
        existingIds: Object.keys(doc.providers),
      });
      if (invalid) {
        setFormError(invalid);
        message.error(invalid);
        return;
      }
      const previousId = isNew ? "" : (selectedId ?? id).trim();
      const next = isNew
        ? upsertCustomProvider(doc, current)
        : renameCustomProvider(doc, previousId, current);
      await window.api.models.set({
        modelsText: stringifyModelsConfig(next),
        // 旧 auth.json 凭据优先于 models.json，同名条目必须一并清除。
        clearAuth: [...new Set([id, previousId].filter(Boolean))],
      });
      await load(id);
      setFormError("");
      notifyModelsChanged();
      message.success(t.modelsCustomSaved);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setFormError(text);
      message.error(text);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(): void {
    const current = draft;
    if (!current) return;
    const id = (selectedId ?? current.id.trim()).trim();
    if (!id) return;
    dialog.warning({
      title: t.modelsCustomDelete,
      content: t.modelsCustomDeleteConfirm(id),
      positiveText: t.delete,
      negativeText: t.cancel,
      onPositiveClick: async () => {
        try {
          const doc = parseModelsConfigText(modelsText.current);
          const next = removeCustomProvider(doc, id);
          await window.api.models.set({
            modelsText: stringifyModelsConfig(next),
            clearAuth: [id],
          });
          setSelectedId(null);
          await load(null);
          notifyModelsChanged();
          message.success(t.modelsCustomDeleted);
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
        }
      },
    });
  }

  async function discover(): Promise<void> {
    const current = normalizedDraft();
    if (!current || discovering) return;
    if (!current.baseUrl.trim()) {
      message.warning(t.modelsCustomBaseUrlRequired);
      return;
    }
    setDiscovering(true);
    try {
      const result = await window.api.models.discover({
        baseUrl: current.baseUrl,
        apiKey: current.apiKey.trim() || undefined,
        api: current.api,
        // Lets the main process fall back to the auth.json key when this provider
        // was keyed through Settings → Providers rather than this form.
        providerId: current.id.trim() || undefined,
      });
      if (result.ok && result.models.length) {
        setPickRows(result.models);
        setPickOpen(true);
      } else if (result.ok) {
        message.warning(t.modelsCustomDiscoverEmpty);
      } else {
        message.error(`${t.modelsCustomDiscoverFail}: ${result.error}`, 8);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  }

  function applyPickedModels(picked: DiscoveredModel[]): void {
    const current = draft;
    if (!current || !picked.length) return;
    const models = mergeDiscoveredIntoDraft(current.models, picked);
    setDraft({ ...current, models });
    resetRowKeys(models.length);
    setPickOpen(false);
    message.success(t.modelsCustomDiscoverOk(picked.length));
  }

  /** 通知 Composer 刷新模型选择器（models.json 已变化）。 */
  function notifyModelsChanged(): void {
    window.dispatchEvent(new CustomEvent("pi-models-changed"));
  }

  async function testBaseUrl(): Promise<void> {
    const current = normalizedDraft();
    if (!current || testingBaseUrl) return;
    if (!current.baseUrl.trim()) {
      message.warning(t.modelsCustomTestNoBaseUrl);
      return;
    }
    setTestingBaseUrl(true);
    try {
      const result = await window.api.models.testBaseUrl({
        baseUrl: current.baseUrl,
        apiKey: current.apiKey.trim() || undefined,
        api: current.api,
        providerId: current.id.trim() || undefined,
      });
      if (!result.responded) {
        message.error(`${t.modelsCustomBaseUrlTestFail}: ${result.error}`, 8);
      } else if (result.status >= 200 && result.status < 300) {
        message.success(t.modelsCustomBaseUrlTestOk(result.latencyMs, result.status));
      } else {
        message.warning(t.modelsCustomBaseUrlTestWarn(result.latencyMs, result.status), 8);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingBaseUrl(false);
    }
  }

  async function testModel(rowKey: string, modelId: string): Promise<void> {
    const current = normalizedDraft();
    if (!current || testingRow) return;
    if (!current.baseUrl.trim()) {
      message.warning(t.modelsCustomTestNoBaseUrl);
      return;
    }
    const id = modelId.trim();
    if (!id) {
      message.warning(t.modelsCustomTestNoModel);
      return;
    }
    setTestingRow(rowKey);
    try {
      const result = await window.api.models.testConnection({
        baseUrl: current.baseUrl,
        apiKey: current.apiKey.trim() || undefined,
        api: current.api,
        modelId: id,
        providerId: current.id.trim() || undefined,
      });
      if (result.ok) message.success(t.modelsCustomTestOk(result.latencyMs));
      else message.error(`${t.modelsCustomTestFail}: ${result.error}`, 8);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingRow(null);
    }
  }

  function providerItemClass(id: string): string {
    const classes = [styles.providerItem];
    if (id === selectedId && !isNew) classes.push(styles.selected);
    if (isProviderDisabled(modelSelection, id)) classes.push(styles.disabled);
    return classes.join(" ");
  }

  return (
    <div className={styles.customizeModels}>
      <ProviderLogin
        show={oauthOpen}
        onClose={() => setOauthOpen(false)}
        onChanged={() => void load()}
      />

      {loading ? <Spin size="small" className={styles.contentSpin} /> : null}

      {!loading && loadError ? (
        <p className={styles.contentError}>
          {t.customizeLoadFailed}: {loadError}
        </p>
      ) : null}

      {!loading && !loadError ? (
        <div className={styles.modelsLayout}>
          <aside className={styles.modelsSidebar}>
            <div className={styles.listToolbar}>
              <Button size="small" onClick={onAddProvider}>
                {t.modelsAuthApiLogin}
              </Button>
              <Button size="small" onClick={() => setOauthOpen(true)}>
                {t.modelsAuthOauthLogin}
              </Button>
            </div>

            {!providers.length && !oauthSignedIn.length ? (
              <div className={styles.sidebarEmpty}>
                <span className={styles.sidebarEmptyTitle}>{t.modelsCustomEmpty}</span>
                <span className={styles.sidebarEmptyHint}>{t.modelsCustomEmptyHint}</span>
              </div>
            ) : (
              <div className={styles.providerList}>
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={providerItemClass(provider.id)}
                    onClick={() => onSelectProvider(provider.id)}
                  >
                    <span className={styles.providerHead}>
                      <span className={styles.providerName}>{provider.name || provider.id}</span>
                      {isProviderDisabled(modelSelection, provider.id) ? (
                        <span className={styles.providerBadge}>{t.modelsCustomDisabled}</span>
                      ) : null}
                    </span>
                    <span className={styles.providerSub}>
                      {providerHint(provider)}
                      {providerModelCount(provider)
                        ? ` · ${t.modelsCustomCount(providerModelCount(provider))}`
                        : ""}
                    </span>
                  </button>
                ))}

                {oauthSignedIn.length ? (
                  <>
                    <div className={styles.oauthGroupLabel}>{t.modelsAuthSignedInGroup}</div>
                    {oauthSignedIn.map((p) => (
                      <button
                        key={`oauth:${p.id}`}
                        type="button"
                        className={
                          p.id === selectedOAuthId
                            ? `${styles.providerItem} ${styles.selected}`
                            : styles.providerItem
                        }
                        onClick={() => onSelectOauth(p.id)}
                      >
                        <span className={styles.providerHead}>
                          <span className={styles.providerName}>{p.displayName}</span>
                          <span className={styles.providerBadge}>{t.modelsAuthOauthBadge}</span>
                        </span>
                        <span className={styles.providerSub}>
                          {t.modelsCustomCount(oauthModelCount(p.id))}
                        </span>
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </aside>

          <section className={styles.modelsDetail}>
            {selectedOauth ? (
              <>
                <header className={styles.detailHeader}>
                  <h3 className={styles.detailTitle}>{selectedOauth.displayName}</h3>
                  <span className={styles.inlineBadge}>{t.modelsAuthOauthBadge}</span>
                  <span className={styles.detailSpacer} />
                  <ToggleButton
                    label={t.modelsCustomDisable}
                    value={oauthProviderDisabled}
                    title={t.modelsCustomDisabledHint}
                    onValueChange={(value) => void setOauthProviderDisabled(value)}
                  />
                  <button
                    type="button"
                    className={styles.detailRemove}
                    title={t.providerAuthSignOut}
                    onClick={() => void signOutOauth(selectedOauth.id)}
                  >
                    {t.providerAuthSignOut}
                  </button>
                </header>

                <div className={styles.oauthDetail}>
                  <div className={styles.oauthQuota}>
                    <span className={styles.oauthQuotaLabel}>{t.modelsAuthQuota}</span>
                    {quotaLoading ? (
                      <span className={styles.oauthQuotaValue}>
                        {t.modelsAuthQuotaLoading}
                      </span>
                    ) : quota?.supported &&
                      (quota.windows?.length ||
                        quota.plan ||
                        quota.remaining !== undefined ||
                        quota.used !== undefined) ? (
                      <span className={styles.oauthQuotaValue}>
                        {quota.plan ? (
                          <span className={styles.oauthQuotaPlan}>{quota.plan}</span>
                        ) : null}
                        {balanceLine ? (
                          <span className={styles.oauthQuotaLine}>{balanceLine}</span>
                        ) : null}
                        {quotaLines.map((line, index) => (
                          <span key={`${index}:${line}`} className={styles.oauthQuotaLine}>
                            {line}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className={`${styles.oauthQuotaValue} ${styles.muted}`}>
                        {quota?.error ? quota.error : t.modelsAuthQuotaEmpty}
                      </span>
                    )}
                    <Button
                      size="small"
                      type="text"
                      loading={quotaLoading}
                      onClick={() => void loadQuota(true)}
                    >
                      {t.reload}
                    </Button>
                  </div>
                  {!oauthModels.length ? (
                    <div className={styles.oauthDetailEmpty}>{t.modelsCustomEmptyHint}</div>
                  ) : (
                    <ul className={styles.oauthModelList}>
                      {oauthModels.map((m) => (
                        <li key={m.id} className={styles.oauthModelItem}>
                          <div className={styles.oauthModelHead}>
                            <span className={styles.oauthModelName}>{m.name || m.id}</span>
                            <span className={styles.oauthModelId}>{m.id}</span>
                          </div>
                          <div className={styles.oauthModelMeta}>
                            <span className={styles.oauthModelChip}>
                              {t.modelsCustomContextWindow} {formatTokenCount(m.contextWindow)}
                            </span>
                            <span className={styles.oauthModelChip}>
                              {t.modelsCustomMaxTokens} {formatTokenCount(m.maxTokens)}
                            </span>
                            {modalLabel(m) ? (
                              <span className={styles.oauthModelChip}>{modalLabel(m)}</span>
                            ) : null}
                            {m.reasoning ? (
                              <span className={styles.oauthModelChip}>
                                {t.modelsCustomReasoning}
                              </span>
                            ) : null}
                            {costLabel(m) ? (
                              <span className={styles.oauthModelChip}>{costLabel(m)}</span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : !draft ? (
              <div className={styles.detailEmpty}>
                <span className={styles.detailEmptyTitle}>{t.modelsCustomSelectHint}</span>
              </div>
            ) : (
              <>
                <header className={styles.detailHeader}>
                  <h3 className={styles.detailTitle}>
                    {isNew ? t.modelsCustomNew : draft.name || draft.id}
                  </h3>
                  {dirty ? <span className={styles.inlineBadge}>{t.modelsCustomDirty}</span> : null}
                  <span className={styles.detailSpacer} />
                  <ToggleButton
                    label={t.modelsCustomDisable}
                    value={providerDisabled}
                    disabled={!draft.id.trim()}
                    title={t.modelsCustomDisabledHint}
                    onValueChange={(value) => void setProviderDisabled(value)}
                  />
                  {!isNew ? (
                    <button
                      type="button"
                      className={styles.detailRemove}
                      title={t.modelsCustomDelete}
                      onClick={confirmDelete}
                    >
                      {t.customizeDelete}
                    </button>
                  ) : null}
                </header>

                <div className={styles.detailScroll}>
                  {formError ? <p className={styles.formError}>{formError}</p> : null}

                  <div className={styles.formSection}>
                    <div className={styles.formSectionTitle}>{t.modelsCustomSectionBasic}</div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel} title={t.modelsCustomIdHint}>
                        {t.modelsCustomId}
                      </label>
                      <div className={styles.fieldControl}>
                        <Input
                          value={draft.id}
                          size="small"
                          placeholder={t.modelsCustomId}
                          onChange={(event) => updateDraft({ id: event.target.value })}
                        />
                      </div>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>{t.modelsCustomName}</label>
                      <div className={styles.fieldControl}>
                        <Input
                          value={draft.name}
                          size="small"
                          placeholder={t.modelsCustomNamePlaceholder}
                          onChange={(event) => updateDraft({ name: event.target.value })}
                        />
                      </div>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>{t.modelsCustomBaseUrl}</label>
                      <div className={styles.fieldControl}>
                        <Input
                          value={draft.baseUrl}
                          size="small"
                          placeholder={t.modelsCustomBaseUrlHint}
                          onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                        />
                      </div>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>{t.modelsCustomApi}</label>
                      <div className={styles.fieldControl}>
                        <Select
                          value={draft.api}
                          size="small"
                          options={apiOptions}
                          onChange={(value: CustomProviderDraft["api"]) =>
                            updateDraft({ api: value })
                          }
                        />
                      </div>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>{t.modelsCustomApiKey}</label>
                      <div className={styles.fieldControl}>
                        <Input
                          value={keyVisible ? draft.apiKey : keyMasked}
                          size="small"
                          placeholder={t.modelsCustomApiKeyPlaceholder}
                          onFocus={() => setKeyVisible(true)}
                          onChange={(event) => onApiKeyInput(event.target.value)}
                          suffix={
                            <button
                              type="button"
                              className={styles.keyEye}
                              title={keyVisible ? t.modelsCustomKeyHide : t.modelsCustomKeyShow}
                              onClick={() => setKeyVisible((value) => !value)}
                            >
                              {keyVisible ? <EyeOffOutline size={14} /> : <EyeOutline size={14} />}
                            </button>
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className={styles.formSection}>
                    <div className={styles.formSectionTitle}>{t.modelsCustomSectionCompat}</div>

                    <div className={styles.toggleRow}>
                      <ToggleButton
                        label={t.modelsCustomDevRole}
                        value={draft.supportsDeveloperRole}
                        onValueChange={(value) => setCompat("supportsDeveloperRole", value)}
                      />
                      <span className={styles.toggleHint}>{t.modelsCustomDevRoleHint}</span>
                    </div>

                    <div className={styles.toggleRow}>
                      <ToggleButton
                        label={t.modelsCustomReasoningEffort}
                        value={draft.supportsReasoningEffort}
                        onValueChange={(value) => setCompat("supportsReasoningEffort", value)}
                      />
                      <span className={styles.toggleHint}>{t.modelsCustomReasoningEffortHint}</span>
                    </div>
                  </div>

                  <div className={styles.formSection}>
                    <div className={styles.formSectionTitleRow}>
                      <span className={styles.formSectionTitle}>{t.modelsCustomSectionModels}</span>
                      <span className={styles.detailSpacer} />
                      <Button size="small" type="default" onClick={addModelRow}>
                        {t.modelsCustomAddModel}
                      </Button>
                    </div>

                    <div className={styles.modelList}>
                      {draft.models.map((model, index) => {
                        const rowKey = modelRowKeys[index] ?? String(index);
                        return (
                          <div key={rowKey} className={styles.modelRow}>
                            <div className={styles.modelRowMain}>
                              <Input
                                value={model.id}
                                size="small"
                                placeholder={t.modelsCustomModelId}
                                onChange={(event) =>
                                  updateModel(index, { id: event.target.value })
                                }
                              />
                              <Input
                                value={model.name}
                                size="small"
                                placeholder={t.modelsCustomModelName}
                                onChange={(event) =>
                                  updateModel(index, { name: event.target.value })
                                }
                              />
                              <button
                                type="button"
                                className={
                                  testingRow === rowKey
                                    ? `${styles.modelAction} ${styles.testing}`
                                    : styles.modelAction
                                }
                                disabled={testingRow !== null}
                                title={
                                  testingRow === rowKey ? t.modelsCustomTesting : t.modelsCustomTest
                                }
                                onClick={() => void testModel(rowKey, model.id)}
                              >
                                <CodiconIcon name="run" size={14} />
                              </button>
                              <button
                                type="button"
                                className={`${styles.modelAction} ${styles.modelRemove}`}
                                title={t.customizeDelete}
                                onClick={() => removeModelRow(index)}
                              >
                                <CodiconIcon name="remove" size={14} />
                              </button>
                            </div>

                            <div className={styles.modelRowMeta}>
                              <InputNumber
                                size="small"
                                className={styles.modelNumber}
                                title={t.modelsCustomContextWindow}
                                value={model.contextWindow ?? null}
                                min={1}
                                controls={false}
                                placeholder={t.modelsCustomContextWindow}
                                onChange={(value: number | null) =>
                                  setModelNumber(index, "contextWindow", value)
                                }
                              />
                              <InputNumber
                                size="small"
                                className={styles.modelNumber}
                                title={t.modelsCustomMaxTokens}
                                value={model.maxTokens ?? null}
                                min={1}
                                controls={false}
                                placeholder={t.modelsCustomMaxTokens}
                                onChange={(value: number | null) =>
                                  setModelNumber(index, "maxTokens", value)
                                }
                              />
                              <ToggleButton
                                label={t.modelsCustomReasoning}
                                value={model.reasoning === true}
                                onValueChange={(value) => updateModel(index, { reasoning: value })}
                              />
                              <ToggleButton
                                label={t.modelsCustomVision}
                                value={model.vision === true}
                                onValueChange={(value) => updateModel(index, { vision: value })}
                              />
                            </div>

                            <button
                              type="button"
                              className={styles.samplingToggle}
                              onClick={() => toggleSampling(index)}
                            >
                              <CodiconIcon
                                name={
                                  samplingOpen[samplingRowKey(index)]
                                    ? "chevronDown"
                                    : "chevronRight"
                                }
                                size={14}
                              />
                              <span>{t.modelsCustomSampling}</span>
                            </button>
                            {samplingOpen[samplingRowKey(index)] ? (
                              <div className={styles.samplingFields}>
                                <div className={styles.samplingField}>
                                  <span className={styles.samplingLabel}>
                                    {t.modelsCustomSamplingParams}
                                  </span>
                                  <Input.TextArea
                                    value={model.samplingParamsJson ?? ""}
                                    size="small"
                                    rows={3}
                                    placeholder={t.modelsCustomSamplingParamsHint}
                                    onChange={(event) =>
                                      updateModel(index, {
                                        samplingParamsJson: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className={styles.samplingField}>
                                  <span className={styles.samplingLabel}>
                                    {t.modelsCustomSamplingParamsLevels}
                                  </span>
                                  <Input.TextArea
                                    value={model.samplingParamsByThinkingLevelJson ?? ""}
                                    size="small"
                                    rows={4}
                                    placeholder={t.modelsCustomSamplingParamsLevelsHint}
                                    onChange={(event) =>
                                      updateModel(index, {
                                        samplingParamsByThinkingLevelJson: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <footer className={styles.detailFooter}>
                  <Button size="small" loading={discovering} onClick={() => void discover()}>
                    {discovering ? t.modelsCustomDiscovering : t.modelsCustomDiscover}
                  </Button>
                  <Button
                    size="small"
                    loading={testingBaseUrl}
                    onClick={() => void testBaseUrl()}
                  >
                    {testingBaseUrl ? t.modelsCustomBaseUrlTesting : t.modelsCustomBaseUrlTest}
                  </Button>
                  <span className={styles.detailSpacer} />
                  <Button size="small" disabled={!dirty} onClick={resetDraft}>
                    {t.modelsCustomReset}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={saving}
                    disabled={!dirty}
                    onClick={() => void save()}
                  >
                    {t.modelsCustomSave}
                  </Button>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : null}

      <ModelPickModal
        show={pickOpen}
        models={pickRows}
        existingIds={existingModelIds}
        onClose={() => setPickOpen(false)}
        onConfirm={applyPickedModels}
      />
    </div>
  );
}

export default CustomizeModels;
