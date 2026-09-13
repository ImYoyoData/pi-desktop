<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";
import type { AgentEvent, SessionHistoryPage } from "../../src/shared/protocol";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";

/**
 * Login / chrome stay light; MessageList (desktop components) loads async after auth.
 */
const LanChatPane = defineAsyncComponent(() => import("./LanChatPane.vue"));
const chatStore = useChatStore();
const sessionsStore = useSessionsStore();

const T: Record<string, string> = {
  title: "Pi Desktop",
  subtitle: "远程控制",
  menu: "菜单",
  connecting: "连接中…",
  connectingTitle: "正在连接桌面端",
  connectingHint: "已登录，正在建立安全连接…",
  reconnectingHint: "连接已断开，正在重连…",
  backToLogin: "重新登录",
  workspaces: "工作区",
  emptyChat: "从左侧选择工作区和会话开始对话",
  placeholder: "输入消息，Enter 发送",
  send: "发送",
  notConnected: "未连接",
  connected: "已连接",
  disconnected: "已断开，重连中…",
  connErr: "连接错误",
  tokenInvalid: "会话已失效，请重新登录",
  error: "出错",
  pickWs: "请先选择工作区",
  pickSession: "请先选择会话",
  runErr: "执行出错",
  noWs: "暂无工作区",
  noSession: "暂无会话",
  you: "你",
  assistant: "助手",
  toolFail: "（失败）",
  err: "错误",
  thinking: "思考中",
  model: "模型",
  thinkLevel: "推理",
  loadingSessions: "加载会话…",
  loginTitle: "Pi Desktop",
  pin: "9 位数字访问密码",
  pinInvalid: "请输入 9 位数字密码",
  login: "登录",
  loginFail: "登录失败：",
  loginHint: "输入桌面端「远程控制」面板里显示的 9 位数字密码。",
  tool: "工具",
  newSession: "新会话",
  enterToSend: "Enter 发送",
};

// ---------- theme ----------
const dark = ref(
  window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches,
);
const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

// ---------- auth / ws ----------
const TOKEN_KEY = "piLanToken";
const token = ref(localStorage.getItem(TOKEN_KEY) || "");
const loginPin = ref("");
const loginMsg = ref("");
const loginBusy = ref(false);
const statusText = ref(T.connecting);
const statusOk = ref(false);
const statusErr = ref(false);
/** Gate the main shell until WS hello succeeds (and first workspace list lands). */
const wsReady = ref(false);
const connectPhase = ref<"idle" | "connecting" | "ready">("idle");

let ws: WebSocket | null = null;
let msgSeq = 0;
let reconnectTimer: number | undefined;
let keepaliveTimer: number | undefined;
/** Only reconcile finished turns from disk — never poll during streaming. */
let historyReconcileTimer: number | undefined;

const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const isMobile = ref(window.innerWidth <= 720);
const sideOpen = ref(false);
const sessionsLoadingRoot = ref<string | null>(null);
const SESSION_CACHE_KEY = "piLanSessionsCache";

function loadSessionCache(): Record<string, any[]> {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, any[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveSessionCache(): void {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(sessionsByRoot.value));
  } catch {
    /* ignore quota */
  }
}

window.addEventListener("resize", () => {
  isMobile.value = window.innerWidth <= 720;
  if (!isMobile.value) sideOpen.value = false;
});

// ---------- state ----------
const workspaces = ref<string[]>([]);
const sessionsByRoot = ref<Record<string, any[]>>(loadSessionCache());
const expandedRoot = ref<string | null>(null);
const currentRoot = ref<string | null>(null);
const currentSession = ref<string | null>(null);
const currentFilePath = ref<string | null>(null);
const models = ref<{ provider: string; id: string; name?: string }[]>([]);
const selectedModel = ref("");
const thinking = ref("medium");
/** Pi 思考级别：pi-ai ThinkingLevel + off（与 pi-coding-agent THINKING_LEVEL_OPTIONS 一致） */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const THINKING_LEVEL_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};
const modelGroups = computed(() => {
  const byProvider = new Map<string, { label: string; value: string }[]>();
  for (const m of models.value) {
    const list = byProvider.get(m.provider) ?? [];
    list.push({ label: (m.name && m.name.trim()) || m.id, value: `${m.provider}/${m.id}` });
    byProvider.set(m.provider, list);
  }
  return [...byProvider.entries()].map(([provider, options]) => ({ provider, options }));
});
const draft = ref("");
const hasSession = computed(() => Boolean(currentSession.value));
const chatEmpty = computed(() => {
  const id = currentSession.value;
  if (!id) return true;
  if (chatStore.historyLoadingId === id) return false;
  const s = chatStore.bySession[id];
  return !s || (!s.messages.length && !s.streamingMessage && !s.running);
});

// ---------- toast ----------
const toastText = ref("");
const toastVisible = ref(false);
let toastTimer: number | undefined;
function toast(text: string, ms = 2200): void {
  toastText.value = text;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastVisible.value = false), ms);
}

function send(payload: Record<string, unknown>): void {
  if (!ws || ws.readyState !== 1) {
    toast(T.notConnected);
    return;
  }
  payload.id = ++msgSeq;
  ws.send(JSON.stringify(payload));
}

