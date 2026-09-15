<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { NButton, NIcon, NPopover, NSpace } from "naive-ui";
import { ArrowUpCircleOutline, LogoGithub } from "@vicons/ionicons5";
import PanelLeftIcon from "@renderer/components/icons/PanelLeftIcon.vue";
import LanRemoteIcon from "@renderer/components/icons/LanRemoteIcon.vue";
import PanelRightIcon from "@renderer/components/icons/PanelRightIcon.vue";
import PanelBottomIcon from "@renderer/components/icons/PanelBottomIcon.vue";
import LanConsoleSettings from "@renderer/components/LanConsoleSettings.vue";
import UpdateCard from "@renderer/components/UpdateCard.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useUpdateStore } from "@renderer/stores/update";
import { useLayoutStore } from "@renderer/stores/layout";
import { t } from "@renderer/i18n";
import logoUrl from "@renderer/assets/logo.svg";

const workspace = useWorkspaceStore();
const updateStore = useUpdateStore();
const layout = useLayoutStore();
const lanConsoleOpen = ref(false);
const lanConsoleEnabled = ref(false);
/** Public (Cloudflare tunnel) URL is live — shown as a second dot colour. */
const lanConsolePublic = ref(false);

async function refreshLanConsoleStatus(): Promise<void> {
  try {
    const status = await window.api.lanConsole.getStatus();
    lanConsoleEnabled.value = status.enabled;
    lanConsolePublic.value = Boolean(status.tunnel.url);
  } catch {
    lanConsoleEnabled.value = false;
    lanConsolePublic.value = false;
  }
}
const platform = ref<NodeJS.Platform>("win32");
const isMaximized = ref(false);
let offUpdateProgress: (() => void) | undefined;
let offMaximized: (() => void) | undefined;
let offUnmaximized: (() => void) | undefined;
let offTunnelStatus: (() => void) | undefined;

async function onMinimize(): Promise<void> {
  await window.api.window.minimize();
}

async function onMaximize(): Promise<void> {
  await window.api.window.maximize();
}

async function onClose(): Promise<void> {
  await window.api.window.close();
}

onMounted(async () => {
  void refreshLanConsoleStatus();
  offTunnelStatus = window.api.lanConsole.onTunnelStatus((status) => {
    lanConsolePublic.value = Boolean(status.url);
  });
  platform.value = await window.api.window.platform();
  if (platform.value !== "darwin") {
    isMaximized.value = await window.api.window.isMaximized();
    offMaximized = window.api.window.onMaximized(() => {
      isMaximized.value = true;
    });
    offUnmaximized = window.api.window.onUnmaximized(() => {
      isMaximized.value = false;
    });
  }
  offUpdateProgress = window.api.update.onProgress((p) => {
    updateStore.onProgress(p);
  });
  // Silent startup check — red badge only when an update exists.
  void updateStore.checkOnStartup();
});

onUnmounted(() => {
  offUpdateProgress?.();
  offMaximized?.();
  offUnmaximized?.();
  offTunnelStatus?.();
});

async function openGithub(): Promise<void> {
  await window.api.update.openGithub();
}

async function onUpdateClick(): Promise<void> {
  await updateStore.openUpdateCard();
}
</script>

