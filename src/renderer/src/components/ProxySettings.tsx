import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Input, Select } from "antd";
import { useMessage } from "@renderer/services/feedback";
import { normalizeProxyUrl, type ProxyMode } from "../../../shared/proxy";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
  SettingsGroup,
  SettingsRow,
} from "@renderer/components/customize/SettingsGroup";
import styles from "./ProxySettings.module.css";

export function ProxySettings(): ReactNode {
  const message = useMessage();
  const t = useI18n();

  const [mode, setModeState] = useState<ProxyMode>("off");
  const [url, setUrlState] = useState("");
  const [loaded, setLoaded] = useState(false);
  const modeRef = useRef<ProxyMode>("off");
  const urlRef = useRef("");
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const applyChainRef = useRef<Promise<void>>(Promise.resolve());

  const setMode = useCallback((next: ProxyMode): void => {
    modeRef.current = next;
    setModeState(next);
  }, []);

  const setUrl = useCallback((next: string): void => {
    urlRef.current = next;
    setUrlState(next);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(urlTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await window.api.proxy.get();
        if (!active) return;
        setMode(current.mode);
        setUrl(current.url);
      } catch {
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [setMode, setUrl]);

  const apply = useCallback(
    (showSuccess = false): void => {
      applyChainRef.current = applyChainRef.current.then(async () => {
        try {
          const applied = await window.api.proxy.set({
            mode: modeRef.current,
            url: urlRef.current.trim(),
          });
          setMode(applied.mode);
          setUrl(applied.url);
          if (showSuccess) message.success(t.proxyApplied);
        } catch {
          message.error(t.proxyInvalidUrl);
        }
      });
    },
    [message, setMode, setUrl, t],
  );

  const onMode = useCallback(
    (next: ProxyMode): void => {
      if (!loaded || next === modeRef.current) return;
      setMode(next);
      if (next === "custom" && !normalizeProxyUrl(urlRef.current)) return;
      apply(true);
    },
    [apply, loaded, setMode],
  );

  const onUrl = useCallback(
    (next: string): void => {
      setUrl(next);
      if (!loaded || modeRef.current !== "custom") return;
      clearTimeout(urlTimerRef.current);
      urlTimerRef.current = setTimeout(() => {
        if (normalizeProxyUrl(urlRef.current)) apply();
      }, 600);
    },
    [apply, loaded, setUrl],
  );

  const urlInvalid =
    mode === "custom" &&
    url.trim().length > 0 &&
    normalizeProxyUrl(url) === null;

  const modeOptions = [
    { label: t.proxyModeOff, value: "off" },
    { label: t.proxyModeSystem, value: "system" },
    { label: t.proxyModeCustom, value: "custom" },
  ];

  return (
    <SettingsGroup>
      <SettingsRow label={t.proxyTitle}>
        {loaded ? (
          <Select
            className={styles.modeSelect}
            size="small"
            value={mode}
            options={modeOptions}
            onChange={(value) => onMode(value as ProxyMode)}
          />
        ) : (
          <div className={styles.modePlaceholder} />
        )}
      </SettingsRow>

      {mode === "custom" ? (
        <SettingsRow label={t.proxyUrlLabel}>
          <Input
            className={styles.urlInput}
            value={url}
            size="small"
            status={urlInvalid ? "error" : undefined}
            placeholder={t.proxyUrlPlaceholder}
            onChange={(event) => onUrl(event.target.value)}
          />
        </SettingsRow>
      ) : null}
    </SettingsGroup>
  );
}

export default ProxySettings;
