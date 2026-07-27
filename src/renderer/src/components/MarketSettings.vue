<script setup lang="ts">
import { NButton, NModal, NSpace, NText, useMessage } from "naive-ui";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useLayoutStore } from "@renderer/stores/layout";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { t } from "@renderer/i18n";
import {
  PI_MARKET_URL,
  PI_MARKETPLACE_INSTALL_CMD,
  PI_PACKAGES_DOCS_URL,
} from "../../../shared/pi-cli";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const message = useMessage();
const browserNav = useBrowserNavStore();
const layout = useLayoutStore();
const rightTabs = useRightTabsStore();

function openInBuiltinBrowser(url: string): void {
  const active = rightTabs.activeTab;
  const existing =
    (active?.kind === "browser" ? active : null) ??
    rightTabs.tabs.find((tab) => tab.kind === "browser") ??
    null;
  let tab = existing;
  if (tab) {
    rightTabs.selectTab(tab.id);
  } else {
    tab = rightTabs.addTab("browser");
  }
  browserNav.requestNavigate(url, tab.id);
  if (layout.rightCollapsed) layout.toggleRightCollapsed();
  emit("close");
}

async function openExternal(url: string): Promise<void> {
  await window.api.browser.openExternal(url);
}

async function copyInstallCmd(): Promise<void> {
  await navigator.clipboard.writeText(PI_MARKETPLACE_INSTALL_CMD);
  message.success(t.marketInstallCopied);
}
</script>

<template>
  <NModal
    :show="open"
    preset="card"
    :title="t.marketTitle"
    style="width: min(520px, 92vw)"
    :bordered="false"
    @update:show="(v: boolean) => !v && emit('close')"
  >
    <NText depth="3" style="font-size: 13px; line-height: 1.55; display: block; margin-bottom: 16px">
      {{ t.marketHint }}
    </NText>

    <section class="section">
      <div class="section-title">{{ t.marketSectionBrowse }}</div>
      <NSpace vertical :size="8">
        <NButton block type="primary" @click="openInBuiltinBrowser(PI_MARKET_URL)">
          {{ t.marketOpenBuiltin }}
        </NButton>
        <NButton block secondary @click="openExternal(PI_MARKET_URL)">
          {{ t.marketBrowseNpm }}
        </NButton>
        <NButton block quaternary @click="openExternal(PI_PACKAGES_DOCS_URL)">
          {{ t.marketDocs }}
        </NButton>
      </NSpace>
    </section>

    <section class="section">
      <div class="section-title">{{ t.marketSectionInstall }}</div>
      <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
        {{ t.marketInstallExt }}
      </NText>
      <code class="cmd">{{ PI_MARKETPLACE_INSTALL_CMD }}</code>
      <NButton size="small" style="margin-top: 10px" @click="copyInstallCmd">
        {{ t.copy }}
      </NButton>
    </section>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.section {
  margin-bottom: 18px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cmd {
  display: block;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--pre-bg, rgba(0, 0, 0, 0.04));
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  word-break: break-all;
}
</style>
