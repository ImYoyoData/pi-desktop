import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Select, Typography } from "antd";
import type { WebSearchSettings as WebSearchConfig } from "../../../../shared/web-search-config";
import type { ModelsProviderAuth } from "../../../../shared/models-settings";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import * as prefs from "@renderer/utils/prefs";
import styles from "./WebSearchSettings.module.css";

export function WebSearchSettings(): ReactNode {
  const message = useMessage();
  const t = useI18n();

  const [settings, setSettings] = useState<WebSearchConfig>({ providerSource: "" });
  const [extensionInstalled, setExtensionInstalled] = useState(true);
  const [providers, setProviders] = useState<ModelsProviderAuth[]>([]);

  const piProviderOptions = useMemo(
    () =>
      providers.map((item) => ({
        label: item.displayName || item.id,
        value: item.id,
      })),
    [providers],
  );

  const selectedProvider = useMemo(
    () => providers.find((item) => item.id === settings.providerSource) ?? null,
    [providers, settings.providerSource],
  );

  const derivedEndpoint = useMemo(() => {
    const base = selectedProvider?.baseUrl?.trim().replace(/\/+$/, "");
    if (!base) return "";
    return base.endsWith("/responses") ? base : `${base}/responses`;
  }, [selectedProvider]);

  useEffect(() => {
    void (async () => {
      let current: WebSearchConfig = { providerSource: "" };
      try {
        const state = await window.api.webSearchConfig.get();
        current = state.settings;
        setSettings(state.settings);
        setExtensionInstalled(state.extensionInstalled);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
      try {
        const data = await window.api.models.get();
        const list = data.providers.filter(
          (item) => item.configured && item.baseUrl && item.responsesApi,
        );
        setProviders(list);
        if (!current.providerSource) {
          const preset = presetProvider(list);
          if (preset) await save({ providerSource: preset });
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  /** 默认预填当前会话正在用的模型所属 provider。 */
  function presetProvider(list: ModelsProviderAuth[]): string {
    const id = useSessionsStore.getState().activeId;
    const key = id ? sessionModelKey(id) : "";
    const provider = key?.split("/")[0] ?? "";
    return list.some((item) => item.id === provider) ? provider : "";
  }

  function sessionModelKey(sessionId: string): string {
    try {
      const raw = prefs.getItem("pi-desktop:session-model-prefs");
      if (!raw) return "";
      const models = (JSON.parse(raw) as { models?: Record<string, string> }).models;
      return typeof models?.[sessionId] === "string" ? models[sessionId] : "";
    } catch {
      return "";
    }
  }

  async function save(next: WebSearchConfig): Promise<void> {
    setSettings(next);
    try {
      const state = await window.api.webSearchConfig.set(next);
      setSettings(state.settings);
      setExtensionInstalled(state.extensionInstalled);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function setProviderSource(providerSource: string): void {
    void save({ providerSource });
  }

  return (
    <div className={styles.webSearchSettings}>
      <Typography.Text type="secondary" className={styles.rowHint}>
        {extensionInstalled ? t.webSearchExtensionNote : t.webSearchExtensionMissing}
      </Typography.Text>

      {!extensionInstalled ? (
        <Alert
          type="warning"
          className={styles.extensionAlert}
          title={t.webSearchExtensionMissing}
        />
      ) : null}

      {providers.length === 0 ? (
        <Typography.Text type="secondary" className={styles.rowHint}>
          {t.webSearchProviderSourceEmpty}
        </Typography.Text>
      ) : (
        <>
          <div className={styles.switchRow}>
            <div className={styles.switchLabels}>
              <Typography.Text strong>{t.webSearchProviderSourceProvider}</Typography.Text>
              <Typography.Text type="secondary" className={styles.rowHint}>
                {t.webSearchProviderSourceProviderHint}
              </Typography.Text>
            </div>
            <Select
              className={styles.settingSelect}
              size="small"
              disabled={!extensionInstalled}
              value={settings.providerSource || undefined}
              options={piProviderOptions}
              placeholder={t.webSearchProviderSourcePlaceholder}
              onChange={(value: string) => setProviderSource(value)}
            />
          </div>

          {derivedEndpoint && extensionInstalled ? (
            <div className={styles.endpointBox}>
              <Typography.Text type="secondary" className={styles.rowHint}>
                {t.webSearchProviderSourceEndpoint}
              </Typography.Text>
              <Typography.Text className={styles.endpointValue}>{derivedEndpoint}</Typography.Text>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default WebSearchSettings;
