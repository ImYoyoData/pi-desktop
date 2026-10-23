import type { ReactNode } from "react";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { wallpaperMediaSrc } from "../../../shared/appearance";
import styles from "./AppWallpaper.module.css";

/** 全局背景层：壁纸 + 遮罩 + 界面底色；界面底色只在这一层合成一次。 */
export function AppWallpaper(): ReactNode {
  const appearance = useAppearanceStore();
  const kind = appearance.wallpaper.kind;
  const broken = appearance.wallpaperBroken;
  const path = appearance.wallpaper.path;
  const mediaSrc = path ? wallpaperMediaSrc(path) : "";

  if (kind === "none" || broken) return null;

  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.media}>
        {kind === "image" ? (
          <img
            src={mediaSrc}
            alt=""
            draggable={false}
            onError={() => appearance.setWallpaperBroken(true)}
          />
        ) : (
          <video
            src={mediaSrc}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            onError={() => appearance.setWallpaperBroken(true)}
          />
        )}
      </div>
      <div className={styles.veil} />
      <div className={styles.ui} />
    </div>
  );
}

export default AppWallpaper;
