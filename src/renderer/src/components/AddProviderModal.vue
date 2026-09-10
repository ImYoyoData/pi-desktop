<script setup lang="ts">
/**
 * Platform picker for "Add provider".
 *
 * Rendered through a Teleport into `body` with a z-index above the settings
 * modal, so it never gets clipped or stacked behind the dialog that opened it.
 */
import { computed, nextTick, ref, watch } from "vue";
import { NButton, NInput, NScrollbar } from "naive-ui";
import type { ProviderPlatform, ProviderPlatformCategory } from "../../../shared/provider-catalog";
import ProviderIcon from "@renderer/components/ProviderIcon.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{
  show: boolean;
  platforms: ProviderPlatform[];
}>();

const emit = defineEmits<{
  close: [];
  pick: [platform: ProviderPlatform];
  openDocs: [url: string];
}>();

const CATEGORY_ORDER: ProviderPlatformCategory[] = [
  "featured",
  "china",
  "global",
  "local",
  "generic",
];

const CATEGORY_LABEL: Record<ProviderPlatformCategory, () => string> = {
  featured: () => t.modelsGroupFeatured,
  china: () => t.modelsGroupChina,
  global: () => t.modelsGroupGlobal,
  local: () => t.modelsGroupLocal,
  generic: () => t.modelsGroupGeneric,
};

const CATEGORY_HINT: Partial<Record<ProviderPlatformCategory, string>> = {
  local: "localhost",
};

const query = ref("");
const searchRef = ref<InstanceType<typeof NInput> | null>(null);

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    query.value = "";
    void nextTick(() => {
      const el = (searchRef.value as unknown as { focus?: () => void } | null)?.focus;
      el?.call(searchRef.value);
    });
  },
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.platforms;
  return props.platforms.filter(
    (p) =>
      p.label.toLowerCase().includes(q) ||
      p.providerId.toLowerCase().includes(q) ||
      p.hint.toLowerCase().includes(q),
  );
});

const groups = computed(() =>
  CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABEL[category](),
    hint: CATEGORY_HINT[category] ?? "",
    items: filtered.value.filter((p) => p.category === category),
  })).filter((g) => g.items.length > 0),
);

function badgeOf(platform: ProviderPlatform): string | null {
  if (platform.configured) return t.modelsPlatformConfigured;
  if (platform.oauth) return t.modelsPlatformOauth;
  if (platform.kind === "custom" && platform.category === "generic") {
    return t.modelsPlatformCompat;
  }
  return null;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="pi-fade">
      <div
        v-if="show"
        class="platform-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t.modelsPickerTitle"
        @click.self="emit('close')"
        @keydown.esc="emit('close')"
      >
        <div class="platform-panel">
          <header class="panel-head">
            <div class="head-text">
              <h2 class="panel-title">{{ t.modelsPickerTitle }}</h2>
              <p class="panel-sub">{{ t.modelsPickerSubtitle }}</p>
            </div>
            <div class="head-actions">
              <NInput
                ref="searchRef"
                v-model:value="query"
                size="small"
                clearable
                class="search"
                :placeholder="t.modelsSearchPlatform"
              />
              <NButton size="small" quaternary class="pi-interactive" @click="emit('close')">
                {{ t.close }}
              </NButton>
            </div>
          </header>

          <NScrollbar class="panel-scroll">
            <section v-for="group in groups" :key="group.category" class="platform-group">
              <div class="group-head">
                <span class="group-title">{{ group.label }}</span>
                <span class="group-count">{{ group.items.length }}</span>
                <span v-if="group.hint" class="group-hint">{{ group.hint }}</span>
              </div>
              <div class="platform-grid">
                <button
                  v-for="p in group.items"
                  :key="p.key"
                  type="button"
                  class="platform-card pi-interactive"
                  :class="{ configured: p.configured }"
                  @click="emit('pick', p)"
                >
                  <ProviderIcon :provider="p.iconId" :size="34" />
                  <span class="card-body">
                    <span class="card-title">
                      <span class="card-label">{{ p.label }}</span>
                      <span v-if="badgeOf(p)" class="card-badge">{{ badgeOf(p) }}</span>
                    </span>
                    <span class="card-hint">{{ p.hint || t.modelsPlatformBuiltin }}</span>
                  </span>
                  <span
                    v-if="p.docsUrl"
                    class="card-docs"
                    role="link"
                    tabindex="0"
                    :title="t.modelsPlatformOpenDocs"
                    @click.stop="emit('openDocs', p.docsUrl)"
                    @keydown.enter.stop="emit('openDocs', p.docsUrl)"
                  >
                    ↗
                  </span>
                </button>
              </div>
            </section>

            <div v-if="!groups.length" class="platform-empty">{{ t.modelsPlatformEmpty }}</div>
          </NScrollbar>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.platform-overlay {
  position: fixed;
  inset: 0;
  z-index: 4200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(9, 9, 11, 0.44);
  backdrop-filter: blur(3px);
}

.platform-panel {
  width: min(940px, 94vw);
  height: min(660px, 82vh);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg));
  box-shadow: var(--shadow-lg, 0 24px 70px rgba(0, 0, 0, 0.32));
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-panel) 78%, transparent),
    transparent
  );
}

.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 680;
  letter-spacing: -0.01em;
  color: var(--fg-strong);
}

.panel-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--fg-faint);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.search {
  width: 232px;
}

.panel-scroll {
  flex: 1;
  min-height: 0;
}

.platform-group {
  padding: 14px 22px 4px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.group-title {
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.group-count {
  font-size: 10.5px;
  color: var(--fg-faint);
  background: var(--bg-hover);
  border-radius: 20px;
  padding: 1px 7px;
}

.group-hint {
  font-size: 10.5px;
  color: var(--fg-faint);
  font-family: var(--font-mono);
}

.platform-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: 8px;
}

.platform-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-panel);
  text-align: left;
  cursor: pointer;
  color: var(--fg);
  font: inherit;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.platform-card:hover {
  border-color: var(--accent-border, var(--accent));
  background: var(--bg-elevated, var(--bg));
  box-shadow: var(--shadow-sm);
}

.platform-card.configured {
  background: color-mix(in srgb, var(--bg-panel) 55%, transparent);
}

.card-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.card-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 20px;
  color: var(--accent);
  background: var(--accent-soft);
}

.card-hint {
  font-size: 11px;
  color: var(--fg-faint);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-docs {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--fg-faint);
  font-size: 12px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.platform-card:hover .card-docs {
  opacity: 1;
}

.card-docs:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.platform-empty {
  padding: 40px 20px;
  text-align: center;
  font-size: 12.5px;
  color: var(--fg-faint);
}

.pi-fade-enter-active,
.pi-fade-leave-active {
  transition: opacity 120ms var(--ease-out, ease);
}

.pi-fade-enter-from,
.pi-fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .panel-head {
    flex-direction: column;
  }

  .search {
    width: 100%;
  }

  .platform-grid {
    grid-template-columns: 1fr;
  }
}
</style>
