<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NButton,
  NDropdown,
  NIcon,
  NImage,
  NModal,
  NSelect,
  NTooltip,
  NInput,
  useMessage,
} from "naive-ui";
import type { DropdownOption } from "naive-ui";
import {
  AddOutline,
  FlashOutline,
  MicOutline,
  SendOutline,
  StopOutline,
} from "@vicons/ionicons5";
import CitationCard from "@renderer/components/CitationCard.vue";
import AsrInstallProgress from "@renderer/components/AsrInstallProgress.vue";
import { useChatStore } from "@renderer/stores/chat";
import { isHttpUrl, useComposerStore } from "@renderer/stores/composer";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAsrStore } from "@renderer/stores/asr";
import { heuristicSessionTitle } from "@renderer/utils/session-title";
import { startPcmCapture, type PcmCapture } from "@renderer/utils/pcm-capture";
import { t } from "@renderer/i18n";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const chat = useChatStore();
const composer = useComposerStore();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const asr = useAsrStore();
const messageApi = useMessage();
let capture: PcmCapture | null = null;
let offAsrProgress: (() => void) | undefined;

type ModelSelectOption =
  | { type: "group"; label: string; key: string; children: { label: string; value: string }[] }
  | { label: string; value: string };

const SESSION_PREFS_KEY = "pi-desktop:session-model-prefs";

type SessionPrefs = {
  models: Record<string, string>;
  thinking: Record<string, ThinkingLevel>;
};

function loadSessionPrefs(): SessionPrefs {
  try {
    const raw = localStorage.getItem(SESSION_PREFS_KEY);
    if (!raw) return { models: {}, thinking: {} };
    const parsed = JSON.parse(raw) as Partial<SessionPrefs>;
    return {
      models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
      thinking:
        parsed.thinking && typeof parsed.thinking === "object"
          ? (parsed.thinking as Record<string, ThinkingLevel>)
          : {},
    };
  } catch {
    return { models: {}, thinking: {} };
  }
}

const availableModels = ref<ModelSelectOption[]>([]);
const selectedModelKey = ref<string | null>(null);
/** Last applied model key for the active session (`sessionId::provider/id`). */
const appliedModelForSession = ref<string | null>(null);
/** Per-session remembered model (`provider/id`) and thinking level. */
const modelBySession = ref<Record<string, string>>(loadSessionPrefs().models);
const thinkingBySession = ref<Record<string, ThinkingLevel>>(loadSessionPrefs().thinking);
const thinkingLevel = ref<ThinkingLevel>("medium");
const fileInput = ref<HTMLInputElement | null>(null);
const draftInput = ref<{ focus?: () => void } | null>(null);

function focusDraft(): void {
  draftInput.value?.focus?.();
}

function persistSessionPrefs(): void {
  localStorage.setItem(
    SESSION_PREFS_KEY,
    JSON.stringify({
      models: modelBySession.value,
      thinking: thinkingBySession.value,
    }),
  );
}

function flatModelOptions(groups: ModelSelectOption[]): { label: string; value: string }[] {
  return groups.flatMap((g) => ("children" in g ? g.children : [g]));
}

function modelKeyFromState(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const model = (data as { model?: unknown }).model;
  if (!model || typeof model !== "object") return null;
  const m = model as { provider?: unknown; id?: unknown };
  if (typeof m.provider !== "string" || typeof m.id !== "string") return null;
  if (!m.provider || !m.id) return null;
  return `${m.provider}/${m.id}`;
}

function thinkingFromState(data: unknown): ThinkingLevel | null {
  if (!data || typeof data !== "object") return null;
  const level = (data as { thinkingLevel?: unknown }).thinkingLevel;
  if (typeof level !== "string") return null;
  const allowed: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
  return (allowed as string[]).includes(level) ? (level as ThinkingLevel) : null;
}

function rememberModel(sessionId: string, key: string): void {
  modelBySession.value = { ...modelBySession.value, [sessionId]: key };
  persistSessionPrefs();
}

function rememberThinking(sessionId: string, level: ThinkingLevel): void {
  thinkingBySession.value = { ...thinkingBySession.value, [sessionId]: level };
  persistSessionPrefs();
}

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
        (composer.draft.trim() || composer.images.length || composer.chips.length),
    ) && !running.value,
);

async function readImageFile(file: File): Promise<{
  data: string;
  mimeType: string;
  previewUrl: string;
} | null> {
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
      if (img) composer.addImageFile(img);
      continue;
    }
    const filePath = electronFilePath(file);
    if (filePath) composer.addFileTag(filePath);
  }
}

