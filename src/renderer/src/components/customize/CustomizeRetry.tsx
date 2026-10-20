import { useEffect, type ReactNode } from "react";
import { Divider, Radio, Select, Typography } from "antd";
import {
  RETRY_AGENT_MAX_DELAY_CHOICES,
  RETRY_BASE_DELAY_CHOICES,
  RETRY_COUNT_CHOICES,
  RETRY_DESKTOP_COUNT_CHOICES,
  RETRY_MAX_DELAY_CHOICES,
  RETRY_SOFT_HANG_SILENCE_CHOICES,
  RETRY_STALL_SILENCE_CHOICES,
  RETRY_TIMEOUT_CHOICES,
  type RetrySettings,
} from "../../../../shared/retry-settings";
import { useRetryStore } from "@renderer/stores/retry";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CustomizeRetry.module.css";

/** 请求超时下拉的「默认」档位（跟跟随 httpIdleTimeoutMs）。 */
const TIMEOUT_DEFAULT = -1;

const ON = "on";
const OFF = "off";

type Option = { label: string; value: number };

function countOptions(values: readonly number[]): Option[] {
  return values.map((value) => ({ label: String(value), value }));
}

function durationOptions(
  values: readonly number[],
  label: (ms: number) => string,
): Option[] {
  return values.map((value) => ({ label: label(value), value }));
}

/** 手写的非档位值也要能回显：并入选项，避免下拉把用户值显示成别的档位。 */
function withCurrent(options: Option[], current: number): Option[] {
  if (options.some((option) => option.value === current)) return options;
  return [...options, { label: current.toLocaleString(), value: current }].sort(
    (a, b) => a.value - b.value,
  );
}

