<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NButton,
  NDropdown,
  NIcon,
  NImage,
  NSelect,
  NTooltip,
  NInput,
  useMessage,
} from "naive-ui";
import type { DropdownOption } from "naive-ui";
import {
  AddOutline,
  FlashOutline,
  LayersOutline,
  SendOutline,
  StopOutline,
} from "@vicons/ionicons5";
import CitationCard from "@renderer/components/CitationCard.vue";
import { useChatStore } from "@renderer/stores/chat";
import { isHttpUrl, useComposerStore } from "@renderer/stores/composer";
import { useSessionsStore } from "@renderer/stores/sessions";
import { t } from "@renderer/i18n";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type AttachedImage = {
  id: string;
  data: string;
  mimeType: string;
  previewUrl: string;
};

const chat = useChatStore();
const composer = useComposerStore();
const sessions = useSessionsStore();
const messageApi = useMessage();

type ModelSelectOption =
  | { type: "group"; label: string; key: string; children: { label: string; value: string }[] }
  | { label: string; value: string };

const availableModels = ref<ModelSelectOption[]>([]);
const selectedModelKey = ref<string | null>(null);
/** Last applied model key for the active session (`sessionId::provider/id`). */
const appliedModelForSession = ref<string | null>(null);
const thinkingLevel = ref<ThinkingLevel>("medium");
const attachedImages = ref<AttachedImage[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const thinkingOptions = [
  { label: "Off", value: "off" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "XHigh", value: "xhigh" },
];

const thinkingMenu = computed<DropdownOption[]>(() =>
  thinkingOptions.map((o) => ({
    label: o.label,
    key: o.value,
    props:
      o.value === thinkingLevel.value
        ? { style: "font-weight: 600; color: var(--accent)" }
        : undefined,
  })),
);

const thinkingLabel = computed(
  () => thinkingOptions.find((o) => o.value === thinkingLevel.value)?.label ?? "Medium",
);

const sessionId = computed(() => sessions.activeId);
const running = computed(() => chat.activeRunning || activeSessionRunning());

function activeSessionRunning(): boolean {
  const id = sessions.activeId;
  if (!id) return false;
  return sessions.sessions.find((s) => s.id === id)?.status === "running";
}

const canSend = computed(
  () =>
    Boolean(
      sessionId.value &&
        (composer.draft.trim() || attachedImages.value.length || composer.chips.length),
    ),
);

function revokeAllImages(): void {
  for (const img of attachedImages.value) {
    if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
  }
  attachedImages.value = [];
}

async function readImageFile(file: File): Promise<AttachedImage | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > 8 * 1024 * 1024) {
    messageApi.warning(t.imageTooLarge);
    return null;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(",")[1] ?? "";
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    data: base64,
    mimeType: file.type || "image/png",
    previewUrl: URL.createObjectURL(file),
  };
}

function electronFilePath(file: File): string | null {
  const p = (file as File & { path?: string }).path;
  if (typeof p === "string" && p.trim()) return p.trim();
  return null;
}

function fileUrlToPath(uri: string): string | null {
  const raw = uri.trim();
  if (!raw) return null;
  try {
    if (/^file:\/\//i.test(raw)) {
      const u = new URL(raw);
      let p = decodeURIComponent(u.pathname);
      if (/^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1).replace(/\//g, "\\");
      }
      return p;
    }
  } catch {
    // fall through
  }
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) {
    return raw;
  }
  return null;
}

async function addFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  for (const file of list) {
    if (file.type.startsWith("image/")) {
      const img = await readImageFile(file);
      if (img) attachedImages.value.push(img);
      continue;
    }
    const filePath = electronFilePath(file);
    if (filePath) composer.addFileTag(filePath);
  }
}

function removeImage(id: string): void {
  const idx = attachedImages.value.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const [img] = attachedImages.value.splice(idx, 1);
  if (img?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
}

async function submit(mode: "prompt" | "steer" | "follow_up"): Promise<void> {
  const id = sessionId.value;
  const chipText = composer.formatChipsForMessage();
  const text = [composer.draft.trim(), chipText].filter(Boolean).join("\n\n");
  if (!id || (!text && !attachedImages.value.length && !composer.chips.length)) return;
  const citations = composer.elementCitations();
  const citationList = citations.length ? citations : undefined;
  const images = [
    ...attachedImages.value.map((i) => ({
      type: "image" as const,
      data: i.data,
      mimeType: i.mimeType,
    })),
    ...(citationList ?? [])
      .filter((c) => c.screenshotDataUrl?.startsWith("data:"))
      .map((c) => {
        const match = /^data:([^;]+);base64,(.+)$/.exec(c.screenshotDataUrl!);
        return {
          type: "image" as const,
          data: match?.[2] ?? "",
          mimeType: match?.[1] ?? "image/png",
        };
      })
      .filter((i) => i.data),
  ];
  composer.draft = "";
  composer.clear();
  revokeAllImages();
  if (mode === "prompt") await chat.sendPrompt(id, text || " ", citationList, images);
  else if (mode === "steer") await chat.steer(id, text || " ");
  else await chat.followUp(id, text || " ");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing || event.shiftKey) return;
  event.preventDefault();
  if (running.value) {
    void submit(event.altKey ? "follow_up" : "steer");
    return;
  }
  void submit("prompt");
}

