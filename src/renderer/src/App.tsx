import { App as AntApp, ConfigProvider } from "antd";
import { lazy, Suspense, useEffect, useState } from "react";
import TitleBar from "@renderer/components/TitleBar";
import AppWallpaper from "@renderer/components/AppWallpaper";
import AppContextMenu from "@renderer/components/AppContextMenu";
import SuppressHoverTips from "@renderer/components/SuppressHoverTips";
import PiCliSetup from "@renderer/components/PiCliSetup";
import CloseGuard from "@renderer/components/CloseGuard";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import { useLayoutStore } from "@renderer/stores/layout";
import { usePreviewStore } from "@renderer/stores/preview";
import { FeedbackProvider } from "@renderer/services/feedback";
import { antdLocaleFor, themeConfigFor } from "@renderer/theme/antd";
import { useUiLocale } from "@renderer/i18n/use-i18n";
import { getLocale } from "@renderer/i18n";
import { dismissStartupSplash } from "@renderer/utils/startup-splash";
import { markRendererStartup } from "@renderer/utils/startup-timing";
import { isTextEntryTarget } from "@renderer/utils/keyboard-target";
import { startStateSync } from "@renderer/utils/state-sync";
import { FONT_SIZE_DEFAULT } from "../../shared/appearance";
import "./App.css";

/** Heavy workspace chrome — load after first paint when a folder is open. */
const SplitRoot = lazy(async () => {
  markRendererStartup("renderer:splitroot-load-start");
  const module = await import("@renderer/components/SplitRoot");
  markRendererStartup("renderer:splitroot-load-done");
  return module;
});
const AiCustomizationModal = lazy(
  () => import("@renderer/components/AiCustomizationModal"),
);

/** 等同编辑器区的「打开文件…」按钮：系统对话框选文件，打开到编辑器区。 */
async function pickAndOpenFile(): Promise<void> {
  const picked = await window.api.preview.pickFile();
  if (picked) usePreviewStore.getState().openPreview(picked);
}

/** 最上层确认对话框的确定按钮：取消按钮是次要样式，需排除。 */
function dialogConfirmButton(): HTMLElement | null {
  const footers = document.querySelectorAll<HTMLElement>(".ant-modal-footer");
  const footer = footers[footers.length - 1];
  if (!footer) return null;
  const primary = footer.querySelector<HTMLElement>("button.ant-btn-primary");
  if (primary) return primary;
  const buttons = footer.querySelectorAll<HTMLElement>("button");
  return buttons[buttons.length - 1] ?? null;
}

/** 对话框内输入框的 Enter 由输入框自己处理，避免重复提交。 */
function inDialogTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest(".ant-modal") &&
    isTextEntryTarget(target)
  );
}

/** 任意确认对话框弹出时，Enter 等同点击确定。 */
function onDialogEnterKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing || inDialogTextEntry(event.target)) return;
  const confirm = dialogConfirmButton();
  if (!confirm) return;
  event.preventDefault();
  confirm.click();
}

export function App(): React.ReactNode {
  const appearance = useAppearanceStore();
  const workspace = useWorkspaceStore();
  const locale = useUiLocale();
  const [bootInitDone, setBootInitDone] = useState(false);

  /** Failsafe: some init steps (e.g. the trust prompt awaiting user input)
   * can take a while; never block shell mounting forever. */
  const BOOT_MAX_MS = 6000;
  /** 首屏就绪后延迟预热设置页快照的时长，避开启用初期的其它启动任务。 */
  const CUSTOMIZATIONS_PREWARM_MS = 1200;

  useEffect(() => {
    startStateSync();
    window.addEventListener("keydown", onDialogEnterKeydown, true);
    const offMenuCommand = window.api.window.onMenuCommand((command) => {
      if (command === "open-pull-requests") useLayoutStore.getState().showPullRequests();
      else if (command === "zoom-in") useAppearanceStore.getState().stepFontSize(1);
      else if (command === "zoom-out") useAppearanceStore.getState().stepFontSize(-1);
      else if (command === "zoom-reset")
        useAppearanceStore.getState().setFontSize(FONT_SIZE_DEFAULT);
    });
    const keybindings = useKeybindingsStore.getState();
    keybindings.install();
    keybindings.register("toggle-right-pane", () =>
      useLayoutStore.getState().toggleRightCollapsed(),
    );
    keybindings.register("open-settings", () => {
      const layout = useLayoutStore.getState();
      layout.openCustomize(layout.customizeSection);
    });
    keybindings.register("open-file", () => void pickAndOpenFile());
    keybindings.register("open-pull-requests", () =>
      useLayoutStore.getState().showPullRequests(),
    );

    const stopAppearance = useAppearanceStore.getState().init();
    const stopCustomizations = useCustomizationsStore.getState().init();
    void window.api.window.setUiLocale(getLocale());
    // Instant open: drop the full-screen splash right after first paint so the
    // window feels instant; shell content mounts once workspace init finishes.
    void dismissStartupSplash(true);
    // Hard cap: never block shell mounting if workspace IPC hangs.
    const bootTimer = window.setTimeout(() => {
      setBootInitDone(true);
    }, BOOT_MAX_MS);
    void (async () => {
      try {
        await Promise.all([
          useWorkspaceStore.getState().getWorkspace(),
          // Desktop-only first; Pi CLI session scan merges in the background.
          useWorkspaceStore.getState().listRecentFast(),
          window.api.window.platform().then((p) => {
            document.documentElement.classList.toggle("platform-darwin", p === "darwin");
            document.documentElement.classList.toggle("platform-win32", p === "win32");
          }),
        ]);
      } finally {
        setBootInitDone(true);
        markRendererStartup("renderer:shell-ready");
        if (!useWorkspaceStore.getState().root) markRendererStartup("renderer:ready");
        // 后台预热设置页快照：冷启动首次扫描不挡首屏，之后打开设置页直接命中缓存。
        window.setTimeout(() => {
          if (useWorkspaceStore.getState().root) {
            void useCustomizationsStore.getState().load();
          }
        }, CUSTOMIZATIONS_PREWARM_MS);
      }
    })();

    return () => {
      window.removeEventListener("keydown", onDialogEnterKeydown, true);
      window.clearTimeout(bootTimer);
      keybindings.uninstall();
      offMenuCommand?.();
      stopAppearance?.();
      stopCustomizations?.();
    };
  }, []);

  return (
    <ConfigProvider
      theme={themeConfigFor(appearance.resolvedTheme, appearance.fontSize)}
      locale={antdLocaleFor(locale)}
    >
      <AntApp>
        <FeedbackProvider>
          <CloseGuard />
          <div className="app-shell" data-theme={appearance.resolvedTheme}>
            <AppWallpaper />
            <TitleBar />
            <main className="app-main">
              {bootInitDone ? (
                <div className="app-main-body">
                  <Suspense fallback={null}>
                    <SplitRoot />
                  </Suspense>
                </div>
              ) : null}
            </main>
            <PiCliSetup />
            {workspace.root ? (
              <Suspense fallback={null}>
                <AiCustomizationModal />
              </Suspense>
            ) : null}
          </div>
          <AppContextMenu />
          <SuppressHoverTips />
        </FeedbackProvider>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