async function submit(mode: "prompt" | "steer" | "follow_up"): Promise<void> {
  const id = sessionId.value;
  const chipText = composer.formatChipsForMessage();
  const text = [composer.draft.trim(), chipText].filter(Boolean).join("\n\n");
  if (!id || (!text && !composer.images.length && !composer.chips.length)) return;
  const citations = composer.elementCitations();
  const citationList = citations.length ? citations : undefined;
  const elementTags = composer.elementTagSnapshot();
  // Screenshots are already in composer.images (as normal attachments). Deduplicate by data.
  const seen = new Set<string>();
  const imagesToSend = composer.images
    .filter((i) => {
      if (seen.has(i.data)) return false;
      seen.add(i.data);
      return true;
    })
    .map((i) => ({
      type: "image" as const,
      data: i.data,
      mimeType: i.mimeType || "image/png",
    }));
  const citationsToSend = citationList
    ? citationList.map((c) => ({
        url: c.url,
        selector: c.selector,
        text: c.text,
        htmlSnippet: c.htmlSnippet,
      }))
    : undefined;
  const tagsToSend = elementTags.length
    ? elementTags.map((t) => ({
        url: t.url,
        host: t.host,
        label: t.label,
        content: t.content,
      }))
    : undefined;
  // User-visible text: draft only (tags/images shown as chips). Agent still gets citations.
  const displayText = composer.draft.trim();
  const titleSeed = displayText || tagsToSend?.[0]?.content || tagsToSend?.[0]?.label || "";
  composer.clear();
  if (mode === "prompt") {
    // pi-web-style heuristic auto-title on first message when session has no custom name
    const root = workspace.root;
    const summary = sessions.sessions.find((s) => s.id === id);
    if (root && titleSeed && !summary?.name?.trim()) {
      const title = heuristicSessionTitle(titleSeed);
      if (title) void sessions.renameSession(id, root, title);
    }
    await chat.sendPrompt(
      id,
      displayText || (imagesToSend.length || tagsToSend?.length ? " " : text || " "),
      citationsToSend,
      imagesToSend,
      tagsToSend,
    );
  } else if (mode === "steer") await chat.steer(id, text || " ");
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
  try {
    await sessions.sendCommand(id, { type: "compact" });
    messageApi.success(t.compactDone);
  } catch (err) {
    messageApi.error(err instanceof Error ? err.message : String(err));
  }
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

const contextUsage = computed(() => sessions.activeContextUsage);

const contextLabel = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return null;
  const windowLabel = formatTokens(usage.contextWindow);
  const pct =
    usage.percent !== null && Number.isFinite(usage.percent)
      ? `${usage.percent.toFixed(1)}%`
      : "?";
  return `${pct}/${windowLabel}`;
});

const contextDetail = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return t.contextUsageEmpty;
  const windowLabel = formatTokens(usage.contextWindow);
  if (usage.tokens !== null) {
    return `${formatTokens(usage.tokens)} / ${windowLabel} ? ${
      usage.percent !== null ? `${usage.percent.toFixed(1)}%` : "?"
    }`;
  }
  return `? / ${windowLabel} ? ${t.contextUsageUnknown}`;
});

const contextTone = computed(() => {
  const pct = contextUsage.value?.percent;
  if (pct == null) return "muted";
  if (pct > 90) return "danger";
  if (pct > 70) return "warn";
  return "ok";
});

const contextBarWidth = computed(() => {
  const pct = contextUsage.value?.percent;
  if (pct == null) return 0;
  return Math.max(0, Math.min(100, pct));
});

async function onThinkingChange(value: string | number): Promise<void> {
  const id = sessionId.value;
  const level = String(value) as ThinkingLevel;
  thinkingLevel.value = level;
  if (!id) return;
  rememberThinking(id, level);
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
    await syncSessionModelAndThinking();
  } catch {
    availableModels.value = [];
  }
}

