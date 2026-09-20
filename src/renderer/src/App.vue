<script setup lang="ts">
// pi-lens-ignore: 2305
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from "vue";
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  zhCN,
  dateZhCN,
  enUS,
  dateEnUS,
} from "naive-ui";
import TitleBar from "@renderer/components/TitleBar.vue";
import AppWallpaper from "@renderer/components/AppWallpaper.vue";
import AppContextMenu from "@renderer/components/AppContextMenu.vue";
import AppHoverTip from "@renderer/components/AppHoverTip.vue";
import WelcomeView from "@renderer/components/WelcomeView.vue";
import PiCliSetup from "@renderer/components/PiCliSetup.vue";
import CloseGuard from "@renderer/components/CloseGuard.vue";
import AsrWakeGuard from "@renderer/components/AsrWakeGuard.vue";
import AsrBackendChooseModal from "@renderer/components/AsrBackendChooseModal.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import { useSecurityStore } from "@renderer/stores/security";
import { useLayoutStore } from "@renderer/stores/layout";
import { useComposerStore } from "@renderer/stores/composer";
import { usePreviewStore } from "@renderer/stores/preview";
import { DEFAULT_PERMISSION_PROFILE, PERMISSION_PROFILES } from "../../shared/desktop-security";
import { COMPOSER_AGENT_MODES } from "../../shared/composer-modes";
import { darkThemeOverrides, lightThemeOverrides } from "@renderer/theme/naive";
import { locale } from "@renderer/i18n";
import { dismissStartupSplash } from "@renderer/utils/startup-splash";
import { markRendererStartup } from "@renderer/utils/startup-timing";
import { startFsChangedBus } from "@renderer/utils/fs-changed-bus";
import { isTextEntryTarget } from "@renderer/utils/keyboard-target";

/** Heavy workspace chrome — load after first paint when a folder is open. */
const SplitRoot = defineAsyncComponent(() => {
  markRendererStartup("renderer:splitroot-load-start");
  return import("@renderer/components/SplitRoot.vue").then((m) => {
    markRendererStartup("renderer:splitroot-load-done");
    return m;
  });
});
const AiCustomizationModal = defineAsyncComponent(
  () => import("@renderer/components/AiCustomizationModal.vue"),
);

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
const customizations = useCustomizationsStore();
const keybindings = useKeybindingsStore();
const security = useSecurityStore();
const layout = useLayoutStore();
const composer = useComposerStore();
const preview = usePreviewStore();

async function cyclePermission(): Promise<void> {
  if (!security.loaded) await security.load();
  const index = PERMISSION_PROFILES.indexOf(security.profile);
  const next =
    PERMISSION_PROFILES[(index + 1) % PERMISSION_PROFILES.length] ?? DEFAULT_PERMISSION_PROFILE;
  await security.setProfile(next);
}

function cycleComposerMode(): void {
  const index = COMPOSER_AGENT_MODES.indexOf(composer.mode);
  composer.setMode(COMPOSER_AGENT_MODES[(index + 1) % COMPOSER_AGENT_MODES.length] ?? "agent");
}

/** 等同编辑器区的「打开文件…」按钮：系统对话框选文件，打开到编辑器区。 */
async function pickAndOpenFile(): Promise<void> {
  const picked = await window.api.preview.pickFile();
  if (picked) preview.openPreview(picked);
}

/** 全局快捷键：在根组件注册一次，先于子组件挂载，capture 阶段优先拦截。 */
keybindings.install();
keybindings.register("cycle-permission", () => void cyclePermission());
keybindings.register("toggle-right-pane", () => layout.toggleRightCollapsed());
keybindings.register("open-settings", () => layout.openCustomize(layout.customizeSection));
keybindings.register("cycle-mode", cycleComposerMode);
keybindings.register("open-file", () => void pickAndOpenFile());

/** 最上层确认对话框的确定按钮：negative 按钮带 ghost 标记，需排除。 */
function dialogConfirmButton(): HTMLElement | null {
  const actions = document.querySelectorAll<HTMLElement>(".n-dialog__action");
  const action = actions[actions.length - 1];
  if (!action) return null;
  const buttons = action.querySelectorAll<HTMLElement>("button:not(.n-button--ghost)");
  return buttons[buttons.length - 1] ?? null;
}