<template>
  <header
    class="title-bar"
    :class="{ mac: platform === 'darwin', win: platform !== 'darwin' }"
  >
    <div class="drag traffic-space" aria-hidden="true" />
    <div class="brand">
      <img class="logo-img" :src="logoUrl" alt="" width="18" height="18" />
      <span class="name">{{ t.appName }}</span>
    </div>
    <div class="center drag" />
    <div class="actions no-drag">
      <NSpace :size="4">
        <NButton
          class="update-btn"
          quaternary
          circle
          size="small"
          :loading="updateStore.checking && !updateStore.modalOpen"
          :title="t.checkUpdate"
          @click="onUpdateClick"
        >
          <template #icon>
            <NIcon :component="ArrowUpCircleOutline" />
          </template>
          <span v-if="updateStore.available" class="update-dot" aria-hidden="true" />
        </NButton>
        <NPopover
          trigger="click"
          placement="bottom-end"
          :show="lanConsoleOpen"
          :width="360"
          :show-arrow="false"
          style="padding: 0"
          @update:show="(v) => (lanConsoleOpen = v)"
        >
          <template #trigger>
            <NButton
              class="no-drag"
              quaternary
              circle
              size="small"
              :title="t.lanConsoleTitle"
              :aria-label="t.lanConsoleTitle"
              @click.stop="
                lanConsoleOpen = true;
                void refreshLanConsoleStatus();
              "
            >
              <template #icon>
                <LanRemoteIcon :size="16" />
              </template>
              <span
                v-if="lanConsoleEnabled"
                class="lan-console-dot"
                :class="{ public: lanConsolePublic }"
                :title="lanConsolePublic ? t.lanPublicTitle : t.lanConsoleOn"
              />
            </NButton>
          </template>
          <LanConsoleSettings @close="lanConsoleOpen = false" />
        </NPopover>
        <NButton quaternary circle size="small" @click="openGithub">
          <template #icon>
            <NIcon :component="LogoGithub" />
          </template>
        </NButton>
      </NSpace>
      <div v-if="workspace.root" class="layout-controls">
        <button
          type="button"
          class="layout-btn"
          :class="{ checked: !layout.leftCollapsed }"
          :title="layout.leftCollapsed ? t.expandLeft : t.collapseLeft"
          :aria-label="layout.leftCollapsed ? t.expandLeft : t.collapseLeft"
          :aria-pressed="!layout.leftCollapsed"
          @click="layout.toggleLeftCollapsed()"
        >
          <PanelLeftIcon :size="16" :off="layout.leftCollapsed" />
        </button>
        <button
          type="button"
          class="layout-btn"
          :class="{ checked: !layout.bottomCollapsed }"
          :title="layout.bottomCollapsed ? t.expandBottom : t.collapseBottom"
          :aria-label="layout.bottomCollapsed ? t.expandBottom : t.collapseBottom"
          :aria-pressed="!layout.bottomCollapsed"
          @click="layout.toggleBottomCollapsed()"
        >
          <PanelBottomIcon :size="16" :off="layout.bottomCollapsed" />
        </button>
        <button
          type="button"
          class="layout-btn"
          :class="{ checked: !layout.rightCollapsed }"
          :title="layout.rightCollapsed ? t.expandRight : t.collapseRight"
          :aria-label="layout.rightCollapsed ? t.expandRight : t.collapseRight"
          :aria-pressed="!layout.rightCollapsed"
          @click="layout.toggleRightCollapsed()"
        >
          <PanelRightIcon :size="16" :off="layout.rightCollapsed" />
        </button>
      </div>
    </div>
    <div v-if="platform !== 'darwin'" class="window-controls no-drag">
      <button type="button" class="wc-btn" :title="t.minimize" :aria-label="t.minimize" @click="onMinimize">
        <svg class="wc-icon minimize-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0.5" y1="5" x2="9.5" y2="5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button type="button" class="wc-btn" :title="isMaximized ? t.restore : t.maximize" :aria-label="isMaximized ? t.restore : t.maximize" @click="onMaximize">
        <svg v-if="!isMaximized" class="wc-icon maximize-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else class="wc-icon restore-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
          <rect x="0.5" y="0.5" width="7" height="7" fill="var(--wc-restore-fill, var(--bg-title))" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button type="button" class="wc-btn close-btn" :title="t.close" :aria-label="t.close" @click="onClose">
        <svg class="wc-icon close-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1" />
          <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </header>
  <UpdateCard />
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--bg-title) 88%, var(--bg-elevated));
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 12px;
  user-select: none;
  flex-shrink: 0;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--bg-elevated) 40%, transparent);
  /* Whole bar is draggable; interactive children use .no-drag. */
  -webkit-app-region: drag;
}

.drag {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.traffic-space {
  width: 0;
  flex-shrink: 0;
}

.title-bar.mac .traffic-space {
  /* Leave room for traffic lights (hiddenInset + trafficLightPosition). */
  width: 72px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 4px;
  color: var(--fg-strong);
}

.layout-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
}

/* VSCode 布局控件：图标常驻，区域可见时高亮。 */
.layout-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.layout-btn:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--fg-strong);
}

.layout-btn.checked,
.layout-btn.checked:hover {
  background: var(--bg-active);
  color: var(--fg-strong);
}

.logo-img {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: block;
  flex-shrink: 0;
}

.name {
  font-weight: 600;
  font-size: 12.5px;
  letter-spacing: -0.01em;
}

.center {
  flex: 1;
  min-width: 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.update-btn {
  position: relative;
  flex-shrink: 0;
  margin-right: 2px;
}

.update-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1.5px var(--bg-title, var(--bg));
  pointer-events: none;
}

.window-controls {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 100%;
}

.wc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease, color 0.12s ease;
}

.wc-btn:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--fg-strong);
}

.wc-btn.close-btn:hover {
  background: #c42b1c;
  color: #fff;
}

.wc-icon {
  display: block;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
}
/* LAN console titlebar entry (left, after the app name) - same visual
   language as the right-side titlebar buttons. */
.lan-console-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 1.5px var(--bg-title, var(--bg));
}
/* Public access rides a Cloudflare tunnel — flag it with the Cloudflare orange. */
.lan-console-dot.public {
  background: #f38020;
}
</style>
