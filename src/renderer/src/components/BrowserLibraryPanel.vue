<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NEmpty, NIcon, NInput, NScrollbar } from "naive-ui";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  EarthOutline,
  SearchOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import {
  filterEntries,
  groupHistoryByRecency,
  type BookmarkEntry,
  type BrowserLibraryEntry,
  type HistoryGroupKey,
} from "@renderer/stores/browser-library";

const props = defineProps<{
  mode: "history" | "bookmarks";
  history: BrowserLibraryEntry[];
  bookmarks: BookmarkEntry[];
}>();

const emit = defineEmits<{
  navigate: [url: string];
  removeHistory: [id: string];
  removeBookmark: [id: string];
}>();

const query = ref("");
const collapsed = ref<Record<HistoryGroupKey, boolean>>({
  today: false,
  week: false,
  older: false,
});

const filteredHistory = computed(() => filterEntries(props.history, query.value));
const filteredBookmarks = computed(() => filterEntries(props.bookmarks, query.value));
const historyGroups = computed(() => groupHistoryByRecency(filteredHistory.value));

function toggleGroup(key: HistoryGroupKey): void {
  collapsed.value[key] = !collapsed.value[key];
}

function onOpen(url: string): void {
  emit("navigate", url);
}

function faviconSrc(entry: { favicon?: string }): string | null {
  return entry.favicon && entry.favicon.startsWith("http") ? entry.favicon : null;
}
</script>

<template>
  <div class="library-panel">
    <div class="search-wrap">
      <NInput v-model:value="query" size="small" clearable placeholder="搜索" round>
        <template #prefix>
          <NIcon :component="SearchOutline" :size="16" />
        </template>
      </NInput>
    </div>

    <NScrollbar class="list-scroll">
      <template v-if="mode === 'history'">
        <NEmpty
          v-if="!historyGroups.length"
          description="暂无历史记录"
          style="padding: 40px 16px"
        />
        <div v-for="group in historyGroups" :key="group.key" class="group">
          <button type="button" class="group-head" @click="toggleGroup(group.key)">
            <NIcon
              :component="collapsed[group.key] ? ChevronForwardOutline : ChevronDownOutline"
              :size="14"
            />
            <span>{{ group.label }}</span>
          </button>
          <div v-show="!collapsed[group.key]" class="group-body">
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="row"
              @click="onOpen(item.url)"
            >
              <img v-if="faviconSrc(item)" class="fav" :src="faviconSrc(item)!" alt="" />
              <NIcon v-else class="fav-fallback" :component="EarthOutline" :size="16" />
              <span class="label">{{ item.title || item.url }}</span>
              <NButton
                class="row-action"
                quaternary
                circle
                size="tiny"
                @click.stop="emit('removeHistory', item.id)"
              >
                <template #icon>
                  <NIcon :component="TrashOutline" :size="14" />
                </template>
              </NButton>
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <NEmpty
          v-if="!filteredBookmarks.length"
          description="暂无收藏"
          style="padding: 40px 16px"
        />
        <button
          v-for="item in filteredBookmarks"
          :key="item.id"
          type="button"
          class="row"
          @click="onOpen(item.url)"
        >
          <img v-if="faviconSrc(item)" class="fav" :src="faviconSrc(item)!" alt="" />
          <NIcon v-else class="fav-fallback" :component="EarthOutline" :size="16" />
          <span class="label">{{ item.title || item.url }}</span>
          <NButton
            class="row-action"
            quaternary
            circle
            size="tiny"
            @click.stop="emit('removeBookmark', item.id)"
          >
            <template #icon>
              <NIcon :component="TrashOutline" :size="14" />
            </template>
          </NButton>
        </button>
      </template>
    </NScrollbar>
  </div>
</template>

<style scoped>
.library-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.search-wrap {
  padding: 10px 12px 8px;
  flex-shrink: 0;
}

.list-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 8px 12px;
}

.group {
  margin-bottom: 6px;
}

.group-head {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 6px;
}

.group-head:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--fg);
  font-size: 13px;
}

.row:hover {
  background: var(--bg-hover);
}

.fav {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  flex-shrink: 0;
  object-fit: contain;
}

.fav-fallback {
  flex-shrink: 0;
  color: var(--fg-faint);
}

.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-action {
  opacity: 0;
  flex-shrink: 0;
  color: var(--fg-muted) !important;
}

.row:hover .row-action {
  opacity: 1;
}
</style>