export function CustomizeRetry(): ReactNode {
  const retry = useRetryStore();
  const t = useI18n();

  useEffect(() => {
    void retry.load();
  }, []);

  const settings = retry.settings;

  const maxRetryOptions = countOptions(RETRY_COUNT_CHOICES);
  const baseDelayOptions = durationOptions(RETRY_BASE_DELAY_CHOICES, t.retryDuration);
  const maxDelayOptions = durationOptions(RETRY_MAX_DELAY_CHOICES, (ms) =>
    ms === 0 ? t.retryValueUnlimited : t.retryDuration(ms),
  );
  const agentMaxDelayOptions = withCurrent(
    durationOptions(RETRY_AGENT_MAX_DELAY_CHOICES, t.retryDuration),
    settings.maxAgentDelayMs,
  );
  const timeoutOptions: Option[] = RETRY_TIMEOUT_CHOICES.map((ms) => ({
    label: ms === null ? t.retryValueDefault : t.retryDuration(ms),
    value: ms === null ? TIMEOUT_DEFAULT : ms,
  }));
  const timeoutValue = settings.provider.timeoutMs ?? TIMEOUT_DEFAULT;
  const desktopCountOptions = countOptions(RETRY_DESKTOP_COUNT_CHOICES);
  const softHangSilenceOptions = durationOptions(RETRY_SOFT_HANG_SILENCE_CHOICES, t.retryDuration);
  const stallSilenceOptions = durationOptions(RETRY_STALL_SILENCE_CHOICES, t.retryDuration);

  function save(patch: Partial<RetrySettings>): void {
    void retry.save({ ...settings, ...patch });
  }

  function saveProvider(patch: Partial<RetrySettings["provider"]>): void {
    save({ provider: { ...settings.provider, ...patch } });
  }

  function saveDesktop(patch: Partial<RetrySettings["desktop"]>): void {
    save({ desktop: { ...settings.desktop, ...patch } });
  }

  function onNumber(apply: (value: number) => void) {
    return (value: string | number | null): void => {
      if (typeof value === "number") apply(value);
    };
  }

  function onTimeout(value: string | number | null): void {
    if (value === TIMEOUT_DEFAULT) return saveProvider({ timeoutMs: null });
    if (typeof value === "number") saveProvider({ timeoutMs: value });
  }

  const onMaxRetries = onNumber((value) => save({ maxRetries: value }));
  const onBaseDelay = onNumber((value) => save({ baseDelayMs: value }));
  const onAgentMaxDelay = onNumber((value) => save({ maxAgentDelayMs: value }));
  const onProviderMaxRetries = onNumber((value) => saveProvider({ maxRetries: value }));
  const onProviderMaxDelay = onNumber((value) => saveProvider({ maxRetryDelayMs: value }));
  const onRecoverMax = onNumber((value) => saveDesktop({ recoverMax: value }));
  const onSoftHangMax = onNumber((value) => saveDesktop({ softHangMax: value }));
  const onSoftHangSilence = onNumber((value) => saveDesktop({ softHangSilenceMs: value }));
  const onStallSilence = onNumber((value) => saveDesktop({ stallSilenceMs: value }));

  return (
    <div className={styles.root}>
      <div className={styles.sectionHead}>
        <Typography.Text strong>{t.retryAutoSection}</Typography.Text>
        <Typography.Text type="secondary" className={styles.sectionHint}>
          {t.retryAutoSectionHint}
        </Typography.Text>
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryEnabled}</Typography.Text>
        </div>
        <Radio.Group
          className={styles.radioGroup}
          size="small"
          value={settings.enabled ? ON : OFF}
          onChange={(event) => save({ enabled: event.target.value === ON })}
        >
          <Radio.Button value={ON}>{t.switchOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.switchOff}</Radio.Button>
        </Radio.Group>
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryMaxRetries}</Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.maxRetries}
          options={maxRetryOptions}
          disabled={!settings.enabled}
          size="small"
          onChange={onMaxRetries}
        />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryBaseDelay}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.retryBaseDelayHint}
          </Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.baseDelayMs}
          options={baseDelayOptions}
          disabled={!settings.enabled}
          size="small"
          onChange={onBaseDelay}
        />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryAgentMaxDelay}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.retryAgentMaxDelayHint}
          </Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.maxAgentDelayMs}
          options={agentMaxDelayOptions}
          disabled={!settings.enabled}
          size="small"
          onChange={onAgentMaxDelay}
        />
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.sectionHead}>
        <Typography.Text strong>{t.retryProviderSection}</Typography.Text>
        <Typography.Text type="secondary" className={styles.sectionHint}>
          {t.retryProviderSectionHint}
        </Typography.Text>
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryProviderMaxRetries}</Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.provider.maxRetries}
          options={maxRetryOptions}
          size="small"
          onChange={onProviderMaxRetries}
        />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryProviderMaxDelay}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.retryProviderMaxDelayHint}
          </Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.provider.maxRetryDelayMs}
          options={maxDelayOptions}
          size="small"
          onChange={onProviderMaxDelay}
        />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryProviderTimeout}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.retryProviderTimeoutHint}
          </Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={timeoutValue}
          options={timeoutOptions}
          size="small"
          onChange={onTimeout}
        />
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.sectionHead}>
        <Typography.Text strong>{t.retryDesktopSection}</Typography.Text>
        <Typography.Text type="secondary" className={styles.sectionHint}>
          {t.retryDesktopSectionHint}
        </Typography.Text>
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryDesktopRecoverMax}</Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.desktop.recoverMax}
          options={desktopCountOptions}
          size="small"
          onChange={onRecoverMax}
        />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryDesktopSoftHangMax}</Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.desktop.softHangMax}
          options={desktopCountOptions}
          size="small"
          onChange={onSoftHangMax}
        />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryDesktopSoftHangSilence}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.retryDesktopSoftHangSilenceHint}
          </Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.desktop.softHangSilenceMs}
          options={softHangSilenceOptions}
          size="small"
          onChange={onSoftHangSilence}
        />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.retryDesktopStallSilence}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.retryDesktopStallSilenceHint}
          </Typography.Text>
        </div>
        <Select
          className={styles.settingSelect}
          value={settings.desktop.stallSilenceMs}
          options={stallSilenceOptions}
          size="small"
          onChange={onStallSilence}
        />
      </div>
    </div>
  );
}

export default CustomizeRetry;
