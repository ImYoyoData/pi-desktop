import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Input, Radio, Typography } from "antd";
import { useMessage } from "@renderer/services/feedback";
import { normalizeProxyUrl, type ProxyMode } from "../../../shared/proxy";
import { useI18n } from "@renderer/i18n/use-i18n";
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

  return (
    <section className={styles.root}>
      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.proxyTitle}</Typography.Text>
        </div>
        {loaded ? (
          <Radio.Group
            className={styles.radioGroup}
            size="small"
            value={mode}
            onChange={(event) => onMode(event.target.value as ProxyMode)}
          >
            <Radio.Button value="off">{t.proxyModeOff}</Radio.Button>
            <Radio.Button value="system">{t.proxyModeSystem}</Radio.Button>
            <Radio.Button value="custom">{t.proxyModeCustom}</Radio.Button>
          </Radio.Group>
        ) : (
          <div className={styles.radioPlaceholder} />
        )}
      </div>

      {mode === "custom" ? (
        <div className={styles.switchRow}>
          <div className={styles.switchLabels}>
            <Typography.Text strong>{t.proxyUrlLabel}</Typography.Text>
          </div>
          <Input
            className={styles.urlInput}
            value={url}
            size="small"
            status={urlInvalid ? "error" : undefined}
            placeholder={t.proxyUrlPlaceholder}
            onChange={(event) => onUrl(event.target.value)}
          />
        </div>
      ) : null}
    </section>
  );
}

export default ProxySettings;