async function onAbort(): Promise<void> {
  if (sessionId.value) await chat.abort(sessionId.value);
}

async function onCompact(): Promise<void> {
  const id = sessionId.value;
  if (!id) return;
  await sessions.sendCommand(id, { type: "compact" });
  messageApi.success("????????");
}

async function onThinkingChange(value: string | number): Promise<void> {
  const id = sessionId.value;
  const level = String(value) as ThinkingLevel;
  thinkingLevel.value = level;
  if (!id) return;
  await sessions.sendCommand(id, { type: "set_thinking_level", level });
}

async function refreshModels(): Promise<void> {
  try {
    const data = await window.api.models.get();
    const byProvider = new Map<string, { label: string; value: string }[]>();
    for (const m of data.available) {
      const list = byProvider.get(m.provider) ?? [];
      const label = (m.name && m.name.trim()) || m.id;
      list.push({ label, value: `${m.provider}/${m.id}` });
      byProvider.set(m.provider, list);
    }
    const groups: ModelSelectOption[] = [...byProvider.entries()].map(([provider, children]) => ({
      type: "group",
      label: provider,
      key: provider,
      children,
    }));
    availableModels.value = groups;

    const flat = groups.flatMap((g) => ("children" in g ? g.children : [g]));
    const stillValid =
      selectedModelKey.value && flat.some((o) => o.value === selectedModelKey.value);
    if (!stillValid) {
      selectedModelKey.value = flat[0]?.value ?? null;
    }
    await applySelectedModel();
  } catch {
    availableModels.value = [];
  }
}

async function applySelectedModel(): Promise<void> {
  const id = sessionId.value;
  const value = selectedModelKey.value;
  if (!id || !value) return;
  const slash = value.indexOf("/");
  if (slash <= 0) return;
  const token = `${id}::${value}`;
  if (appliedModelForSession.value === token) return;
  try {
    await sessions.sendCommand(id, {
      type: "set_model",
      provider: value.slice(0, slash),
      modelId: value.slice(slash + 1),
    });
    appliedModelForSession.value = token;
  } catch (err) {
    appliedModelForSession.value = null;
    messageApi.error(err instanceof Error ? err.message : String(err));
  }
}

async function onModelChange(value: string | null): Promise<void> {
  selectedModelKey.value = value;
  appliedModelForSession.value = null;
  await applySelectedModel();
}

function onPaste(event: ClipboardEvent): void {
  const data = event.clipboardData;
  if (!data) return;

  const imageFiles: File[] = [];
  const pathFiles: File[] = [];

  if (data.files?.length) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith("image/")) imageFiles.push(file);
      else pathFiles.push(file);
    }
  }

  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (!file) continue;
        if (file.type.startsWith("image/") || item.type.startsWith("image/")) {
          if (!imageFiles.some((f) => f.name === file.name && f.size === file.size)) {
            imageFiles.push(file);
          }
        } else if (!pathFiles.some((f) => f.name === file.name && f.size === file.size)) {
          pathFiles.push(file);
        }
      }
    }
  }

  if (imageFiles.length || pathFiles.length) {
    event.preventDefault();
    if (imageFiles.length) void addFiles(imageFiles);
    for (const file of pathFiles) {
      const filePath = electronFilePath(file);
      if (filePath) composer.addFileTag(filePath);
    }
    return;
  }

  const uriList = data.getData("text/uri-list")?.trim() ?? "";
  if (uriList) {
    const paths: string[] = [];
    let hasHttp = false;
    for (const line of uriList.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (/^https?:\/\//i.test(trimmed)) {
        hasHttp = true;
        composer.addUrlTag(trimmed);
        continue;
      }
      const filePath = fileUrlToPath(trimmed);
      if (filePath) paths.push(filePath);
    }
    if (paths.length || hasHttp) {
      event.preventDefault();
      for (const filePath of paths) composer.addFileTag(filePath);
      return;
    }
  }

  const text = data.getData("text/plain")?.trim() ?? "";
  if (text && isHttpUrl(text)) {
    event.preventDefault();
    composer.addUrlTag(text);
    return;
  }

  if (text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const asPaths = lines.map(fileUrlToPath).filter((p): p is string => Boolean(p));
    if (asPaths.length && asPaths.length === lines.length) {
      event.preventDefault();
      for (const filePath of asPaths) composer.addFileTag(filePath);
    }
  }
}