function showLogin(): void {
  token.value = "";
  localStorage.removeItem(TOKEN_KEY);
  wsReady.value = false;
  connectPhase.value = "idle";
  statusOk.value = false;
  statusErr.value = false;
  statusText.value = T.connecting;
  clearTimeout(reconnectTimer);
  clearInterval(keepaliveTimer);
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
}

async function doLogin(): Promise<void> {
  if (loginBusy.value) return;
  const pin = loginPin.value.replace(/\D/gu, "");
  if (pin.length !== 9) {
    loginMsg.value = T.pinInvalid;
    return;
  }
  loginBusy.value = true;
  loginMsg.value = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      token.value = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      loginPin.value = "";
      connect();
    } else {
      loginMsg.value = T.loginFail + " " + (data.message || "");
    }
  } catch (err) {
    loginMsg.value = T.loginFail + " " + ((err as Error)?.message || String(err));
  } finally {
    loginBusy.value = false;
  }
}

function connect(): void {
  if (!token.value) return;
  connectPhase.value = "connecting";
  wsReady.value = false;
  statusText.value = T.connecting;
  statusOk.value = false;
  statusErr.value = false;
  // Drop prior socket without triggering reconnect storm.
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  ws = socket;
  socket.onopen = () => {
    if (ws !== socket || !token.value) return;
    statusText.value = T.connecting;
    statusOk.value = false;
    statusErr.value = false;
    // Auth handshake — main UI waits for helloOk (+ workspaces).
    send({ type: "hello", token: token.value });
    clearInterval(keepaliveTimer);
    keepaliveTimer = window.setInterval(() => send({ type: "ping" }), 25000);
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    clearInterval(keepaliveTimer);
    if (!token.value) return;
    wsReady.value = false;
    connectPhase.value = "connecting";
    statusText.value = T.disconnected;
    statusOk.value = false;
    statusErr.value = true;
    clearTimeout(reconnectTimer);
    // Fast first retry on flaky mobile Wi‑Fi; avoid the old 2.5s stall.
    reconnectTimer = window.setTimeout(connect, 700);
  };
  socket.onerror = () => {
    statusText.value = T.connErr;
    statusErr.value = true;
    wsReady.value = false;
    connectPhase.value = "connecting";
  };
  socket.onmessage = (ev) => {
    let m: any;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    handle(m);
  };
}

function handle(msg: any): void {
  switch (msg.type) {
    case "helloOk":
      send({ type: "listWorkspaces" });
      // Models are only needed for the composer — defer so first paint/connect feels instant.
      window.setTimeout(() => {
        if (token.value && ws?.readyState === 1) send({ type: "listModels" });
      }, 350);
      break;
    case "error":
      if (/token/i.test(msg.message || "")) {
        showLogin();
        statusText.value = T.tokenInvalid;
        statusErr.value = true;
      } else {
        toast(msg.message || T.error);
      }
      break;
    case "workspaces":
      // Blank roots would render as a nameless extra workspace row — drop them.
      workspaces.value = Array.isArray(msg.recent)
        ? msg.recent.filter((root: unknown): root is string => typeof root === "string" && root.trim().length > 0)
        : [];
      renderSidebar(msg.current);
      // Prefetch session lists for all workspaces so the drawer opens instantly.
      for (const root of workspaces.value) {
        if (!sessionsByRoot.value[root]) send({ type: "listSessions", root });
      }
      // Enter the app only after WS is authed and the first workspace payload arrives.
      statusText.value = T.connected;
      statusOk.value = true;
      statusErr.value = false;
      connectPhase.value = "ready";
      wsReady.value = true;
      break;
    case "sessions":
      if (msg.root) {
        sessionsByRoot.value[msg.root] = msg.sessions || [];
        if (sessionsLoadingRoot.value === msg.root) sessionsLoadingRoot.value = null;
        saveSessionCache();
      }
      renderSidebar(msg.current || currentRoot.value);
      break;
    case "models":
      models.value = Array.isArray(msg.available) ? msg.available : [];
      break;
    case "sessionOpened":
      if (msg.session) {
        currentSession.value = msg.session.id;
        currentFilePath.value = msg.session.filePath || null;
        sessionsStore.activeId = msg.session.id;
        renderSidebar(currentRoot.value);
        chatStore.beginHistoryLoad(msg.session.id);
        loadHistory();
        send({ type: "getSessionState", sessionId: msg.session.id });
      }
      break;
    case "sessionState": {
      if (msg.sessionId && msg.sessionId !== currentSession.value) break;
      applySessionState(msg.state);
      break;
    }
    case "history": {
      const id = currentSession.value;
      if (!id) break;
      const page = msg as SessionHistoryPage & { type: string };
      chatStore.hydrateFromHistory(id, page.messages || []);
      chatStore.endHistoryLoad(id);
      break;
    }
    case "transcript":
      draft.value = (draft.value ? draft.value + " " : "") + (msg.text || "");
      break;
    case "event":
      onAgentEvent(msg.event as AgentEvent);
      break;
  }
}

function applySessionState(state: unknown): void {
  if (!state || typeof state !== "object") return;
  const s = state as { model?: { provider?: unknown; id?: unknown }; thinkingLevel?: unknown };
  const provider = typeof s.model?.provider === "string" ? s.model.provider : "";
  const modelId = typeof s.model?.id === "string" ? s.model.id : "";
  if (provider && modelId) selectedModel.value = `${provider}/${modelId}`;
  if (typeof s.thinkingLevel === "string" && THINKING_LEVELS.includes(s.thinkingLevel)) {
    thinking.value = s.thinkingLevel;
  }
}