async function syncSessionModelAndThinking(): Promise<void> {
  const id = sessionId.value;
  const flat = flatModelOptions(availableModels.value);
  if (!id) {
    selectedModelKey.value = flat[0]?.value ?? null;
    return;
  }

  // Instant UI from per-session memory
  const remembered = modelBySession.value[id];
  if (remembered && flat.some((o) => o.value === remembered)) {
    selectedModelKey.value = remembered;
  }
  const rememberedThinking = thinkingBySession.value[id];
  if (rememberedThinking) {
    thinkingLevel.value = rememberedThinking;
  }

  // Prefer live worker state (source of truth for existing sessions)
  let workerKey: string | null = null;
  let workerThinking: ThinkingLevel | null = null;
  try {
    const state = await sessions.sendCommand(id, { type: "get_state" });
    workerKey = modelKeyFromState(state);
    workerThinking = thinkingFromState(state);
    sessions.applyContextFromState(id, state);
  } catch {
    // Worker may still be starting; fall back to remembered / default below.
  }

  if (workerKey && flat.some((o) => o.value === workerKey)) {
    selectedModelKey.value = workerKey;
    rememberModel(id, workerKey);
  } else if (remembered && flat.some((o) => o.value === remembered)) {
    selectedModelKey.value = remembered;
  } else if (!selectedModelKey.value || !flat.some((o) => o.value === selectedModelKey.value)) {
    selectedModelKey.value = flat[0]?.value ?? null;
  }

  if (workerThinking) {
    thinkingLevel.value = workerThinking;
    rememberThinking(id, workerThinking);
  } else if (rememberedThinking) {
    thinkingLevel.value = rememberedThinking;
  }

  // Ensure worker uses this session's remembered model (new sessions / cold workers)
  if (selectedModelKey.value) {
    const token = `${id}::${selectedModelKey.value}`;
    if (workerKey !== selectedModelKey.value || appliedModelForSession.value !== token) {
      appliedModelForSession.value = null;
      await applySelectedModel();
    } else {
      appliedModelForSession.value = token;
      rememberModel(id, selectedModelKey.value);
    }
  }

  if (rememberedThinking || thinkingLevel.value) {
    const level = thinkingLevel.value;
    if (workerThinking !== level) {
      try {
        await sessions.sendCommand(id, { type: "set_thinking_level", level });
        rememberThinking(id, level);
      } catch {
        // ignore thinking sync failures
      }
    }
  }
}

async function applySelectedModel(): Promise<void> {
  const id = sessionId.value;
  const value = selectedModelKey.value;
  if (!id || !value) return;
  // Session must be registered in the broker (present in live sessions list).
  if (!sessions.sessions.some((s) => s.id === id)) return;
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
    rememberModel(id, value);
  } catch (err) {
    appliedModelForSession.value = null;
    const text = err instanceof Error ? err.message : String(err);
    // Startup race / cold worker: don't toast unknown-session noise.
    if (/unknown session/i.test(text)) return;
    messageApi.error(text);
  }
}

