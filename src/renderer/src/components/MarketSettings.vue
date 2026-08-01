<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
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
const loadingMore = ref(false);
const busy = ref<string | null>(null);
const query = ref("");
const pkgType = ref<PiPackageType>("");
const items = ref<PiPackageListItem[]>([]);
const page = ref(1);
const hasMore = ref(false);
const totalHint = ref<string | null>(null);
const error = ref<string | null>(null);
/** Bare package name → installed entries (npm:foo → foo). */
const installedByName = ref<Map<string, InstalledPkg[]>>(new Map());
const listEl = ref<HTMLElement | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loadSeq = 0;

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

function mergeItems(prev: PiPackageListItem[], next: PiPackageListItem[]): PiPackageListItem[] {
  const seen = new Set(prev.map((p) => p.name));
  const out = [...prev];
  for (const item of next) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}

async function fetchPage(nextPage: number, append: boolean): Promise<void> {
  const seq = ++loadSeq;
  if (append) loadingMore.value = true;
  else {
    loading.value = true;
    error.value = null;
  }
  try {
    const tasks: Promise<unknown>[] = [
      window.api.market.list({
        query: query.value.trim() || undefined,
        type: pkgType.value || undefined,
        page: nextPage,
      }),
    ];
    if (!append) tasks.push(loadInstalled());
    const [result] = (await Promise.all(tasks)) as [
      Awaited<ReturnType<typeof window.api.market.list>>,
    ];
    if (seq !== loadSeq) return;
    if (!result.ok) {
      if (!append) {
        error.value = result.error ?? t.marketLoadFailed;
        items.value = [];
        totalHint.value = null;
        hasMore.value = false;
        page.value = 1;
      } else {
        message.error(result.error ?? t.marketLoadFailed);
      }
      return;
    }
    items.value = append ? mergeItems(items.value, result.items) : result.items;
    page.value = result.page;
    hasMore.value = result.hasMore;
    totalHint.value = result.totalHint;
  } catch (err) {
    if (seq !== loadSeq) return;
    const msg = err instanceof Error ? err.message : String(err);
    if (!append) {
      error.value = msg;
      items.value = [];
      hasMore.value = false;
    } else {
      message.error(msg);
    }
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

async function refresh(): Promise<void> {
  page.value = 1;
  hasMore.value = false;
  await fetchPage(1, false);
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = 0;
}

async function loadMore(): Promise<void> {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  await fetchPage(page.value + 1, true);
}

function onListScroll(ev: Event): void {
  const el = ev.target as HTMLElement | null;
  if (!el || loading.value || loadingMore.value || !hasMore.value) return;
  const remain = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (remain < 120) void loadMore();
}

function scheduleRefresh(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void refresh();
  }, 280);
}

function openInBuiltinBrowser(url: string): void {
  // Always open a new browser tab — never overwrite an existing one.
  const tab = rightTabs.addTab("browser");
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

  const d = dialog.warning({
    title: t.marketUninstall,
    content: t.marketUninstallConfirm(pkg.name),
    positiveText: t.uninstall,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      busy.value = pkg.name;
      return (async () => {
        try {
          for (const entry of entries) {
            await window.api.plugins.remove(entry.source, entry.scope, workspace.root ?? undefined);
          }
          message.success(t.marketUninstalled(pkg.name));
          await loadInstalled();
        } catch (err) {
          message.error(err instanceof Error ? err.message : t.marketUninstallFailed);
          d.loading = false;
          return false;
        } finally {
          busy.value = null;
        }
      })();
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
    style="width: min(880px, 96vw)"
    :bordered="false"
    @update:show="(v: boolean) =>
    
 !v && emit('close')"
  >
    <div class="modal-scroll">

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
      <NButton size="small" class="pi-interactive" :loading="loading" @click="refresh">
        {{ t.filesRefresh }}
      </NButton>
    </div>

    <div class="meta-row">
      <NText depth="3" style="font-size: 11px">
        {{ totalHint ? t.marketShowing(totalHint) : t.marketFromPiDev }}
      </NText>
      <NSpace :size="6">
        <NButton text size="tiny" class="pi-interactive" @click="openInBuiltinBrowser(PI_MARKET_URL)">
          {{ t.marketOpenBuiltin }}
        </NButton>
        <NButton text size="tiny" class="pi-interactive" @click="openExternal(PI_PACKAGES_DOCS_URL)">
          {{ t.marketDocs }}
        </NButton>
      </NSpace>
    </div>

    <div class="list-wrap">
      <div ref="listEl" class="list-spin" @scroll.passive="onListScroll">
        <NSpin :show="loading">
          <NEmpty v-if="error" :description="error" size="small" class="empty" />
          <NEmpty v-else-if="filteredEmpty" :description="t.marketEmpty" size="small" class="empty" />
          <ul v-else class="pkg-list">
            <li v-for="pkg in items" :key="pkg.name" class="pkg-row">
              <div class="pkg-main">
                <div class="pkg-title-row">
                  <button
                    type="button"
                    class="pkg-name pi-interactive"
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
                  class="pi-interactive"
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
                  class="pi-interactive"
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
                  class="pi-interactive"
                  :loading="busy === pkg.name"
                  :disabled="Boolean(busy) && busy !== pkg.name"
                  @click="installPkg(pkg)"
                >
                  {{ t.marketInstall }}
                </NButton>
              </div>
            </li>
            <li v-if="items.length && (hasMore || loadingMore)" class="pkg-footer">
              <NButton
                v-if="hasMore && !loadingMore"
                size="tiny"
                quaternary
                class="pi-interactive"
                @click="loadMore"
              >
                {{ t.marketLoadMore }}
              </NButton>
              <div v-else-if="loadingMore" class="load-more-inline">
                <NSpin size="small" />
                <span>{{ t.marketLoadingMore }}</span>
              </div>
            </li>
            <li v-else-if="items.length && !hasMore && !loading && !loadingMore" class="pkg-footer">
              <NText depth="3" style="font-size: 11px">{{ t.marketEnd }}</NText>
            </li>
          </ul>
        </NSpin>
      </div>
      <div v-if="loadingMore" class="load-more-bar" aria-live="polite">
        <NSpin size="small" />
        <span>{{ t.marketLoadingMore }}</span>
      </div>
    </div>

    
    

    </div>
<template #footer>
      <NSpace justify="end">
        <NButton class="pi-interactive" @click="emit('close')">{{ t.close }}</NButton>
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

.list-wrap {
  position: relative;
  min-height: 280px;
  max-height: min(52vh, 480px);
}

.list-spin {
  height: 100%;
  max-height: min(52vh, 480px);
  min-height: 280px;
  overflow: auto;
  overscroll-behavior: contain;
}

.load-more-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  pointer-events: none;
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--bg, #fff) 88%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--border, #ddd) 70%, transparent);
  backdrop-filter: blur(6px);
}

.load-more-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--fg-muted);
}

.empty {
  margin-top: 48px;
}

.pkg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.pkg-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elevated, #fff);
  box-shadow: var(--shadow-sm, none);
  transition:
    border-color var(--duration-fast, 140ms) var(--ease-out, ease),
    box-shadow var(--duration-fast, 140ms) var(--ease-out, ease),
    transform var(--duration-fast, 140ms) var(--ease-out, ease);
}

.pkg-row:hover {
  border-color: var(--accent-border, var(--border-strong));
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
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
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 2px;
}

.pkg-actions :deep(.n-button) {
  flex: 1 1 auto;
}

.pkg-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 4px 0 8px;
}
</style>
