import { useMemo, type ReactNode } from "react";
import { Tooltip } from "antd";
import AppearanceSliderRow from "@renderer/components/customize/AppearanceSliderRow";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { wallpaperMediaSrc } from "../../../../shared/appearance";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./AppearanceWallpaperCard.module.css";

export function AppearanceWallpaperCard(): ReactNode {
  const t = useI18n();
  const appearance = useAppearanceStore();

  const kind = appearance.wallpaper.kind;
  const isMedia = kind === "image" || kind === "video";
  const mediaSrc = useMemo(
    () => (appearance.wallpaper.path ? wallpaperMediaSrc(appearance.wallpaper.path) : ""),
    [appearance.wallpaper.path],
  );

  async function pickWallpaper(): Promise<void> {
    const path = await window.api.appearance.pickWallpaper();
    if (path) appearance.setWallpaperFile(path);
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{t.appearanceWallpaper}</span>
        <Tooltip title={t.appearanceWallpaperTip} mouseEnterDelay={0.15}>
          <span className={styles.cardTip}>?</span>
        </Tooltip>
      </div>

      <div className={styles.wallpaperBody}>
        <div className={styles.previewWrap}>
          <button
            type="button"
            className={kind === "none" ? `${styles.previewHit} ${styles.empty}` : styles.previewHit}
            title={kind === "none" ? t.appearanceWallpaperPick : t.appearanceWallpaperChange}
            onClick={() => void pickWallpaper()}
          >
            {kind === "image" ? (
              <img
                src={mediaSrc}
                alt=""
                draggable={false}
                onError={() => appearance.setWallpaperBroken(true)}
              />
            ) : kind === "video" ? (
              <video
                src={mediaSrc}
                autoPlay
                loop
                muted
                playsInline
                onError={() => appearance.setWallpaperBroken(true)}
              />
            ) : (
              <span className={styles.previewHint}>{t.appearanceWallpaperPick}</span>
            )}
            {isMedia && appearance.wallpaperBroken ? (
              <span className={styles.previewMissing}>{t.appearanceWallpaperMissing}</span>
            ) : null}
            {kind !== "none" ? (
              <span className={styles.previewAction}>{t.appearanceWallpaperChange}</span>
            ) : null}
          </button>
          {kind !== "none" ? (
            <button
              type="button"
              className={styles.previewRemove}
              onClick={() => appearance.clearWallpaper()}
            >
              {t.appearanceWallpaperRemove}
            </button>
          ) : null}
        </div>

        <div className={styles.wallpaperControls}>
          <AppearanceSliderRow
            label={t.appearanceVeilOpacity}
            value={appearance.wallpaper.veilOpacity}
            tip={t.appearanceVeilOpacityTip}
            disabled={!isMedia}
            onValueChange={(value) => appearance.setVeilOpacity(value)}
          />
          <AppearanceSliderRow
            label={t.appearanceVeilBlur}
            value={appearance.wallpaper.veilBlur}
            tip={t.appearanceVeilBlurTip}
            disabled={!isMedia}
            onValueChange={(value) => appearance.setVeilBlur(value)}
          />

          <AppearanceSliderRow
            label={t.appearanceSurfaceInput}
            value={appearance.surfaces.input}
            disabled={!isMedia}
            onValueChange={(value) => appearance.setSurfaceAlpha("input", value)}
          />
          <AppearanceSliderRow
            label={t.appearanceSurfaceCard}
            value={appearance.surfaces.card}
            tip={t.appearanceSurfaceCardTip}
            disabled={!isMedia}
            onValueChange={(value) => appearance.setSurfaceAlpha("card", value)}
          />
          <AppearanceSliderRow
            label={t.appearanceSurfaceSettings}
            value={appearance.surfaces.settings}
            disabled={!isMedia}
            onValueChange={(value) => appearance.setSurfaceAlpha("settings", value)}
          />
          <AppearanceSliderRow
            label={t.appearanceSurfaceTool}
            value={appearance.surfaces.tool}
            tip={t.appearanceSurfaceToolTip}
            disabled={!isMedia}
            onValueChange={(value) => appearance.setSurfaceAlpha("tool", value)}
          />
        </div>
      </div>
    </section>
  );
}

export default AppearanceWallpaperCard;