async function onModelChange(value: string | null): Promise<void> {
  selectedModelKey.value = value;
  appliedModelForSession.value = null;
  const id = sessionId.value;
  if (id && value) rememberModel(id, value);
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

async function ensureAsrReady(): Promise<boolean> {
  await asr.refresh();
  if (!asr.status.supported) {
    messageApi.warning(t.asrUnsupported);
    return false;
  }
  if (!asr.status.enabled) {
    messageApi.warning(t.asrDisabled);
    return false;
  }
  if (asr.status.installed) return true;

  const ok = window.confirm(t.asrInstallConfirm(asr.status.diskMb, asr.status.ramMb));
  if (!ok) return false;
  try {
    await asr.install();
    messageApi.success(t.asrInstallOk);
    return true;
  } catch (err) {
    messageApi.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function onMicClick(): Promise<void> {
  if (asr.transcribing) return;

  if (asr.recording && capture) {
    asr.recording = false;
    asr.transcribing = true;
    try {
      const { pcmBase64, sampleRate } = await capture.stop();
      capture = null;
      if (pcmBase64.length < 100) {
        messageApi.warning(t.asrFail);
        return;
      }
      const text = await window.api.asr.transcribe(pcmBase64, sampleRate);
      const trimmed = text.trim();
      if (!trimmed) {
        messageApi.warning(t.asrFail);
        return;
      }
      composer.draft = composer.draft ? `${composer.draft.trimEnd()} ${trimmed}` : trimmed;
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : t.asrFail);
    } finally {
      asr.transcribing = false;
    }
    return;
  }

  const ready = await ensureAsrReady();
  if (!ready) return;

  try {
    capture = await startPcmCapture();
    asr.recording = true;
  } catch (err) {
    messageApi.error(err instanceof Error ? err.message : String(err));
    asr.recording = false;
    capture = null;
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
  void asr.refresh();
  offAsrProgress = asr.bindProgress();
  window.addEventListener("pi-models-changed", onModelsChanged);
});

onUnmounted(() => {
  window.removeEventListener("pi-models-changed", onModelsChanged);
  offAsrProgress?.();
  capture?.abort();
  capture = null;
  asr.recording = false;
  asr.transcribing = false;
});

function onModelsChanged(): void {
  void refreshModels();
}

watch(sessionId, (id, prev) => {
  if (prev && selectedModelKey.value) {
    rememberModel(prev, selectedModelKey.value);
  }
  if (prev) {
    rememberThinking(prev, thinkingLevel.value);
  }
  appliedModelForSession.value = null;
  // Restore remembered UI immediately before async sync
  if (id && modelBySession.value[id]) {
    selectedModelKey.value = modelBySession.value[id];
  }
  if (id && thinkingBySession.value[id]) {
    thinkingLevel.value = thinkingBySession.value[id];
  }
  void refreshModels();
});
</script>

<template>
  <div class="composer-wrap">
    <div class="composer-card">
      <!-- Images are separate attachments (sent as model images), not part of the rich text surface -->
      <div v-if="composer.images.length" class="image-attachments">
        <div v-for="img in composer.images" :key="img.id" class="img-chip">
          <NImage
            class="img-preview"
            :src="img.previewUrl"
            object-fit="cover"
            :preview-src="img.previewUrl"
          />
          <button type="button" class="img-x" title="remove" @click.stop="composer.removeImage(img.id)">
            x
          </button>
        </div>
      </div>

      <!-- Rich composer: only tags + textarea share one editor surface -->
      <div class="rich-editor" @paste="onPaste" @click="focusDraft">
        <div v-if="composer.chips.length" class="inline-chips">
          <CitationCard
            v-for="chip in composer.chips"
            :key="chip.id"
            :chip="chip"
            @remove="composer.removeChip(chip.id)"
          />
        </div>
        <NInput
          ref="draftInput"
          v-model:value="composer.draft"
          class="draft-input"
          type="textarea"
          :placeholder="t.composerPlaceholder"
          :autosize="{ minRows: 1, maxRows: 8 }"
          :bordered="false"
          @keydown="onKeydown"
        />
      </div>

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
              <button
                type="button"
                class="ctx-meter"
                :class="`ctx-${contextTone}`"
                :disabled="!sessionId"
                @click="onCompact"
              >
                <span class="ctx-bar" aria-hidden="true">
                  <span class="ctx-fill" :style="{ width: `${contextBarWidth}%` }" />
                </span>
                <span class="ctx-label">{{ contextLabel ?? "?/?" }}</span>
              </button>
            </template>
            <div class="ctx-tip">
              <div>{{ contextDetail }}</div>
              <div class="ctx-tip-action">{{ t.compactContext }}</div>
            </div>
          </NTooltip>
        </div>

        <div class="toolbar-right">
          <NTooltip v-if="asr.micVisible">
            <template #trigger>
              <button
                type="button"
                class="mic-btn"
                :class="{ recording: asr.recording, busy: asr.transcribing }"
                :disabled="asr.transcribing || asr.installing"
                :aria-label="t.voiceInput"
                @click="onMicClick"
              >
                <NIcon :component="MicOutline" :size="18" />
              </button>
            </template>
            {{
              asr.transcribing
                ? t.voiceTranscribing
                : asr.recording
                  ? t.voiceListening
                  : t.voiceInput
            }}
          </NTooltip>
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

    <NModal
      :show="asr.installing"
      preset="card"
      :title="t.asrInstalling"
      :bordered="false"
      :mask-closable="false"
      :closable="false"
      style="width: min(420px, 92vw)"
    >
      <AsrInstallProgress />
    </NModal>
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
  border-radius: 12px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
  padding: 4px 6px 4px;
  min-width: 0;
  box-sizing: border-box;
}

.image-attachments {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 6px 0;
  align-items: flex-start;
}

.rich-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 4px 2px 2px;
  cursor: text;
}

.inline-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  padding: 0 2px;
}

.draft-input {
  width: 100%;
}

.img-chip {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-strong, var(--border));
  background: var(--bg-panel);
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.img-preview {
  display: block;
  width: 100%;
  height: 100%;
}

.img-preview :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.img-x {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  font-size: 12px;
  padding: 0;
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
  gap: 6px;
  flex-shrink: 0;
}

.mic-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--fg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.mic-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg-strong);
}

.mic-btn.recording {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
  animation: mic-pulse 1.2s ease-in-out infinite;
}

.mic-btn.busy,
.mic-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

@keyframes mic-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
  }
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

.ctx-meter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  color: #5c5c5c;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.ctx-meter:disabled {
  opacity: 0.45;
  cursor: default;
}

.ctx-meter:not(:disabled):hover {
  background: rgba(0, 0, 0, 0.04);
}

.ctx-bar {
  width: 28px;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
  flex-shrink: 0;
}

.ctx-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: #5c5c5c;
  transition: width 0.2s ease;
}

.ctx-ok .ctx-fill {
  background: #5c5c5c;
}

.ctx-warn {
  color: #b45309;
  border-color: rgba(180, 83, 9, 0.35);
}

.ctx-warn .ctx-fill {
  background: #d97706;
}

.ctx-danger {
  color: #b91c1c;
  border-color: rgba(185, 28, 28, 0.35);
}

.ctx-danger .ctx-fill {
  background: #dc2626;
}

.ctx-muted .ctx-label {
  color: #8a8a8a;
}

.ctx-label {
  line-height: 1;
  white-space: nowrap;
}

.ctx-tip {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ctx-tip-action {
  opacity: 0.7;
  font-size: 11px;
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
