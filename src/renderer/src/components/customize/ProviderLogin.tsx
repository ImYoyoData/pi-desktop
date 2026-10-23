import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, Modal, Select } from "antd";
import type {
  ModelsOAuthEventPayload,
  ModelsProviderAuth,
} from "../../../../shared/models-settings";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ProviderLogin.module.css";

type Props = {
  show: boolean;
  onChanged?: () => void;
  onClose?: () => void;
};

type PromptEvent = Extract<ModelsOAuthEventPayload["event"], { type: "prompt" }>;

type DeviceCode = { userCode: string; verificationUri: string };

export function ProviderLogin({ show, onChanged, onClose }: Props): ReactNode {
  const message = useMessage();
  const t = useI18n();

  const [providers, setProviders] = useState<ModelsProviderAuth[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [runningName, setRunningName] = useState("");
  const [runMessage, setRunMessage] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const runningRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  function setRunningState(next: string | null): void {
    runningRef.current = next;
    setRunning(next);
  }

  const oauthProviders = providers.filter((p) => p.oauth);
  const modalVisible = show || running !== null;

  const promptSelectOptions = (() => {
    const current = prompt;
    if (!current || current.prompt.type !== "select") return [];
    return current.prompt.options.map((option) => ({
      label: option.description ? `${option.label} — ${option.description}` : option.label,
      value: option.id,
    }));
  })();

  async function refresh(): Promise<void> {
    try {
      const data = await window.api.models.get();
      setProviders(data.providers);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function handleEvent(payload: ModelsOAuthEventPayload): void {
    if (payload.providerId !== runningRef.current) return;
    const event = payload.event;
    if (event.type === "info" || event.type === "progress") {
      setRunMessage(event.message);
    } else if (event.type === "auth_url") {
      setAuthUrl(event.url);
      void window.api.browser.openExternal(event.url);
    } else if (event.type === "device_code") {
      setDeviceCode({ userCode: event.userCode, verificationUri: event.verificationUri });
      void window.api.browser.openExternal(event.verificationUri);
    } else if (event.type === "prompt") {
      setPrompt(event);
      setPromptValue("");
    }
  }

  useEffect(() => {
    const unsubscribe = window.api.models.onOauthEvent((payload) => handleEvent(payload));
    void refresh();
    return () => unsubscribe();
  }, []);

  function resetRunState(): void {
    setRunMessage("");
    setAuthUrl("");
    setDeviceCode(null);
    setPrompt(null);
  }

  async function signIn(provider: ModelsProviderAuth): Promise<void> {
    if (runningRef.current) return;
    setRunningState(provider.id);
    setRunningName(provider.displayName);
    cancelledRef.current = false;
    resetRunState();
    try {
      await window.api.models.oauthLogin(provider.id);
      message.success(t.providerAuthSuccess);
      onChanged?.();
      // 模型选择器（Composer）监听该事件，登录成功后其分组立即出现新供应商。
      window.dispatchEvent(new Event("pi-models-changed"));
      await refresh();
    } catch (err) {
      if (!cancelledRef.current) {
        const text = err instanceof Error ? err.message : String(err);
        message.open({
          type: "error",
          content: `${t.providerAuthFailed}: ${text}`,
          duration: 8000,
        });
      }
    } finally {
      setRunningState(null);
      resetRunState();
    }
  }

  async function cancelSignIn(): Promise<void> {
    if (!runningRef.current) return;
    cancelledRef.current = true;
    await window.api.models.oauthCancel();
  }

  async function submitPrompt(): Promise<void> {
    const current = prompt;
    const providerId = runningRef.current;
    if (!current || !providerId) return;
    const value = promptValue.trim();
    if (!value) return;
    setPrompt(null);
    await window.api.models.oauthPrompt({
      providerId,
      promptId: current.promptId,
      value,
    });
  }

  async function skipPrompt(): Promise<void> {
    const current = prompt;
    const providerId = runningRef.current;
    if (!current || !providerId) return;
    setPrompt(null);
    await window.api.models.oauthPrompt({
      providerId,
      promptId: current.promptId,
      cancelled: true,
    });
  }

  async function signOut(provider: ModelsProviderAuth): Promise<void> {
    try {
      await window.api.models.oauthLogout(provider.id);
      message.success(t.providerAuthLoggedOut);
      onChanged?.();
      window.dispatchEvent(new Event("pi-models-changed"));
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyUserCode(): Promise<void> {
    if (!deviceCode) return;
    try {
      await navigator.clipboard.writeText(deviceCode.userCode);
      message.success(t.providerAuthCopied);
    } catch {
      message.error(t.providerAuthCopyFailed);
    }
  }

  return (
    <Modal
      open={modalVisible}
      className="pi-settings-modal"
      width="min(460px, 92vw)"
      mask={{ closable: false }}
      closable={!running}
      keyboard={!running}
      onCancel={() => {
        if (!running) onClose?.();
      }}
      title={
        <div className={styles.modalTitleBlock}>
          <div className={styles.modalTitle}>
            {running ? t.providerAuthRunningTitle(runningName) : t.providerAuthTitle}
          </div>
        </div>
      }
    >
      <div className={styles.content}>
        {running ? (
          <>
            {runMessage ? <p className={styles.text}>{runMessage}</p> : null}

            {authUrl ? <p className={styles.text}>{t.providerAuthBrowserHint}</p> : null}
            {authUrl ? (
              <p className={styles.link}>
                <a href={authUrl} target="_blank" rel="noreferrer">
                  {t.providerAuthOpenLink}
                </a>
              </p>
            ) : null}

            {deviceCode ? (
              <div className={styles.device}>
                <span className={styles.deviceLabel}>{t.providerAuthDeviceCode}</span>
                <code className={styles.deviceCode}>{deviceCode.userCode}</code>
                <Button size="small" onClick={() => void copyUserCode()}>
                  {t.providerAuthCopied}
                </Button>
              </div>
            ) : null}
            {deviceCode ? (
              <p className={`${styles.text} ${styles.muted}`}>{t.providerAuthDeviceHint}</p>
            ) : null}

            {prompt ? (
              <div className={styles.prompt}>
                <p className={styles.text}>{prompt.prompt.message}</p>
                {prompt.prompt.type === "select" ? (
                  <Select
                    value={promptValue}
                    size="small"
                    options={promptSelectOptions}
                    onChange={(value) => setPromptValue(value as string)}
                  />
                ) : prompt.prompt.type === "secret" ? (
                  <Input.Password
                    value={promptValue}
                    size="small"
                    placeholder={prompt.prompt.placeholder}
                    onChange={(event) => setPromptValue(event.target.value)}
                    onPressEnter={() => void submitPrompt()}
                  />
                ) : (
                  <Input
                    value={promptValue}
                    size="small"
                    placeholder={prompt.prompt.placeholder}
                    onChange={(event) => setPromptValue(event.target.value)}
                    onPressEnter={() => void submitPrompt()}
                  />
                )}
                <div className={styles.promptActions}>
                  <Button
                    size="small"
                    type="primary"
                    disabled={!promptValue.trim()}
                    onClick={() => void submitPrompt()}
                  >
                    {t.providerAuthPromptSubmit}
                  </Button>
                  <Button size="small" onClick={() => void skipPrompt()}>
                    {t.providerAuthPromptSkip}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className={styles.footer}>
              <Button size="small" type="default" onClick={() => void cancelSignIn()}>
                {t.providerAuthCancel}
              </Button>
            </div>
          </>
        ) : (
          <>
            {!oauthProviders.length ? (
              <p className={`${styles.text} ${styles.muted}`}>{t.providerAuthEmpty}</p>
            ) : (
              <ul className={styles.list}>
                {oauthProviders.map((provider) => (
                  <li key={provider.id} className={styles.row}>
                    <div className={styles.info}>
                      <span className={styles.name}>{provider.displayName}</span>
                      <span
                        className={
                          provider.configured
                            ? `${styles.status} ${styles.configured}`
                            : styles.status
                        }
                      >
                        {provider.configured
                          ? t.providerAuthSignedIn
                          : t.providerAuthNotSignedIn}
                      </span>
                    </div>
                    <div className={styles.actions}>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => void signIn(provider)}
                      >
                        {t.providerAuthSignIn}
                      </Button>
                      {provider.configured ? (
                        <Button size="small" onClick={() => void signOut(provider)}>
                          {t.providerAuthSignOut}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.footer}>
              <Button size="small" onClick={() => onClose?.()}>
                {t.providerAuthClose}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default ProviderLogin;