function patchSessionStatus(sessionId: string, status: string): void {
  for (const root of Object.keys(sessionsByRoot.value)) {
    const list = sessionsByRoot.value[root];
    if (!list) continue;
    const idx = list.findIndex((x) => x.id === sessionId);
    if (idx < 0) continue;
    const next = list.slice();
    next[idx] = { ...next[idx], status };
    sessionsByRoot.value[root] = next;
  }
}

function onAgentEvent(ev: AgentEvent): void {
  if (!ev || !("sessionId" in ev)) return;
  // Always feed the chat reducer for the event's session (background sessions stay warm).
  chatStore.applyLanEvent(ev);

  if (ev.type === "session_status") {
    patchSessionStatus(ev.sessionId, ev.status);
  } else if (ev.type === "prompt_error") {
    if (ev.sessionId === currentSession.value) toast(T.runErr);
    patchSessionStatus(ev.sessionId, "idle");
  } else if (ev.type === "prompt_done") {
    patchSessionStatus(ev.sessionId, "idle");
    // Soft reconcile from disk after the turn settles (tools/thinking finalized).
    if (ev.sessionId === currentSession.value) {
      clearTimeout(historyReconcileTimer);
      historyReconcileTimer = window.setTimeout(loadHistory, 1200);
    }
  } else if (ev.type === "agent_event") {
    const t = (ev.event as { type?: unknown })?.type;
    if (t === "agent_start" || t === "turn_start") patchSessionStatus(ev.sessionId, "running");
    if (t === "agent_end" || t === "agent_settled") patchSessionStatus(ev.sessionId, "idle");
  }
}

function loadHistory(): void {
  if (currentFilePath.value) send({ type: "getHistory", filePath: currentFilePath.value, limit: 1000000 });
}

function wsName(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
}

