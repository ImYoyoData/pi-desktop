<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NEmpty,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useLayoutStore } from "@renderer/stores/layout";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";
import { PI_MARKET_URL, PI_PACKAGES_DOCS_URL } from "../../../shared/pi-cli";
import {
  piInstallCommand,
  type PiPackageListItem,
  type PiPackageType,
} from "../../../shared/pi-market";

type InstalledPkg = {
  source: string;
  scope: "global" | "project";
};

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const message = useMessage();
const dialog = useDialog();
const browserNav = useBrowserNavStore();
const layout = useLayoutStore();
const rightTabs = useRightTabsStore();
const workspace = useWorkspaceStore();

const loading = ref(false);
const busy = ref<string | null>(null);
const query = ref("");
const pkgType = ref<PiPackageType>("");
const items = ref<PiPackageListItem[]>([]);
const totalHint = ref<string | null>(null);
const error = ref<string | null>(null);
/** Bare package name → installed entries (npm:foo → foo). */
const installedByName = ref<Map<string, InstalledPkg[]>>(new Map());
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const typeOptions = [
  { label: t.marketTypeAll, value: "" },
  { label: t.marketTypeExtension, value: "extension" },
  { label: t.marketTypeSkill, value: "skill" },
  { label: t.marketTypeTheme, value: "theme" },
  { label: t.marketTypePrompt, value: "prompt" },
];

const filteredEmpty = computed(() => !loading.value && !error.value && items.value.length === 0);

function barePackageName(source: string): string {
  return source.replace(/^npm:/i, "").trim();
}

function installedEntries(pkgName: string): InstalledPkg[] {
  return installedByName.value.get(pkgName) ?? [];
}

function isInstalled(pkgName: string): boolean {
  return installedEntries(pkgName).length > 0;
}

async function loadInstalled(): Promise<void> {
  try {
    const data = await window.api.plugins.list(workspace.root ?? undefined);
    const map = new Map<string, InstalledPkg[]>();
    for (const pkg of data.packages) {
      const name = barePackageName(pkg.source);
      if (!name) continue;
      const list = map.get(name) ?? [];
      list.push({ source: pkg.source, scope: pkg.scope });
      map.set(name, list);
    }
    installedByName.value = map;
  } catch {
    // Market still usable without local install status
    installedByName.value = new Map();
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [result] = await Promise.all([
      window.api.market.list({
        query: query.value.trim() || undefined,
        type: pkgType.value || undefined,
      }),
      loadInstalled(),
    ]);
    if (!result.ok) {
      error.value = result.error ?? t.marketLoadFailed;
      items.value = [];
      totalHint.value = null;
      return;
    }
    items.value = result.items;
    totalHint.value = result.totalHint;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function scheduleRefresh(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void refresh();
  }, 280);
}

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

