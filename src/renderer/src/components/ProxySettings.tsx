import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Input, Select } from "antd";
import { useMessage } from "@renderer/services/feedback";
import {
  DEFAULT_PROXY_SETTINGS,
  normalizeProxyUrl,
  type ProxyKind,
  type ProxyMode,
  type ProxyScope,
} from "../../../shared/proxy";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
  SettingsGroup,
  SettingsRow,
} from "@renderer/components/customize/SettingsGroup";
import styles from "./ProxySettings.module.css";

type Settings = Record<ProxyKind, ProxyScope>;

export function ProxySettings(): ReactNode {
  const message = useMessage();
  const t = useI18n();

  const [settings, setSettingsState] = useState<Settings>(DEFAULT_PROXY_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef<Settings>(DEFAULT_PROXY_SETTINGS);
  const timersRef = useRef<
    Partial<Record<ProxyKind, ReturnType<typeof setTimeout>>>
  >({});
  const applyChainRef = useRef<Promise<void>>(Promise.resolve());

  const setSettings = useCallback((next: Settings): void => {
    settingsRef.current = next;
    setSettingsState(next);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(timersRef.current)) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await window.api.proxy.get();
        if (!active) return;
        setSettings(current);
      } catch {
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [setSettings]);

  const apply = useCallback(
    (showSuccess = false): void => {
      applyChainRef.current = applyChainRef.current.then(async () => {
        try {
          const applied = await window.api.proxy.set(settingsRef.current);
          setSettings(applied);
          if (showSuccess) message.success(t.proxyApplied);
        } catch {
          message.error(t.proxyInvalidUrl);
        }
      });
    },
    [message, setSettings, t],
  );

  const patchScope = useCallback(
    (kind: ProxyKind, patch: { mode?: ProxyMode; url?: string }) => {
      const current = settingsRef.current;
      return { ...current, [kind]: { ...current[kind], ...patch } };
    },
    [],
  );

  const onMode = useCallback(
    (kind: ProxyKind, next: ProxyMode): void => {
      if (!loaded || next === settingsRef.current[kind].mode) return;
      const nextSettings = patchScope(kind, { mode: next });
      setSettings(nextSettings);
      if (next === "custom" && !normalizeProxyUrl(nextSettings[kind].url)) {
        return;
      }
      apply(true);
    },
    [apply, loaded, patchScope, setSettings],
  );

  const onUrl = useCallback(
    (kind: ProxyKind, url: string): void => {
      const nextSettings = patchScope(kind, { url });
      setSettings(nextSettings);
      if (!loaded || nextSettings[kind].mode !== "custom") return;
      clearTimeout(timersRef.current[kind]);
      timersRef.current[kind] = setTimeout(() => {
        if (normalizeProxyUrl(settingsRef.current[kind].url)) apply();
      }, 600);
    },
    [apply, loaded, patchScope, setSettings],
  );

  const scopes: { kind: ProxyKind; label: string; hint: string }[] = [
    { kind: "desktop", label: t.proxyDesktopLabel, hint: t.proxyDesktopHint },
    { kind: "agent", label: t.proxyAgentLabel, hint: t.proxyAgentHint },
  ];

  const modeOptions = [
    { label: t.proxyModeOff, value: "off" },
    { label: t.proxyModeSystem, value: "system" },
    { label: t.proxyModeCustom, value: "custom" },
  ];

  return (
    <SettingsGroup>
      {scopes.map(({ kind, label, hint }) => {
        const scope = settings[kind];
        const urlInvalid =
          scope.mode === "custom" &&
          scope.url.trim().length > 0 &&
          normalizeProxyUrl(scope.url) === null;
        return (
          <Fragment key={kind}>
            <SettingsRow label={label} description={hint}>
              {loaded ? (
                <Select
                  className={styles.modeSelect}
                  size="small"
                  value={scope.mode}
                  options={modeOptions}
                  onChange={(value) => onMode(kind, value as ProxyMode)}
                />
              ) : (
                <div className={styles.modePlaceholder} />
              )}
            </SettingsRow>

            {scope.mode === "custom" ? (
              <SettingsRow label={t.proxyUrlLabel}>
                <Input
                  className={styles.urlInput}
                  value={scope.url}
                  size="small"
                  status={urlInvalid ? "error" : undefined}
                  placeholder={t.proxyUrlPlaceholder}
                  onChange={(event) => onUrl(kind, event.target.value)}
                />
              </SettingsRow>
            ) : null}
          </Fragment>
        );
      })}
    </SettingsGroup>
  );
}

export default ProxySettings;
