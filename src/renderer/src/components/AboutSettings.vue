<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { NModal, NText, NButton, NSpace } from "naive-ui";
import { useUpdateStore } from "@renderer/stores/update";
import { t } from "@renderer/i18n";

type AppInfo = {
  version: string;
  githubUrl: string;
  releasesUrl: string;
  author: string;
  qq: string;
  email: string;
};

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const updateStore = useUpdateStore();
const appInfo = ref<AppInfo | null>(null);

async function refreshAppInfo(): Promise<void> {
  appInfo.value = await window.api.update.getAppInfo();
}

async function onOpenGithub(): Promise<void> {
  await window.api.update.openGithub();
}

async function onOpenReleases(): Promise<void> {
  await window.api.update.openReleases();
}

async function onOpenEmail(): Promise<void> {
  await window.api.update.openAuthorEmail();
}

async function onCheckUpdate(): Promise<void> {
  emit("close");
  await updateStore.openUpdateCard();
}

watch(
  () => props.open,
  (open) => {
    if (open) void refreshAppInfo();
  },
);

onMounted(() => {
  void refreshAppInfo();
});
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(420px, 92vw)"
    :title="t.aboutTitle"
    :bordered="false"
    size="huge"
    @update:show="(v) =>
    
 !v && emit('close')"
  >
    <div class="modal-scroll">

    <div class="section">
      <NText strong style="font-size: 16px">{{ t.appName }}</NText>
      <div v-if="appInfo" class="about-block">
        <div class="about-row">
          <span>{{ t.aboutVersion }}</span>
          <span>v{{ appInfo.version }}</span>
        </div>
        <div class="about-row">
          <span>{{ t.aboutAuthor }}</span>
          <span>{{ appInfo.author }}</span>
        </div>
        <div class="about-row">
          <span>{{ t.aboutQq }}</span>
          <span>{{ appInfo.qq }}</span>
        </div>
        <div class="about-row">
          <span>{{ t.aboutEmail }}</span>
          <button type="button" class="email-link" @click="onOpenEmail">
            {{ appInfo.email }}
          </button>
        </div>
      </div>
      <NSpace style="margin-top: 14px" :size="8">
        <NButton size="small" type="primary" @click="onCheckUpdate">
          {{ t.checkUpdate }}
          <span v-if="updateStore.available" class="about-dot" />
        </NButton>
        <NButton size="small" @click="onOpenGithub">{{ t.aboutOpenGithub }}</NButton>
        <NButton size="small" @click="onOpenReleases">{{ t.aboutOpenReleases }}</NButton>
      </NSpace>
    </div>

    
    

    </div>
<template #footer>
      <div class="footer">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
}
.about-block {
  margin-top: 12px;
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
.email-link {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--fg-strong);
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.email-link:hover {
  opacity: 0.85;
}
.footer {
  display: flex;
  justify-content: flex-end;
}
.about-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: #e5484d;
  vertical-align: middle;
}
</style>