async function installPkg(pkg: PiPackageListItem): Promise<void> {
  if (busy.value) return;
  busy.value = pkg.name;
  try {
    const result = await window.api.market.install(pkg.name);
    if (result.ok) {
      message.success(t.marketInstalled(pkg.name));
      await loadInstalled();
    } else {
      message.error(result.error || t.marketInstallFailed);
      if (result.log?.trim()) {
        console.warn("[market install]", result.command, result.log);
      }
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    busy.value = null;
  }
}

function uninstallPkg(pkg: PiPackageListItem): void {
  const entries = installedEntries(pkg.name);
  if (!entries.length || busy.value) return;

  dialog.warning({
    title: t.marketUninstall,
    content: t.marketUninstallConfirm(pkg.name),
    positiveText: t.uninstall,
    negativeText: t.cancel,
    onPositiveClick: async () => {
      busy.value = pkg.name;
      try {
        for (const entry of entries) {
          await window.api.plugins.remove(entry.source, entry.scope, workspace.root ?? undefined);
        }
        message.success(t.marketUninstalled(pkg.name));
        await loadInstalled();
      } catch (err) {
        message.error(err instanceof Error ? err.message : t.marketUninstallFailed);
      } finally {
        busy.value = null;
      }
    },
  });
}

async function copyCmd(pkg: PiPackageListItem): Promise<void> {
  await navigator.clipboard.writeText(piInstallCommand(pkg.name));
  message.success(t.marketInstallCopied);
}

watch(
  () => props.open,
  (open) => {
    if (open) void refresh();
  },
);

watch(pkgType, () => {
  void refresh();
});

watch(query, () => {
  scheduleRefresh();
});
</script>

<template>
  <NModal
    :show="open"
    preset="card"
    :title="t.marketTitle"
    class="pi-settings-modal"
    style="width: min(720px, 94vw)"
    :bordered="false"
    @update:show="(v: boolean) => !v && emit('close')"
  >
    <NText depth="3" style="font-size: 13px; line-height: 1.55; display: block; margin-bottom: 12px">
      {{ t.marketHint }}
    </NText>

    <div class="toolbar">
      <NInput
        v-model:value="query"
        size="small"
        clearable
        :placeholder="t.marketSearchPlaceholder"
        class="search"
      />
      <NSelect
        v-model:value="pkgType"
        size="small"
        :options="typeOptions"
        class="type"
      />
      <NButton size="small" :loading="loading" @click="refresh">{{ t.filesRefresh }}</NButton>
    </div>

    <div class="meta-row">
      <NText depth="3" style="font-size: 11px">
        {{ totalHint ? t.marketShowing(totalHint) : t.marketFromPiDev }}
      </NText>
      <NSpace :size="6">
        <NButton text size="tiny" @click="openInBuiltinBrowser(PI_MARKET_URL)">
          {{ t.marketOpenBuiltin }}
        </NButton>
        <NButton text size="tiny" @click="openExternal(PI_PACKAGES_DOCS_URL)">
          {{ t.marketDocs }}
        </NButton>
      </NSpace>
    </div>

    <NSpin :show="loading" class="list-spin">
      <NEmpty v-if="error" :description="error" size="small" class="empty" />
      <NEmpty v-else-if="filteredEmpty" :description="t.marketEmpty" size="small" class="empty" />
      <ul v-else class="pkg-list">
        <li v-for="pkg in items" :key="pkg.name" class="pkg-row">
          <div class="pkg-main">
            <div class="pkg-title-row">
              <button
                type="button"
                class="pkg-name"
                :title="pkg.path"
                @click="openInBuiltinBrowser(`${PI_MARKET_URL}/${pkg.name}`)"
              >
                {{ pkg.name }}
              </button>
              <NTag
                v-if="isInstalled(pkg.name)"
                size="tiny"
                type="success"
                :bordered="false"
              >
                {{ t.marketAlreadyInstalled }}
              </NTag>
            </div>
            <div class="pkg-desc">{{ pkg.description || "—" }}</div>
            <code class="pkg-cmd">{{ piInstallCommand(pkg.name) }}</code>
          </div>
          <div class="pkg-actions">
            <NButton
              size="tiny"
              secondary
              :disabled="Boolean(busy)"
              @click="copyCmd(pkg)"
            >
              {{ t.copy }}
            </NButton>
            <NButton
              v-if="isInstalled(pkg.name)"
              size="tiny"
              type="error"
              secondary
              :loading="busy === pkg.name"
              :disabled="Boolean(busy) && busy !== pkg.name"
              @click="uninstallPkg(pkg)"
            >
              {{ t.marketUninstall }}
            </NButton>
            <NButton
              v-else
              size="tiny"
              type="primary"
              :loading="busy === pkg.name"
              :disabled="Boolean(busy) && busy !== pkg.name"
              @click="installPkg(pkg)"
            >
              {{ t.marketInstall }}
            </NButton>
          </div>
        </li>
      </ul>
    </NSpin>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.search {
  flex: 1;
  min-width: 0;
}

.type {
  width: 132px;
  flex-shrink: 0;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.list-spin {
  min-height: 280px;
  max-height: min(52vh, 480px);
  overflow: auto;
}

.empty {
  margin-top: 48px;
}

.pkg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pkg-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated, #fff);
}

.pkg-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pkg-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pkg-name {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.pkg-name:hover {
  text-decoration: underline;
}

.pkg-desc {
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pkg-cmd {
  font-size: 11px;
  color: var(--fg-faint);
  font-family: var(--font-mono, ui-monospace, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pkg-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
</style>