function sessionLabel(session: { name?: string; firstMessage?: string; id: string }): string {
  if (session.name?.trim()) return session.name.trim();
  if (session.firstMessage?.trim() && session.firstMessage !== "(no messages)") {
    const text = session.firstMessage.trim();
    return text.length > 42 ? `${text.slice(0, 39)}…` : text;
  }
  return T.newSession;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function isRunning(status: string | undefined): boolean {
  return status === "running";
}

function autoGrow(ev: Event): void {
  const el = ev.target as HTMLTextAreaElement | null;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}

function renderSidebar(current?: string): void {
  // reactive render happens automatically; just normalize currentRoot
  if (current && !currentRoot.value) currentRoot.value = current;
}

function toggleWorkspace(root: string): void {
  currentRoot.value = root;
  const willOpen = expandedRoot.value !== root;
  expandedRoot.value = willOpen ? root : null;
  if (willOpen && !sessionsByRoot.value[root]) {
    sessionsLoadingRoot.value = root;
    send({ type: "listSessions", root });
  }
}

function openSession(id: string, root: string): void {
  currentRoot.value = root;
  // Optimistic UI: flip selection before IPC round-trip.
  currentSession.value = id;
  sessionsStore.activeId = id;
  const cached = (sessionsByRoot.value[root] || []).find((s) => s.id === id);
  if (cached?.filePath) currentFilePath.value = cached.filePath;
  send({ type: "openSession", sessionId: id, root });
  if (isMobile.value) sideOpen.value = false;
}

function openSide(): void {
  sideOpen.value = true;
  // Ensure current workspace sessions are warm when the drawer opens.
  const root = currentRoot.value || workspaces.value[0] || null;
  if (root && !sessionsByRoot.value[root]) {
    sessionsLoadingRoot.value = root;
    send({ type: "listSessions", root });
  }
}

function onDocClick(e: MouseEvent): void {
  if (!isMobile.value || !sideOpen.value) return;
  const t = e.target as HTMLElement;
  if (t.closest(".menu-btn") || t.closest("aside")) return;
  sideOpen.value = false;
}

function onModelSelect(value: string): void {
  const slash = value.indexOf("/");
  if (slash <= 0 || !currentSession.value) return;
  selectedModel.value = value;
  send({ type: "setModel", sessionId: currentSession.value, provider: value.slice(0, slash), modelId: value.slice(slash + 1) });
}

function onThinkingSelect(value: string): void {
  thinking.value = value;
  if (currentSession.value) send({ type: "setThinking", sessionId: currentSession.value, level: value });
}

function sendPrompt(): void {
  const text = draft.value.trim();
  if (!text || !currentSession.value) {
    if (!currentSession.value) toast(T.pickSession);
    return;
  }
  const sessionId = currentSession.value;
  // Optimistic user bubble; streaming assistant/tool cards come from WS → applyLanEvent.
  const prev = chatStore.bySession[sessionId] ?? {
    messages: [],
    streamingMessage: null,
    running: false,
    retryHint: null,
    nextToolOrder: 1,
    pendingAskUser: null,
    pendingPermission: null,
    pendingExtensionUi: null,
    turnStartedAt: Date.now(),
    phaseStartedAt: Date.now(),
    lastActivityAt: Date.now(),
    lastWorkerAliveAt: null,
    autoRecoverCount: 0,
    autoRecovering: false,
  };
  chatStore.bySession[sessionId] = {
    ...prev,
    messages: [...prev.messages, { id: `lan-local-${Date.now()}`, role: "user" as const, text }],
    running: true,
    turnStartedAt: Date.now(),
    phaseStartedAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  send({ type: "sendPrompt", sessionId, text });
  draft.value = "";
  patchSessionStatus(sessionId, "running");
}

const uiReady = ref(false);

onMounted(() => {
  if (mql) {
    const onChange = (e: MediaQueryListEvent): void => {
      dark.value = e.matches;
    };
    mql.addEventListener("change", onChange);
    (window as any).__lanMqlHandler = onChange;
  }
  document.addEventListener("click", onDocClick);
  if (token.value) connect();
  requestAnimationFrame(() => {
    uiReady.value = true;
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  if (ws) ws.close();
  clearInterval(keepaliveTimer);
  clearTimeout(reconnectTimer);
  clearTimeout(historyReconcileTimer);
  clearTimeout(toastTimer);
  if (mql && (window as any).__lanMqlHandler) {
    mql.removeEventListener("change", (window as any).__lanMqlHandler);
  }
  window.removeEventListener("resize", () => undefined);
});
</script>

<template>
  <div class="app" :data-dark="dark" :data-ready="uiReady">
    <!-- Login -->
    <div v-if="!token" class="login-view">
      <div class="login-glow" aria-hidden="true" />
      <div class="login-card">
        <div class="login-mark">
          <svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="800" height="800" rx="120" fill="#09090b"/>
            <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
            <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
          </svg>
        </div>
        <div class="login-title">{{ T.loginTitle }}</div>
        <div class="login-sub">{{ T.subtitle }}</div>
        <div class="login-hint">{{ T.loginHint }}</div>
        <input
          v-model="loginPin"
          class="field field-pin"
          type="text"
          inputmode="numeric"
          maxlength="9"
          :placeholder="T.pin"
          autocomplete="one-time-code"
          @keydown.enter="doLogin"
        />
        <button type="button" class="btn-primary" :disabled="loginBusy" @click="doLogin">
          {{ loginBusy ? T.connecting : T.login }}
        </button>
        <div class="login-msg">{{ loginMsg }}</div>
      </div>
    </div>

    <!-- Wait for WS auth + first workspace list before showing the shell -->
    <div v-else-if="!wsReady" class="connect-view" role="status" aria-live="polite">
      <div class="login-glow" aria-hidden="true" />
      <div class="connect-card">
        <div class="login-mark">
          <svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="800" height="800" rx="120" fill="#09090b"/>
            <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
            <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
          </svg>
        </div>
        <div class="connect-spinner" aria-hidden="true" />
        <div class="connect-title">{{ T.connectingTitle }}</div>
        <div class="connect-hint">
          {{ statusErr ? T.reconnectingHint : T.connectingHint }}
        </div>
        <div class="connect-status" :class="{ err: statusErr }">{{ statusText }}</div>
        <button type="button" class="btn-ghost" @click="showLogin">{{ T.backToLogin }}</button>
      </div>
    </div>

    <template v-else>
      <header class="topbar">
        <button
          v-if="isMobile"
          type="button"
          class="icon-btn menu-btn"
          :aria-label="T.menu"
          @click="sideOpen ? (sideOpen = false) : openSide()"
        >
          <svg v-if="!sideOpen" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
          <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.3 19.7l1.41 1.41 6.3-6.3 6.29 6.3 1.41-1.41-6.29-6.3 6.3-6.29z"/></svg>
        </button>
        <span class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
              <rect width="800" height="800" rx="160" fill="currentColor"/>
              <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
              <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
            </svg>
          </span>
          <span class="brand-text">
            <span class="brand-name">{{ T.title }}</span>
            <span class="brand-sub">{{ T.subtitle }}</span>
          </span>
        </span>
        <span class="status-pill" :class="{ ok: statusOk, err: statusErr }">
          <i class="status-dot" />
          {{ statusText }}
        </span>
      </header>

      <div class="body">
        <div v-if="isMobile && sideOpen" class="side-mask" @click="sideOpen = false" />
        <aside :class="{ open: sideOpen }">
          <div class="sidebar-inner">
            <div class="section-head">
              <span class="section-title">{{ T.workspaces }}</span>
            </div>
            <div class="sidebar-scroll">
              <div v-if="!workspaces.length" class="empty-inline">{{ T.noWs }}</div>
              <div
                v-for="(root, wIdx) in workspaces"
                :key="root"
                class="ws-block"
                :style="{ '--i': String(wIdx) }"
              >
                <button
                  type="button"
                  class="ws-row"
                  :class="{ active: currentRoot === root }"
                  :title="root"
                  @click="toggleWorkspace(root)"
                >
                  <span class="chevron" :class="{ open: expandedRoot === root }" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 6l6 6-6 6-1.4-1.4L13.2 12 8.6 7.4z"/></svg>
                  </span>
                  <svg class="ws-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                  <span class="ws-name">{{ wsName(root) }}</span>
                  <span v-if="sessionsByRoot[root]?.length" class="count">{{ sessionsByRoot[root].length }}</span>
                </button>

                <ul v-show="expandedRoot === root" class="session-list">
                  <li v-if="!sessionsByRoot[root]" class="empty-inline">{{ T.loadingSessions }}</li>
                  <li v-else-if="!sessionsByRoot[root].length" class="empty-inline">{{ T.noSession }}</li>
                  <li
                    v-for="(sess, sIdx) in sessionsByRoot[root] || []"
                    :key="sess.id"
                    class="session-row"
                    :class="{
                      active: currentSession === sess.id,
                      running: isRunning(sess.status),
                    }"
                    :style="{ '--i': String(sIdx) }"
                    @click="openSession(sess.id, root)"
                  >
                    <div class="session-inner">
                      <span class="active-bar" />
                      <span class="status-mark" :class="'st-' + (sess.status || 'idle')" aria-hidden="true">
                        <i class="status-core" />
                      </span>
                      <div class="session-body">
                        <div class="session-title-row">
                          <span class="session-label" :title="sess.id">{{ sessionLabel(sess) }}</span>
                        </div>
                        <div class="session-meta">
                          <span class="time">{{ relativeTime(sess.modified) }}</span>
                          <span v-if="isRunning(sess.status)" class="run-tag">live</span>
                          <span v-else-if="sess.status === 'error'" class="err-tag">err</span>
                          <span v-else-if="sess.status === 'stuck'" class="stuck-tag">stuck</span>
                        </div>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </aside>

        <main>
          <div class="chat">
            <div v-if="!hasSession || chatEmpty" class="chat-empty">
              <div class="empty-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>
              </div>
              <div class="empty-title">{{ T.emptyChat }}</div>
            </div>
            <LanChatPane
              v-show="hasSession && !chatEmpty"
              :dark="dark"
              :session-id="currentSession"
              class="chat-pane"
            />
          </div>

          <div class="composer-wrap">
            <div class="composer-card">
              <textarea
                v-model="draft"
                class="composer-textarea"
                rows="1"
                :placeholder="T.placeholder"
                @keydown.enter.exact.prevent="sendPrompt"
                @input="autoGrow"
              />
              <div class="composer-footer">
                <div class="toolbar-left">
                  <select
                    v-model="selectedModel"
                    class="model-select"
                    :aria-label="T.model"
                    @change="onModelSelect(selectedModel)"
                  >
                    <option value="">{{ T.model }}</option>
                    <optgroup v-for="g in modelGroups" :key="g.provider" :label="g.provider">
                      <option v-for="opt in g.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </optgroup>
                  </select>
                </div>
                <div class="toolbar-right">
                  <button
                    type="button"
                    class="send-circle"
                    :disabled="!draft.trim() || !currentSession"
                    :title="T.enterToSend"
                    @click="sendPrompt"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="composer-meta">
              <label class="think-field" :title="T.thinkLevel">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>
                <select
                  v-model="thinking"
                  class="think-select"
                  :aria-label="T.thinkLevel"
                  @change="onThinkingSelect(thinking)"
                >
                  <option v-for="lv in THINKING_LEVELS" :key="lv" :value="lv">
                    {{ THINKING_LEVEL_LABELS[lv] }}
                  </option>
                </select>
              </label>
            </div>
          </div>
        </main>
      </div>
    </template>

    <div v-if="toastVisible" class="toast">{{ toastText }}</div>
  </div>
</template>

<style>
  /* Align tokens with desktop main.css — DeepSeek Harness visual language */
  :root {
    --bg: #ffffff;
    --bg2: #ffffff;
    --bg-title: #f9fafb;
    --bg-sidebar: #f9fafb;
    --bg-panel: #f9fafb;
    --bg-elevated: #ffffff;
    --bg-input: #ffffff;
    --bg-hover: #f1f3f5;
    --bg-active: #ebeff2;
    --bg-selected: #ebeff2;
    --bg-user-bubble: #edf3fe;
    --user-bg: #edf3fe;
    --tool-bg: #f5f6f7;
    --border: #e3e6ec;
    --border-strong: #d5d9e1;
    --fg: #0f1115;
    --fg-strong: #0f1115;
    --fg-muted: #61666b;
    --fg-faint: #81858c;
    --muted: #61666b;
    --text: #0f1115;
    --text-muted: #61666b;
    --text-dim: #81858c;
    --accent: #4176e6;
    --accent-hover: #5686fe;
    --accent-fg: #ffffff;
    --accent-soft: rgba(65, 118, 230, 0.08);
    --accent-border: rgba(65, 118, 230, 0.32);
    --primary: var(--accent);
    --blue: #4176e6;
    --green: #22c55e;
    --red: #ef4444;
    --code: #0f1115;
    --ok: #22c55e;
    --err: #ef4444;
    --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --font-mono: "SF Mono", "JetBrains Mono", "Fira Code", Consolas,
      "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei";
    --radius: 16px;
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --shadow-sm: 0 1px 2px rgba(15, 17, 21, 0.04), 0 0 0 1px rgba(15, 17, 21, 0.02);
    --shadow: 0 4px 18px rgba(15, 17, 21, 0.07), 0 1px 3px rgba(15, 17, 21, 0.04);
    --shadow-lg: 0 12px 40px rgba(15, 17, 21, 0.1), 0 2px 8px rgba(15, 17, 21, 0.05);
    --ease-out: cubic-bezier(0.4, 0, 0.2, 1);
    --duration-fast: 100ms;
    --duration: 200ms;
    --composer-max: 748px;
    --code-bg: #f5f6f7;
    --pre-bg: #f5f6f7;
    --md-inline-code-bg: #f1f3f5;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: var(--font-ui);
    background: var(--bg);
    color: var(--fg);
    letter-spacing: -0.011em;
    -webkit-font-smoothing: antialiased;
  }
  .app[data-dark="true"] {
    --bg: #151517;
    --bg2: #1b1b1c;
    --bg-title: #1b1b1c;
    --bg-sidebar: #1b1b1c;
    --bg-panel: #1b1b1c;
    --bg-elevated: #232324;
    --bg-input: #232324;
    --bg-hover: #2c2c2d;
    --bg-active: #353536;
    --bg-selected: #353536;
    --bg-user-bubble: #2c2c2d;
    --user-bg: #2c2c2d;
    --tool-bg: #1b1b1c;
    --border: #2c2c2d;
    --border-strong: #3a3a3b;
    --fg: #f5f6f7;
    --fg-strong: #f9fafb;
    --fg-muted: #cfd3d6;
    --fg-faint: #adb2b8;
    --muted: #cfd3d6;
    --text: #f5f6f7;
    --text-muted: #cfd3d6;
    --text-dim: #adb2b8;
    --accent: #5686fe;
    --accent-hover: #679efe;
    --accent-fg: #ffffff;
    --accent-soft: rgba(86, 134, 254, 0.16);
    --accent-border: rgba(86, 134, 254, 0.4);
    --blue: #5686fe;
    --green: #4ed17e;
    --red: #f25a5a;
    --code: #1b1b1c;
    --ok: #4ed17e;
    --err: #f25a5a;
    --shadow: 0 8px 28px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.55);
    --code-bg: #232324;
    --pre-bg: #0d1117;
    --md-inline-code-bg: #232324;
  }
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    background: var(--bg);
    color: var(--fg);
  }
  @media (min-width: 721px) {
    .app {
      background:
        radial-gradient(900px 420px at 8% -8%, color-mix(in srgb, var(--fg) 7%, transparent), transparent 62%),
        var(--bg);
    }
  }
  .app[data-ready="true"] .topbar,
  .app[data-ready="true"] .login-card {
    animation: rise-in .42s cubic-bezier(.22,1,.36,1) both;
  }
  .app[data-ready="true"] .ws-block {
    animation: rise-in .36s cubic-bezier(.22,1,.36,1) both;
    animation-delay: calc(min(var(--i, 0), 10) * 40ms + 60ms);
  }
  @keyframes rise-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 56px;
    padding: 0 14px;
    background: color-mix(in srgb, var(--bg2) 88%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    z-index: 30;
  }
  .icon-btn {
    border: none;
    background: none;
    color: var(--fg);
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover { background: color-mix(in srgb, var(--border) 70%, transparent); }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .brand-mark {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: #09090b;
    flex-shrink: 0;
    overflow: hidden;
  }
  .app[data-dark="true"] .brand-mark { color: #fafafa; }
  .brand-mark svg { width: 100%; height: 100%; display: block; }
  .brand-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .brand-name { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
  .brand-sub { font-size: 11px; color: var(--muted); }
  .status-pill {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
    background: color-mix(in srgb, var(--border) 55%, transparent);
    padding: 5px 10px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #a1a1aa; }
  .status-pill.ok { color: var(--ok); }
  .status-pill.ok .status-dot {
    background: var(--ok);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 40%, transparent);
    animation: status-breathe 1.8s ease-out infinite;
  }
  .status-pill.err { color: var(--err); }
  .status-pill.err .status-dot { background: var(--err); }
  @keyframes status-breathe {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 40%, transparent); }
    70% { box-shadow: 0 0 0 7px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  .body { flex: 1; display: flex; min-height: 0; position: relative; }
  .side-mask {
    position: absolute;
    inset: 0;
    z-index: 35;
    background: rgba(0,0,0,.28);
  }

  aside {
    width: 292px;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .sidebar-inner { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 4px;
    flex-shrink: 0;
  }
  .section-title {
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 10px; }
  .ws-block { margin: 0; }
  .ws-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--fg-strong);
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }
  .ws-row:hover { background: var(--bg-hover); }
  .ws-row.active { background: var(--bg-hover); }
  .chevron {
    display: inline-flex;
    color: var(--fg-faint);
    transition: transform var(--duration-fast) var(--ease-out);
  }
  .chevron.open { transform: rotate(90deg); }
  .ws-icon { flex-shrink: 0; opacity: .85; color: var(--muted); }
  .ws-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    font-size: 10.5px;
    color: var(--fg-faint);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    padding: 1px 7px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .empty-inline {
    padding: 8px 12px;
    font-size: 12px;
    color: var(--muted);
    list-style: none;
  }
  .session-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 2px 0 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .session-row {
    border-radius: 10px;
    color: var(--muted);
    cursor: pointer;
    animation: session-row-in 220ms var(--ease-out) both;
    animation-delay: calc(min(var(--i, 0), 12) * 18ms);
  }
  @keyframes session-row-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
  .session-inner {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 7px 8px 7px 14px;
    border-radius: 10px;
    border: 1px solid transparent;
    transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
  }
  .session-row:hover .session-inner { background: var(--bg-hover); color: var(--fg); }
  .session-row.active .session-inner {
    background: var(--bg-selected);
    border-color: var(--border);
    color: var(--fg-strong);
  }
  .active-bar {
    position: absolute;
    left: 4px;
    top: 11px;
    bottom: 11px;
    width: 2.5px;
    border-radius: 999px;
    background: transparent;
    transform: scaleY(.4);
    transition: background var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
  }
  .session-row.active .active-bar { background: var(--accent); transform: scaleY(1); }
  .status-mark { width: 8px; height: 8px; flex-shrink: 0; display: grid; place-items: center; }
  .status-core { width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--fg-faint) 55%, transparent); display: block; }
  .st-running .status-core {
    background: var(--ok);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 45%, transparent);
    animation: status-pulse 1.4s ease-out infinite;
  }
  .st-error .status-core { background: var(--err); }
  .st-stuck .status-core { background: #ca8a04; }
  @keyframes status-pulse {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 45%, transparent); }
    70% { box-shadow: 0 0 0 6px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  .session-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .session-title-row { display: flex; align-items: center; min-width: 0; }
  .session-label {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12.5px; font-weight: 550; letter-spacing: -0.01em; line-height: 1.25;
  }
  .session-row.active .session-label { font-weight: 650; }
  .session-meta { display: flex; align-items: center; gap: 6px; min-height: 14px; }
  .time { font-size: 10.5px; color: var(--fg-faint); font-variant-numeric: tabular-nums; }
  .run-tag, .err-tag, .stuck-tag {
    font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    padding: 0 5px; border-radius: 999px; line-height: 14px;
  }
  .run-tag { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
  .err-tag { color: var(--err); background: color-mix(in srgb, var(--err) 14%, transparent); }
  .stuck-tag { color: #ca8a04; background: color-mix(in srgb, #ca8a04 16%, transparent); }

  main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
  .chat {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 0;
    max-width: var(--composer-max);
    width: 100%;
    margin: 0 auto;
  }
  .chat-pane {
    flex: 1;
    min-height: 0;
    height: 100%;
  }
  .chat-pane :deep(.message-list-root),
  .chat-pane :deep(.message-list) {
    height: 100%;
    min-height: 0;
  }
  .chat-empty {
    text-align: center;
    margin-top: 18vh;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .empty-mark {
    width: 64px; height: 64px; border-radius: 20px; display: grid; place-items: center;
    background: color-mix(in srgb, var(--border) 70%, transparent); color: var(--muted);
  }
  .empty-title { font-size: 14px; max-width: 240px; line-height: 1.5; }
  .msg-enter { animation: msg-in .28s var(--ease-out) both; }
  @keyframes msg-in {
    from { opacity: 0; transform: translateY(8px) scale(.985); }
    to { opacity: 1; transform: none; }
  }
  .bubble-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 14px;
    max-width: 100%;
  }
  .bubble-wrap.user { align-items: flex-end; max-width: min(85%, 640px); margin-left: auto; }
  .bubble-wrap.assistant { align-items: flex-start; width: 100%; }
  .bubble {
    padding: 9px 13px;
    border-radius: var(--radius-md);
    font-size: 14px;
    line-height: 1.55;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .bubble.user {
    padding: 10px 14px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 9%, var(--bg-elevated));
    color: var(--fg-strong);
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
    box-shadow: 0 1px 3px color-mix(in srgb, #000 8%, transparent);
  }
  .bubble.assistant {
    background: transparent;
    padding: 2px 0;
    width: 100%;
    font-size: 14.5px;
    line-height: 1.7;
    color: var(--fg);
    border: none;
    box-shadow: none;
  }
  .bubble.tool {
    padding: 6px 11px;
    font-size: 12px;
    color: var(--muted);
    background: color-mix(in srgb, var(--border) 50%, transparent);
    border: none;
    box-shadow: none;
    width: fit-content;
  }
  .bubble.error {
    border: 1px solid color-mix(in srgb, var(--err) 45%, var(--border));
    color: var(--err);
    background: color-mix(in srgb, var(--err) 8%, transparent);
  }
  .bubble pre {
    background: var(--code);
    color: #f4f4f5;
    padding: 11px 12px;
    border-radius: 10px;
    overflow-x: auto;
    font-size: 12.5px;
    margin: 8px 0 0;
  }
  .bubble code.inline {
    background: color-mix(in srgb, var(--border) 80%, transparent);
    padding: 1px 6px;
    border-radius: 5px;
    font-size: 12.5px;
  }
  .bubble.thinking {
    background: color-mix(in srgb, var(--border) 55%, transparent);
    font-size: 12.5px;
    color: var(--muted);
    width: fit-content;
  }
  .think-label {
    display: inline-block;
    font-weight: 650;
    margin-bottom: 4px;
    letter-spacing: .04em;
    text-transform: uppercase;
    font-size: 10.5px;
  }
  .think-text { max-height: 220px; overflow: hidden; white-space: pre-wrap; }
  .typing-dots { display: inline-flex; gap: 4px; padding: 4px 2px; }
  .typing-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
  .typing-dots i:nth-child(2) { animation-delay: .2s; }
  .typing-dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%,100%{opacity:.25} 50%{opacity:1} }

  /* Desktop Composer card */
  .composer-wrap {
    flex-shrink: 0;
    width: 100%;
    max-width: var(--composer-max);
    margin: 0 auto;
    padding: 0 12px calc(10px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: transparent;
    border: none;
  }
  .composer-card {
    position: relative;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--tool-bg);
    box-shadow: none;
    padding: 6px 8px;
    transition: border-color var(--duration-fast) var(--ease-out), box-shadow .18s var(--ease-out);
  }
  .composer-card:focus-within {
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .composer-textarea {
    display: block;
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 14.5px;
    line-height: 1.55;
    padding: 8px 8px 4px;
    min-height: 40px;
    max-height: 180px;
  }
  .composer-textarea:disabled { opacity: .6; }
  .composer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 2px 0;
    min-width: 0;
  }
  .toolbar-left, .toolbar-right {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .toolbar-left { flex: 1; }
  .model-select {
    width: min(220px, 58vw);
    max-width: 100%;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    padding: 0 8px;
  }
  .send-circle {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }
  .send-circle:disabled {
    opacity: .4;
    cursor: default;
  }
  .composer-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px;
  }
  .think-field {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 6px;
    color: var(--muted);
  }
  .think-field:hover { background: var(--bg-hover); color: var(--fg); }
  .think-field:focus-within { background: var(--bg-hover); color: var(--fg); }
  .think-select {
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 11.5px;
    padding: 0;
    cursor: pointer;
    outline: none;
  }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .65; } }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 96px;
    transform: translateX(-50%);
    background: #18181b;
    color: #fafafa;
    padding: 10px 16px;
    border-radius: 12px;
    font-size: 13px;
    z-index: 70;
    max-width: 90vw;
    box-shadow: 0 10px 28px rgba(0,0,0,.28);
  }

  .login-view {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
    overflow: hidden;
  }
  .login-glow {
    position: absolute;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--fg) 10%, transparent), transparent 68%);
    filter: blur(8px);
    pointer-events: none;
  }
  .login-card {
    position: relative;
    width: min(360px, 100%);
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 22px;
    padding: 32px 26px 26px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow);
    animation: rise .35s ease;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: none; }
  }
  .login-mark {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    overflow: hidden;
    margin: 0 auto 2px;
    box-shadow: 0 10px 24px rgba(0,0,0,.18);
  }
  .login-mark svg { width: 100%; height: 100%; display: block; }
  .login-title { font-size: 22px; font-weight: 750; text-align: center; letter-spacing: -0.02em; }
  .login-sub { font-size: 12.5px; color: var(--muted); text-align: center; margin-top: -6px; }
  .login-hint { font-size: 12.5px; color: var(--muted); text-align: center; line-height: 1.55; margin: 2px 0 4px; }
  .field {
    width: 100%;
    height: 42px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-input, var(--bg2));
    color: var(--fg);
    font: inherit;
    font-size: 14.5px;
    padding: 0 12px;
    outline: none;
  }
  .field:focus { border-color: var(--accent-border); box-shadow: 0 0 0 3px var(--accent-soft); }
  .field-pin {
    text-align: center;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 20px;
    letter-spacing: 0.28em;
    text-indent: 0.28em;
  }
  .btn-primary {
    width: 100%;
    height: 42px;
    border: none;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 14.5px;
    font-weight: 650;
    cursor: pointer;
  }
  .btn-primary:disabled { opacity: .55; cursor: default; }
  .login-msg { font-size: 12.5px; color: var(--err); min-height: 16px; text-align: center; }

  .connect-view {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 18px;
    background: var(--bg);
    overflow: hidden;
  }
  .connect-card {
    position: relative;
    z-index: 1;
    width: min(360px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 28px 24px 22px;
    background: color-mix(in srgb, var(--bg2) 92%, transparent);
    border: 1px solid var(--border);
    border-radius: 22px;
    box-shadow: var(--shadow);
    animation: rise .35s var(--ease-out) both;
  }
  .connect-spinner {
    width: 36px;
    height: 36px;
    margin-top: 6px;
    border-radius: 50%;
    border: 3px solid color-mix(in srgb, var(--fg) 14%, transparent);
    border-top-color: var(--accent);
    animation: spin .75s linear infinite;
  }
  .connect-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
    text-align: center;
  }
  .connect-hint {
    font-size: 13px;
    color: var(--muted);
    text-align: center;
    line-height: 1.5;
    max-width: 260px;
  }
  .connect-status {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  .connect-status.err { color: var(--err); }
  .btn-ghost {
    margin-top: 4px;
    border: none;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 8px 12px;
    border-radius: 10px;
  }
  .btn-ghost:active { background: var(--bg-hover); color: var(--fg); }

  @media (max-width: 720px) {
    aside {
      position: fixed;
      left: 0;
      top: 56px;
      bottom: 0;
      z-index: 40;
      transform: translate3d(-100%, 0, 0);
      transition: transform .16s cubic-bezier(.22, 1, .36, 1);
      will-change: transform;
      width: 84vw;
      max-width: 330px;
      box-shadow: 0 16px 40px rgba(0,0,0,.28);
      border-radius: 0 16px 16px 0;
      contain: layout style;
    }
    aside.open { transform: translate3d(0, 0, 0); }
    .side-mask {
      animation: fade-in .2s ease both;
    }
    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .bubble-wrap.user { max-width: 94%; }
    .composer-wrap { padding: 0 8px calc(10px + env(safe-area-inset-bottom, 0px)); }
    .brand-sub { display: none; }
    .model-select { width: min(160px, 48vw); }
  }

  @media (prefers-reduced-motion: reduce) {
    .app[data-ready="true"] .topbar,
    .app[data-ready="true"] .login-card,
    .app[data-ready="true"] .ws-block,
    .session-row,
    .msg-enter,
    .status-pill.ok .status-dot,
    .st-running .status-core,
    .side-mask,
    aside {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
