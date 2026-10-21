import { useEffect, useState, type ReactNode } from "react";
import { Divider, Radio, Select, Typography } from "antd";
import {
  TRUNCATE_TOOL_OUTPUT_CHOICES,
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import { useStreamRenderStore } from "@renderer/stores/stream-render";
import { STREAM_RENDER_THROTTLE_CHOICES } from "../../../shared/stream-render";
import { MESSAGE_WIDTH_CHOICES } from "../../../shared/appearance";
import AppearanceWallpaperCard from "@renderer/components/customize/AppearanceWallpaperCard";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./AppearancePanel.module.css";

const ON = "on";
const OFF = "off";

type Option = { label: string; value: number };

export function AppearancePanel(): ReactNode {
  const t = useI18n();
  const appearance = useAppearanceStore();
  const streamRender = useStreamRenderStore();
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => {
    void streamRender.load();
  }, []);

  useEffect(() => {
    void window.api.window.platform().then((p) => {
      setIsWindows(p === "win32");
    });
  }, []);

  /** 切换语言：原地替换界面文案，不刷页、不显示加载页。 */
  function onLocaleUpdate(value: string | number | null): void {
    if (value !== "system" && value !== "zh-CN" && value !== "en") return;
    if (value === appearance.localePreference) return;
    appearance.setLocalePreference(value as LocalePreference);
  }

  function onTruncateChange(value: string | number | null): void {
    if (typeof value === "number") appearance.setTruncateToolOutputLines(value);
  }

  function onStreamRenderThrottleChange(value: string | number | null): void {
    if (typeof value === "number") void streamRender.update({ throttleMs: value });
  }

  function onMessageWidthChange(value: string | number | null): void {
    if (typeof value === "number") appearance.setMessageWidth(value);
  }

  const truncateOptions: Option[] = TRUNCATE_TOOL_OUTPUT_CHOICES.map((lines) => ({
    label: lines === 0 ? t.truncateToolOutputOff : t.truncateToolOutputLines(lines),
    value: lines,
  }));

  const messageWidthOptions: Option[] = MESSAGE_WIDTH_CHOICES.map((value) => ({
    label: t.appearanceMessageWidthValue(Math.round(value * 100)),
    value,
  }));

  const streamRenderThrottleOptions: Option[] = STREAM_RENDER_THROTTLE_CHOICES.map((ms) => ({
    label: t.streamRenderThrottleValue(ms),
    value: ms,
  }));

  return (
    <div className={styles.appearancePanel}>
      <AppearanceWallpaperCard />

      <Divider style={{ margin: 0 }} />

      <div className={styles.themeLocaleGrid}>
        <Typography.Text strong>{t.theme}</Typography.Text>
        <Radio.Group
          value={appearance.themePreference}
          size="small"
          className={styles.themeLocaleRadio}
          style={{ display: "flex" }}
          onChange={(event) =>
            appearance.setThemePreference(event.target.value as ThemePreference)
          }
        >
          <Radio.Button value="system">{t.themeSystem}</Radio.Button>
          <Radio.Button value="light">{t.themeLight}</Radio.Button>
          <Radio.Button value="dark">{t.themeDark}</Radio.Button>
        </Radio.Group>

        <Divider style={{ margin: 0 }} className={styles.themeLocaleDivider} />

        <Typography.Text strong>{t.language}</Typography.Text>
        <Radio.Group
          value={appearance.localePreference}
          size="small"
          className={styles.themeLocaleRadio}
          style={{ display: "flex" }}
          onChange={(event) => onLocaleUpdate(event.target.value)}
        >
          <Radio.Button value="system">{t.themeSystem}</Radio.Button>
          <Radio.Button value="zh-CN">中文</Radio.Button>
          <Radio.Button value="en">English</Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.sectionTitle}>{t.appearanceInterface}</div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.showPanelDividers}</Typography.Text>
        </div>
        <Radio.Group
          value={appearance.showPanelDividers ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => appearance.setShowPanelDividers(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.showCompactButtonOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.showCompactButtonOff}</Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.showSessionTitle}</Typography.Text>
        </div>
        <Radio.Group
          value={appearance.showSessionTitle ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => appearance.setShowSessionTitle(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.showCompactButtonOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.showCompactButtonOff}</Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.showCompactButton}</Typography.Text>
        </div>
        <Radio.Group
          value={appearance.showCompactButton ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => appearance.setShowCompactButton(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.showCompactButtonOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.showCompactButtonOff}</Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.truncateToolOutput}</Typography.Text>
        </div>
        <Select
          value={appearance.truncateToolOutputLines}
          options={truncateOptions}
          size="small"
          className={styles.settingSelect}
          onChange={onTruncateChange}
        />
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.streamRender}</Typography.Text>
        </div>
        <Radio.Group
          value={streamRender.enabled ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => void streamRender.update({ enabled: event.target.value === ON })}
        >
          <Radio.Button value={ON}>{t.switchOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.switchOff}</Radio.Button>
        </Radio.Group>
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.streamRenderThrottle}</Typography.Text>
        </div>
        <Select
          value={streamRender.throttleMs}
          options={streamRenderThrottleOptions}
          size="small"
          className={styles.settingSelect}
          disabled={!streamRender.enabled}
          onChange={onStreamRenderThrottleChange}
        />
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.appearanceMessageWidth}</Typography.Text>
        </div>
        <Select
          value={appearance.messageWidth}
          options={messageWidthOptions}
          size="small"
          className={styles.settingSelect}
          onChange={onMessageWidthChange}
        />
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.showSessionDetails}</Typography.Text>
        </div>
        <Radio.Group
          value={appearance.showSessionDetails ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => appearance.setShowSessionDetails(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.showCompactButtonOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.showCompactButtonOff}</Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.messagePreview}</Typography.Text>
        </div>
        <Radio.Group
          value={appearance.showMessagePreview ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => appearance.setShowMessagePreview(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.showCompactButtonOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.showCompactButtonOff}</Radio.Button>
        </Radio.Group>
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.messagePreviewImage}</Typography.Text>
        </div>
        <Radio.Group
          value={appearance.showMessagePreviewImage ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          disabled={!appearance.showMessagePreview}
          onChange={(event) => appearance.setShowMessagePreviewImage(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.showCompactButtonOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.showCompactButtonOff}</Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.sessionHoverActions}</Typography.Text>
        </div>
        <Radio.Group
          value={appearance.showSessionHoverActions ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => appearance.setSessionHoverActions(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.switchOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.switchOff}</Radio.Button>
        </Radio.Group>
      </div>

      {isWindows ? (
        <>
          <Divider style={{ margin: 0 }} />

          <div className={styles.switchRow}>
            <div className={styles.switchLabels}>
              <Typography.Text strong>{t.showPrivilegeLevel}</Typography.Text>
            </div>
            <Radio.Group
              value={appearance.showPrivilegeLevel ? ON : OFF}
              size="small"
              className={styles.settingRadioGroup}
              style={{ display: "inline-flex" }}
              onChange={(event) => appearance.setShowPrivilegeLevel(event.target.value === ON)}
            >
              <Radio.Button value={ON}>{t.switchOn}</Radio.Button>
              <Radio.Button value={OFF}>{t.switchOff}</Radio.Button>
            </Radio.Group>
          </div>
        </>
      ) : null}

      <Divider style={{ margin: 0 }} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.expandToolCalls}</Typography.Text>
          <Typography.Text type="secondary" className={styles.switchHint}>
            {t.expandToolCallsHint}
          </Typography.Text>
        </div>
        <Radio.Group
          value={appearance.expandToolCalls ? ON : OFF}
          size="small"
          className={styles.settingRadioGroup}
          style={{ display: "inline-flex" }}
          onChange={(event) => appearance.setExpandToolCalls(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.switchOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.switchOff}</Radio.Button>
        </Radio.Group>
      </div>
    </div>
  );
}

export default AppearancePanel;
