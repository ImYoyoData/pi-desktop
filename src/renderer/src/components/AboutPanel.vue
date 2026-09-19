<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton, NModal, NText } from "naive-ui";
import { t } from "@renderer/i18n";
import { CONTRIBUTORS, type Contributor } from "../../../shared/contributors";

type AppInfo = {
  version: string;
  author: string;
  githubUrl: string;
};

const appInfo = ref<AppInfo | null>(null);
const avatars = ref<Record<string, string>>({});
const selected = ref<Contributor | null>(null);

/** 按提交数排名，网格与详情弹窗共用同一顺序。 */
const ranked = computed(() =>
  [...CONTRIBUTORS]
    .sort((a, b) => b.contributions - a.contributions)
    .map((contributor, index) => ({ contributor, rank: index + 1 })),
);

const selectedRank = computed(
  () =>
    ranked.value.find((item) => item.contributor.login === selected.value?.login)?.rank ??
    ranked.value.length,
);

function initialOf(contributor: Contributor): string {
  return (contributor.name.trim() || contributor.login).slice(0, 1).toUpperCase();
}

/** 无头像时的占位底色：按用户名散列到固定色相。 */
function fallbackColor(login: string): string {
  let hash = 0;
  for (const char of login) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 64% 46%)`;
}

async function refreshAppInfo(): Promise<void> {
  appInfo.value = await window.api.update.getAppInfo();
}

async function loadAvatars(): Promise<void> {
  const entries = await Promise.all(
    CONTRIBUTORS.map(async (contributor) => {
      const dataUrl = await window.api.contributors.avatar(contributor.avatarUrl);
      return dataUrl ? ([contributor.login, dataUrl] as const) : null;
    }),
  );
  avatars.value = Object.fromEntries(entries.filter((entry) => entry !== null));
}

function openRepository(): void {
  void window.api.browser.openExternal(appInfo.value?.githubUrl ?? "");
}

function openProfile(contributor: Contributor): void {
  void window.api.browser.openExternal(contributor.htmlUrl);
}

onMounted(() => {
  void refreshAppInfo();
  void loadAvatars();
});
</script>

<template>
  <div class="about-panel">
    <div class="about-head">
      <NText strong style="font-size: 16px">{{ t.appName }}</NText>
      <NText v-if="appInfo" depth="3">v{{ appInfo.version }}</NText>
    </div>

    <div class="about-block">
      <div class="about-row">
        <span>{{ t.aboutAuthor }}</span>
        <span>{{ appInfo?.author ?? "—" }}</span>
      </div>
      <div class="about-row">
        <span>{{ t.aboutRepository }}</span>
        <button type="button" class="about-link" @click="openRepository">
          {{ t.aboutOpenRepository }}
        </button>
      </div>
    </div>

    <div class="about-section">
      <div class="about-section-title">{{ t.aboutContributors }}</div>
      <div class="contributor-grid">
        <button
          v-for="item in ranked"
          :key="item.contributor.login"
          type="button"
          class="contributor-item"
          @click="selected = item.contributor"
        >
          <img
            v-if="avatars[item.contributor.login]"
            class="contributor-avatar"
            :src="avatars[item.contributor.login]"
            :alt="item.contributor.name"
          />
          <span
            v-else
            class="contributor-avatar contributor-fallback"
            :style="{ background: fallbackColor(item.contributor.login) }"
            aria-hidden="true"
          >
            {{ initialOf(item.contributor) }}
          </span>
          <span class="contributor-login">{{ item.contributor.login }}</span>
        </button>
      </div>
    </div>

    <NModal
      :show="selected !== null"
      preset="card"
      class="pi-settings-modal"
      style="width: min(360px, 92vw)"
      :title="selected?.name ?? ''"
      :bordered="false"
      size="huge"
      @update:show="(value: boolean) => !value && (selected = null)"
    >
      <div v-if="selected" class="detail">
        <img
          v-if="avatars[selected.login]"
          class="detail-avatar"
          :src="avatars[selected.login]"
          :alt="selected.name"
        />
        <span
          v-else
          class="detail-avatar detail-fallback"
          :style="{ background: fallbackColor(selected.login) }"
          aria-hidden="true"
        >
          {{ initialOf(selected) }}
        </span>

        <div class="detail-login">
          <span>@{{ selected.login }}</span>
          <span v-if="selected.owner" class="detail-badge">{{ t.aboutContributorOwner }}</span>
        </div>

        <div class="detail-rows">
          <div class="detail-row">
            <span>{{ t.aboutContributorCommits(selected.contributions) }}</span>
            <span>{{ t.aboutContributorRank(selectedRank, ranked.length) }}</span>
          </div>
          <div class="detail-row">
            <span>{{ t.aboutContributorFirstCommit }}</span>
            <span>{{ selected.firstCommit }}</span>
          </div>
          <div class="detail-row">
            <span>{{ t.aboutContributorLatestCommit }}</span>
            <span>{{ selected.latestCommit }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="detail-footer">
          <NButton v-if="selected" size="small" @click="openProfile(selected)">
            {{ t.aboutContributorOpenProfile }}
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.about-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding-top: 8px;
  gap: 16px;
}

.about-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.about-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.about-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--fg-muted);
}

.about-row span:last-child {
  color: var(--fg-strong);
  font-variant-numeric: tabular-nums;
}

.about-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
}

.about-link:hover {
  text-decoration: underline;
}

.about-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-strong);
  margin-bottom: 12px;
}

.contributor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 12px 8px;
}

.contributor-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  border: none;
  border-radius: 8px;
  background: none;
  font: inherit;
  color: var(--fg-muted);
  cursor: pointer;
}

.contributor-item:hover {
  background: var(--bg-hover);
  color: var(--fg-strong);
}

.contributor-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
}

.contributor-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
}

.contributor-login {
  max-width: 100%;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.detail-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
}

.detail-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 26px;
  font-weight: 600;
}

.detail-login {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--fg-muted);
}

.detail-badge {
  padding: 1px 7px;
  border: 1px solid var(--accent-border);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
}

.detail-rows {
  width: 100%;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--fg-muted);
}

.detail-row span:last-child {
  color: var(--fg-strong);
  font-variant-numeric: tabular-nums;
}

.detail-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