/** 对话框内输入框的 Enter 由输入框自己处理，避免重复提交。 */
function inDialogTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && !!target.closest(".n-dialog") && isTextEntryTarget(target)
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
/** True once workspace/platform init finished (gates shell mounting). */
const bootInitDone = ref(false);
/**
 * Failsafe: some init steps (e.g. the trust prompt awaiting user input)
 * can take a while; never block shell mounting forever.
 */
const BOOT_MAX_MS = 6000;
/** 首屏就绪后延迟预热设置页快照的时长，避开启用初期的其它启动任务。 */
const CUSTOMIZATIONS_PREWARM_MS = 1200;
let bootTimer = 0;

/** Shell content can mount once init IPC returns (or failsafe fires). */
const shellReady = computed(() => bootInitDone.value);
const naiveLocale = computed(() => (locale.value === "zh-CN" ? zhCN : enUS));
const naiveDateLocale = computed(() =>
  locale.value === "zh-CN" ? dateZhCN : dateEnUS,
);

const naiveTheme = computed(() =>
  appearance.resolvedTheme === "dark" ? darkTheme : null,
);
const themeOverrides = computed(() =>
  appearance.resolvedTheme === "dark" ? darkThemeOverrides : lightThemeOverrides,
);

let stopAppearance: (() => void) | undefined;
let stopFsChangedBus: (() => void) | undefined;
let stopCustomizations: (() => void) | undefined;
let customizationsWarmTimer = 0;

onMounted(() => {
  window.addEventListener("keydown", onDialogEnterKeydown, true);
  stopAppearance = appearance.init();
  stopFsChangedBus = startFsChangedBus();
  stopCustomizations = customizations.init();
  void window.api.window.setUiLocale(locale.value);
  // Instant open: drop the full-screen splash right after first paint so the
  // window feels instant; shell content mounts once workspace init finishes.
  void dismissStartupSplash(true);
  // Hard cap: never block shell mounting if workspace IPC hangs.
  bootTimer = window.setTimeout(() => {
    bootInitDone.value = true;
  }, BOOT_MAX_MS);
  void (async () => {
    try {
      await Promise.all([
        workspace.getWorkspace(),
        // Desktop-only first; Pi CLI session scan merges in the background.
        workspace.listRecentFast(),
        window.api.window.platform().then((p) => {
          document.documentElement.classList.toggle("platform-darwin", p === "darwin");
          document.documentElement.classList.toggle("platform-win32", p === "win32");
        }),
      ]);
    } finally {
      bootInitDone.value = true;
      markRendererStartup("renderer:shell-ready");
      if (!workspace.root) markRendererStartup("renderer:ready");
      // 后台预热设置页快照：冷启动首次扫描不挡首屏，之后打开设置页直接命中缓存。
      customizationsWarmTimer = window.setTimeout(() => {
        if (workspace.root) void customizations.load();
      }, CUSTOMIZATIONS_PREWARM_MS);
    }
  })();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onDialogEnterKeydown, true);
  window.clearTimeout(bootTimer);
  window.clearTimeout(customizationsWarmTimer);
  keybindings.uninstall();
  stopAppearance?.();
  stopFsChangedBus?.();
  stopCustomizations?.();
});
</script>

<template>
  <NConfigProvider
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    abstract
  >
    <NMessageProvider>
      <NDialogProvider>
        <CloseGuard />
        <AsrWakeGuard />
        <div
          class="app-shell"
          :data-theme="appearance.resolvedTheme"
          :class="{ 'panel-dividers-off': !appearance.showPanelDividers }"
        >
          <AppWallpaper />
          <TitleBar />
          <main class="app-main">
            <div v-if="shellReady" class="app-main-body">
              <WelcomeView v-if="!workspace.root" />
              <SplitRoot v-else />
            </div>
          </main>
          <PiCliSetup />
          <AiCustomizationModal v-if="workspace.root" />
          <AsrBackendChooseModal />
        </div>
        <AppContextMenu />
        <AppHoverTip />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
}

.app-main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-main-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  animation: shell-rise 280ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}

@keyframes shell-rise {
  from {
    opacity: 0.35;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-main-body {
    animation: none !important;
    transition: none !important;
  }
}
</style>
