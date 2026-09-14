<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NModal,
  NRadioGroup,
  NRadioButton,
  NSelect,
  NSpace,
  NText,
  NButton,
  NDivider,
  NSwitch,
  useMessage,
} from "naive-ui";
import {
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import { t } from "@renderer/i18n";
import {
  markLocaleReloading,
  showLocaleReloadSplash,
} from "@renderer/utils/locale-reload-splash";
import {
  RESPONSE_LANGUAGE_AUTO,
  type ResponseLanguageState,
} from "../../../shared/response-language";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const appearance = useAppearanceStore();
const message = useMessage();

/**
 * Answer language. Independent of the UI language above: the interface can stay
 * English while Pi answers in Chinese. `auto` follows the device language, which
 * is resolved in the main process (it receives `navigator.language` on save).
 */
const answerLanguage = ref<ResponseLanguageState | null>(null);
const savingLanguage = ref(false);

const answerOptions = computed(() => {
  const state = answerLanguage.value;
  if (!state) return [];
  const effective = state.effective;
  return state.options.map((o) =>
    o.value === RESPONSE_LANGUAGE_AUTO
      ? { value: o.value, label: `${t.answerLanguageAuto}（${effective || "?"}）` }
      : { value: o.value, label: o.label },
  );
});

const answerValue = computed({
  get: () => answerLanguage.value?.settings.language ?? RESPONSE_LANGUAGE_AUTO,
  set: (value: string) => void saveAnswerLanguage(value),
});

async function saveAnswerLanguage(language: string): Promise<void> {
  savingLanguage.value = true;
  try {
    answerLanguage.value = await window.api.responseLanguage.set(
      { language },
      navigator.language,
    );
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingLanguage.value = false;
  }
}

onMounted(async () => {
  try {
    // Report the device language on load so `auto` resolves correctly even before
    // the user ever touches this setting.
    answerLanguage.value = await window.api.responseLanguage.set(
      (await window.api.responseLanguage.get()).settings,
      navigator.language,
    );
  } catch {
    answerLanguage.value = null;
  }
});

const showCompactButton = computed({
  get: () => appearance.showCompactButton,
  set: (v: boolean) => appearance.setShowCompactButton(v),
});

const truncateToolOutput = computed({
  get: () => appearance.truncateToolOutput,
  set: (v: boolean) => appearance.setTruncateToolOutput(v),
});

const themeValue = computed({
  get: () => appearance.themePreference,
  set: (v: ThemePreference) => appearance.setThemePreference(v),
});

function onLocaleUpdate(v: string | number | null): void {
  if (v !== "system" && v !== "zh-CN" && v !== "en") return;
  if (v === appearance.localePreference) return;
  appearance.setLocalePreference(v as LocalePreference);
  markLocaleReloading(v);
  // Paint overlay in the outgoing page so reload never shows a blank window.
  showLocaleReloadSplash(v);
  window.setTimeout(() => {
    window.location.reload();
  }, 40);
}
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(520px, 92vw)"
    :title="t.appearance"
    :bordered="false"
    size="huge"
    @update:show="(v) =>
    
 !v && emit('close')"
  >
    <div class="modal-scroll">

    <div class="section">
      <NText strong>{{ t.theme }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.themeHint }}
      </NText>
      <NRadioGroup v-model:value="themeValue" size="small">
        <NSpace>
          <NRadioButton value="system">{{ t.themeSystem }}</NRadioButton>
          <NRadioButton value="light">{{ t.themeLight }}</NRadioButton>
          <NRadioButton value="dark">{{ t.themeDark }}</NRadioButton>
        </NSpace>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <NText strong>{{ t.language }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.languageHint }}
      </NText>
      <NRadioGroup
        :value="appearance.localePreference"
        size="small"
        @update:value="onLocaleUpdate"
      >
        <NSpace>
          <NRadioButton value="system">{{ t.themeSystem }}</NRadioButton>
          <NRadioButton value="zh-CN">中文</NRadioButton>
          <NRadioButton value="en">English</NRadioButton>
        </NSpace>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <NText strong>{{ t.answerLanguage }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.answerLanguageHint }}
      </NText>
      <NSelect
        v-model:value="answerValue"
        size="small"
        :options="answerOptions"
        :loading="savingLanguage"
        :consistent-menu-width="false"
        style="max-width: 260px"
      />
      <NText
        v-if="answerLanguage && answerValue !== RESPONSE_LANGUAGE_AUTO"
        depth="3"
        style="font-size: 11.5px; display: block; margin-top: 6px"
      >
        {{ t.answerLanguageApplies }}
      </NText>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <div class="row">
        <div class="labels">
          <NText strong>{{ t.showCompactButton }}</NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ t.showCompactButtonHint }}
          </NText>
        </div>
        <NSwitch v-model:value="showCompactButton" />
      </div>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <div class="row">
        <div class="labels">
          <NText strong>{{ t.truncateToolOutput }}</NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ t.truncateToolOutputHint }}
          </NText>
        </div>
        <NSwitch v-model:value="truncateToolOutput" />
      </div>
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
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.labels {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