function onPrimaryAction(): void {
  if (running.value) {
    void onAbort();
    return;
  }
  void submit("prompt");
}

onMounted(() => {
  void refreshModels();
  window.addEventListener("pi-models-changed", onModelsChanged);
});

onUnmounted(() => {
  window.removeEventListener("pi-models-changed", onModelsChanged);
});

function onModelsChanged(): void {
  void refreshModels();
}

watch(sessionId, () => {
  appliedModelForSession.value = null;
  void refreshModels();
});
</script>

<template>
  <div class="composer-wrap">
    <div class="composer-card" @paste="onPaste">
      <div v-if="composer.chips.length || attachedImages.length" class="chips">
        <CitationCard
          v-for="chip in composer.chips"
          :key="chip.id"
          :chip="chip"
          @remove="composer.removeChip(chip.id)"
        />
        <div v-for="img in attachedImages" :key="img.id" class="img-chip">
          <NImage :src="img.previewUrl" width="40" height="40" object-fit="cover" />
          <button type="button" class="img-x" @click="removeImage(img.id)">?</button>
        </div>
      </div>

      <NInput
        v-model:value="composer.draft"
        type="textarea"
        :placeholder="t.composerPlaceholder"
        :autosize="{ minRows: 1, maxRows: 8 }"
        :bordered="false"
        @keydown="onKeydown"
      />

      <div class="toolbar">
        <div class="toolbar-left">
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            hidden
            @change="(e) => {
              const input = e.target as HTMLInputElement;
              if (input.files) void addFiles(input.files);
              input.value = '';
            }"
          />
          <NTooltip>
            <template #trigger>
              <NButton quaternary circle size="tiny" @click="fileInput?.click()">
                <template #icon>
                  <NIcon :component="AddOutline" />
                </template>
              </NButton>
            </template>
            {{ t.addImage }}
          </NTooltip>

          <NSelect
            v-model:value="selectedModelKey"
            class="model-select"
            :options="availableModels"
            size="tiny"
            :consistent-menu-width="false"
            filterable
            :placeholder="t.modelPlaceholder"
            @update:value="onModelChange"
          />

          <NDropdown
            trigger="click"
            :options="thinkingMenu"
            @select="onThinkingChange"
          >
            <NTooltip>
              <template #trigger>
                <NButton quaternary size="tiny" class="think-btn">
                  <template #icon>
                    <NIcon :component="FlashOutline" :size="14" />
                  </template>
                  <span class="think-label">{{ thinkingLabel }}</span>
                </NButton>
              </template>
              {{ t.thinkingLevel }}
            </NTooltip>
          </NDropdown>

          <NTooltip>
            <template #trigger>
              <NButton quaternary circle size="tiny" @click="onCompact">
                <template #icon>
                  <NIcon :component="LayersOutline" />
                </template>
              </NButton>
            </template>
            {{ t.compactContext }}
          </NTooltip>
        </div>

        <div class="toolbar-right">
          <NTooltip>
            <template #trigger>
              <NButton
                size="tiny"
                circle
                :type="running ? 'error' : 'primary'"
                :disabled="!running && !canSend"
                @click="onPrimaryAction"
              >
                <template #icon>
                  <NIcon :component="running ? StopOutline : SendOutline" />
                </template>
              </NButton>
            </template>
            {{ running ? `${t.stop}?${t.runningHint}?` : t.enterToSend }}
          </NTooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  flex-shrink: 0;
  padding: 0 var(--chat-pad-x, 10px) 8px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
}

.composer-card {
  width: 100%;
  max-width: none;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  padding: 4px 6px 4px;
  min-width: 0;
  box-sizing: border-box;
}

.chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding: 2px 2px 6px;
}

.img-chip {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.img-x {
  position: absolute;
  top: 0;
  right: 0;
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  font-size: 10px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding-top: 2px;
  min-width: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.toolbar-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.model-select {
  flex: 1 1 auto;
  min-width: 56px;
  max-width: 140px;
}

.model-select :deep(.n-base-selection) {
  --n-padding-single: 0 22px 0 6px;
}

.think-btn {
  flex-shrink: 0;
  max-width: 72px;
  padding: 0 4px !important;
}

.think-label {
  display: inline-block;
  max-width: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  margin-left: 1px;
}

/* Compact when chat column is narrow */
.composer-card :deep(.n-input) {
  font-size: 13px;
}

.composer-card :deep(.n-input__textarea-el) {
  min-height: 20px !important;
}

@media (max-width: 900px) {
  .model-select {
    max-width: 100px;
  }

  .think-label {
    display: none;
  }
}
</style>
