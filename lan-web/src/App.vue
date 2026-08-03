<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from "vue";
import { darkTheme, NConfigProvider, NInput, NButton, NScrollbar } from "naive-ui";
import { MicOutline } from "@vicons/ionicons5";

const T: Record<string, string> = {
  title: "Pi Desktop 局域网网页控制台",
  menu: "菜单",
  connecting: "连接中…",
  workspaces: "工作区",
  emptyChat: "选择工作区和会话开始沟通",
  voicePc: "点击说话，再次点击结束",
  voiceMobile: "长按说话，松手结束",
  placeholder: "输入消息，Enter 发送",
  send: "发送",
  notConnected: "未连接",
  connected: "已连接",
  disconnected: "已断开，重连中…",
  connErr: "连接错误",
  tokenInvalid: "会话 token 已失效，请重新登录",
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
  micFail: "无法录音：",
  micUnsecure: "浏览器禁止麦克风：请使用 https 地址访问并允许麦克风权限。",
  recording: "录音中…",
  release: "松开结束",
  clickStop: "点击结束",
  converting: "正在转换…",
  noAudio: "没有录到声音",
  loginTitle: "Pi Desktop",
  user: "用户名",
  pass: "密码",
  login: "登录",
  loginFail: "登录失败：",
  loginHint: "请输入桌面端设置的账号密码。",
};

// ---------- theme ----------
const dark = ref(
  window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches,
);
const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

// ---------- auth / ws ----------
const TOKEN_KEY = "piLanToken";
const token = ref(localStorage.getItem(TOKEN_KEY) || "");
const loginUser = ref("");
const loginPass = ref("");
const loginMsg = ref("");
const statusText = ref(T.connecting);
const statusOk = ref(false);
const statusErr = ref(false);

let ws: WebSocket | null = null;
let msgSeq = 0;
let reconnectTimer: number | undefined;
let historyTimer: number | undefined;
let keepaliveTimer: number | undefined;

const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const isMobile = ref(window.innerWidth <= 720);
const sideOpen = ref(false);
window.addEventListener("resize", () => {
  isMobile.value = window.innerWidth <= 720;
  if (!isMobile.value) sideOpen.value = false;
});

// ---------- state ----------
const workspaces = ref<string[]>([]);
const sessionsByRoot = ref<Record<string, any[]>>({});
const expandedRoot = ref<string | null>(null);
const currentRoot = ref<string | null>(null);
const currentSession = ref<string | null>(null);
const currentFilePath = ref<string | null>(null);
const messages = ref<any[]>([]);
let lastHistorySig = "";
const draft = ref("");
const chatEl = ref<HTMLElement | null>(null);

// ---------- voice ----------
const recording = ref(false);
const converting = ref(false);
const voiceLabel = ref("");

let audioCtx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let stream: MediaStream | null = null;
let chunks: Float32Array[] = [];
let inputRate = 48000;
let voiceInitializing = false;
let voiceInitCancelled = false;

const WORKLET =
  "class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c&&c.length)this.port.postMessage(c.slice(0));return true}}registerProcessor('pi-lan-capture',P);";

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
}

async function doLogin(): Promise<void> {
  loginMsg.value = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: loginUser.value.trim(), password: loginPass.value }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      token.value = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      loginPass.value = "";
      connect();
    } else {
      loginMsg.value = T.loginFail + " " + (data.message || "");
    }
  } catch (err) {
    loginMsg.value = T.loginFail + " " + ((err as Error)?.message || String(err));
  }
}

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    statusText.value = T.connected;
    statusOk.value = true;
    statusErr.value = false;
    send({ type: "hello", token: token.value });
    clearInterval(keepaliveTimer);
    keepaliveTimer = window.setInterval(() => send({ type: "ping" }), 20000);
  };
  ws.onclose = () => {
    statusText.value = T.disconnected;
    statusOk.value = false;
    statusErr.value = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, 2500);
  };
  ws.onerror = () => {
    statusText.value = T.connErr;
    statusErr.value = true;
  };
  ws.onmessage = (ev) => {
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
      workspaces.value = msg.recent || [];
      sessionsByRoot.value = {};
      renderSidebar(msg.current);
      break;
    case "sessions":
      if (msg.root) sessionsByRoot.value[msg.root] = msg.sessions || [];
      renderSidebar(msg.current || currentRoot.value);
      break;
    case "sessionOpened":
      if (msg.session) {
        currentSession.value = msg.session.id;
        currentFilePath.value = msg.session.filePath || null;
        renderSidebar(currentRoot.value);
        loadHistory();
      }
      break;
    case "history": {
      const next = msg.messages || [];
      const sig = next.map((m: any) => m.id + "|" + (m.role || "") + "|" + String(m.text || "").length).join(",");
      if (sig !== lastHistorySig) {
        lastHistorySig = sig;
        messages.value = next;
        scrollChat();
      }
      break;
    }
    case "transcript":
      draft.value = (draft.value ? draft.value + " " : "") + (msg.text || "");
      break;
    case "event":
      onAgentEvent(msg.event);
      break;
  }
}

function onAgentEvent(ev: any): void {
  if (!ev || !currentSession.value) return;
  if (ev.sessionId && ev.sessionId !== currentSession.value) return;
  const t = ev.type || (ev.event && ev.event.type) || "";
  if (
    ["prompt_done", "prompt_error", "agent_event", "session_status", "agent_start", "agent_end", "tool_execution_start", "tool_execution_end", "message_update", "text_delta"].includes(t)
  ) {
    clearTimeout(historyTimer);
    historyTimer = window.setTimeout(loadHistory, 600);
  }
  if (t === "prompt_error") toast(T.runErr);
}

function loadHistory(): void {
  if (currentFilePath.value) send({ type: "getHistory", filePath: currentFilePath.value, limit: 60 });
}

function scrollChat(): void {
  void nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
  });
}

function wsName(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
}

function renderSidebar(current?: string): void {
  // reactive render happens automatically; just normalize currentRoot
  if (current && !currentRoot.value) currentRoot.value = current;
}

function toggleWorkspace(root: string): void {
  currentRoot.value = root;
  const willOpen = expandedRoot.value !== root;
  expandedRoot.value = willOpen ? root : null;
  if (willOpen && !sessionsByRoot.value[root]) send({ type: "listSessions", root });
}

function openSession(id: string, root: string): void {
  send({ type: "openSession", sessionId: id, root });
  if (isMobile.value) sideOpen.value = false;
}

function onDocClick(e: MouseEvent): void {
  if (!isMobile.value || !sideOpen.value) return;
  const t = e.target as HTMLElement;
  if (t.closest(".menu-btn") || t.closest("aside")) return;
  sideOpen.value = false;
}

function sendPrompt(): void {
  const text = draft.value.trim();
  if (!text || !currentSession.value) {
    if (!currentSession.value) toast(T.pickSession);
    return;
  }
  send({ type: "sendPrompt", sessionId: currentSession.value, text });
  draft.value = "";
}

function esc(s: unknown): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(text: string): string {
  const parts = String(text || "").split(/```/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) out += "<pre>" + esc(parts[i].replace(/^[a-zA-Z0-9_+.-]+\n/, "")) + "</pre>";
    else out += esc(parts[i]).replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
  }
  return out;
}

function markdown(text: string): string {
  return renderMarkdown(text);
}

function roleName(role: string): string {
  return role === "user" ? T.you : T.assistant;
}

function toolFail(): string {
  return T.toolFail;
}

function errorText(): string {
  return T.err;
}

// ---------- voice ----------
function linearDownsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] || 0;
    const b = input[idx + 1] === undefined ? a : input[idx + 1];
    out[i] = a + (b - a) * frac;
  }
  return out;
}
function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}
function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}
async function transcribeViaProxy(b64: string, sampleRate: number): Promise<string> {
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token.value },
    body: JSON.stringify({ pcmBase64: b64, sampleRate }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    if (res.status === 401) {
      showLogin();
      throw new Error("unauthorized");
    }
    throw new Error((data && data.message) || "failed");
  }
  return data.text || "";
}
async function startVoice(): Promise<void> {
  if (!currentSession.value) {
    toast(T.pickSession);
    return;
  }
  if (voiceInitializing || recording.value || converting.value) return;
  voiceInitializing = true;
  voiceInitCancelled = false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext();
    await ctx.resume();
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" })));
    inputRate = ctx.sampleRate || 48000;
    if (voiceInitCancelled) {
      s.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
      return;
    }
    const src = ctx.createMediaStreamSource(s);
    const node = new AudioWorkletNode(ctx, "pi-lan-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (ev) => {
      if (recording.value) chunks.push(ev.data as Float32Array);
    };
    src.connect(node);
    node.connect(ctx.destination);
    audioCtx = ctx;
    stream = s;
    workletNode = node;
    chunks = [];
    recording.value = true;
    voiceLabel.value = T.clickStop;
    toast(T.recording);
  } catch (err) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast(T.micUnsecure);
    } else {
      toast(T.micFail + ((err as Error)?.message || String(err)));
    }
  } finally {
    voiceInitializing = false;
  }
}
async function stopVoice(): Promise<void> {
  if (voiceInitializing) {
    voiceInitCancelled = true;
    return;
  }
  if (!recording.value) return;
  recording.value = false;
  voiceLabel.value = "";
  try {
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
    }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) await audioCtx.close();
  } catch {
    /* ignore */
  }
  workletNode = null;
  stream = null;
  audioCtx = null;
  if (!chunks.length) {
    toast(T.noAudio);
    return;
  }
  let total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const resampled = linearDownsample(merged, inputRate, 16000);
  const pcm = floatToInt16(resampled);
  const b64 = pcmToBase64(pcm);
  chunks = [];
  converting.value = true;
  try {
    const text = await transcribeViaProxy(b64, 16000);
    if (text) {
      draft.value = (draft.value ? draft.value + " " : "") + text;
    } else {
      toast(T.noAudio);
    }
  } catch (err) {
    toast((err as Error)?.message || T.error);
  } finally {
    converting.value = false;
  }
}
function onVoiceClick(): void {
  if (recording.value) void stopVoice();
  else void startVoice();
}

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
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  if (ws) ws.close();
  clearInterval(keepaliveTimer);
  clearTimeout(reconnectTimer);
  clearTimeout(historyTimer);
  clearTimeout(toastTimer);
  if (mql && (window as any).__lanMqlHandler) {
    mql.removeEventListener("change", (window as any).__lanMqlHandler);
  }
  window.removeEventListener("resize", () => undefined);
});
</script>

<template>
  <n-config-provider :theme="dark ? darkTheme : null">
    <div class="app" :data-dark="dark">
      <!-- Login -->
      <div v-if="!token" class="login-view">
        <div class="login-card">
          <div class="login-mark">
            <svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
              <rect width="800" height="800" rx="120" fill="#09090b"/>
              <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
              <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
            </svg>
          </div>
          <div class="login-title">{{ T.loginTitle }}</div>
          <div class="login-hint">{{ T.loginHint }}</div>
          <n-input v-model:value="loginUser" :placeholder="T.user" size="large" />
          <n-input v-model:value="loginPass" type="password" :placeholder="T.pass" size="large" show-password-on="click" @keydown.enter="doLogin" />
          <n-button type="primary" size="large" block @click="doLogin">{{ T.login }}</n-button>
          <div class="login-msg">{{ loginMsg }}</div>
        </div>
      </div>

      <template v-else>
        <header>
          <button v-if="isMobile" class="menu-btn" :aria-label="T.menu" @click="sideOpen = !sideOpen">&#9776;</button>
          <span class="app-title">{{ T.title }}</span>
          <span class="status" :class="{ ok: statusOk, err: statusErr }">{{ statusText }}</span>
        </header>
        <div class="body">
          <aside :class="{ open: sideOpen }">
            <n-scrollbar style="height: 100%">
              <h3>{{ T.workspaces }}</h3>
              <ul class="ws-list">
                <li v-if="!workspaces.length" class="ws-row muted">{{ T.noWs }}</li>
                <li v-for="root in workspaces" :key="root" class="ws-item">
                  <div
                    class="ws-row"
                    :class="{ on: currentRoot === root }"
                    @click="toggleWorkspace(root)"
                  >
                    <span class="chev" :class="{ open: expandedRoot === root }">&#9654;</span>
                    <span class="txt" :title="root">{{ wsName(root) }}</span>
                    <span v-if="sessionsByRoot[root] && sessionsByRoot[root].length" class="count">{{ sessionsByRoot[root].length }}</span>
                  </div>
                  <ul v-if="expandedRoot === root" class="sess-list">
                    <li v-if="!sessionsByRoot[root]" class="sess-row muted">{{ T.connecting }}</li>
                    <li v-else-if="!sessionsByRoot[root].length" class="sess-row muted">{{ T.noSession }}</li>
                    <li
                      v-for="sess in sessionsByRoot[root]"
                      :key="sess.id"
                      class="sess-row"
                      :class="{ on: currentSession === sess.id }"
                      @click="openSession(sess.id, root)"
                    >
                      <span class="dot" :class="'dot-' + (sess.status || 'idle')" />
                      <span class="txt" :title="sess.id">{{ sess.name || sess.firstMessage || sess.id }}</span>
                    </li>
                  </ul>
                </li>
              </ul>
            </n-scrollbar>
          </aside>
          <main>
            <div ref="chatEl" class="chat">
              <div v-if="!messages.length" class="chat-empty">{{ T.emptyChat }}</div>
              <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
                <div class="who">{{ roleName(m.role) }}</div>
                <div v-if="m.role === 'tool'" class="bubble tool">&#128295; {{ m.toolName || 'tool' }}{{ m.isError ? toolFail() : '' }}</div>
                <div v-else-if="m.role === 'error'" class="bubble error">&#9888; {{ esc(m.text || errorText()) }}</div>
                <div v-else class="bubble" v-html="markdown(m.text || '')"></div>
              </div>
            </div>
            <div class="composer">
              <button
                class="voice-btn"
                :class="{ rec: recording, busy: converting }"
                :title="T.voicePc"
                @click="onVoiceClick"
              >
                <span class="voice-icon">&#127908;</span>
                <span v-if="voiceLabel" class="voice-label">{{ voiceLabel }}</span>
              </button>
              <n-input
                v-model:value="draft"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 4 }"
                :placeholder="T.placeholder"
                @keydown.enter.exact.prevent="sendPrompt"
              />
              <n-button type="primary" @click="sendPrompt">{{ T.send }}</n-button>
            </div>
          </main>
        </div>
      </template>

      <!-- converting overlay -->
      <div v-if="converting" class="convert-overlay">
        <div class="convert-card">
          <div class="convert-spinner"></div>
          <div class="convert-text">{{ T.converting }}</div>
        </div>
      </div>

      <!-- toast -->
      <div v-if="toastVisible" class="toast">{{ toastText }}</div>
    </div>
  </n-config-provider>
</template>

<style>
  :root { --bg:#f4f5f7; --bg2:#fff; --fg:#1f2328; --muted:#6b7280; --border:#e8eaee; --accent:#2563eb; --accent2:#4f6ef7; --user:#eaf1ff; --code:#0f172a; --shadow:0 6px 24px rgba(15,23,42,.07); }
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  .app[data-dark="true"] { --bg:#0f1215; --bg2:#171b20; --fg:#e6edf3; --muted:#8b949e; --border:#262c34; --accent:#3b82f6; --accent2:#60a5fa; --user:#16223f; --code:#0b0f14; --shadow:0 6px 24px rgba(0,0,0,.35); }
  .app { display:flex; flex-direction:column; height:100vh; background:var(--bg); color:var(--fg); }
  header { display:flex; align-items:center; gap:10px; height:52px; padding:0 14px; background:var(--bg2); border-bottom:1px solid var(--border); flex-shrink:0; }
  .menu-btn { font-size:20px; border:none; background:none; color:var(--fg); cursor:pointer; }
  .app-title { font-weight:700; font-size:15px; }
  .status { margin-left:auto; font-size:12px; color:var(--muted); }
  .status.ok { color:#16a34a; }
  .status.err { color:#dc2626; }
  .body { flex:1; display:flex; min-height:0; }
  aside { width:290px; background:var(--bg2); border-right:1px solid var(--border); overflow:hidden; flex-shrink:0; padding:10px; }
  aside h3 { font-size:11.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin:14px 6px 8px; }
  .ws-list { list-style:none; margin:0; padding:0; }
  .ws-item { margin:0; padding:0; }
  .ws-row { display:flex; align-items:center; gap:7px; padding:9px 10px; border-radius:10px; font-size:13.5px; cursor:pointer; overflow:hidden; }
  .ws-row:hover { background:var(--border); }
  .ws-row.on { background:var(--accent); color:#fff; }
  .ws-row.muted { cursor:default; color:var(--muted); }
  .chev { width:11px; flex-shrink:0; transition:transform .18s ease; opacity:.7; font-size:10px; }
  .chev.open { transform:rotate(90deg); }
  .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .count { margin-left:auto; font-size:10.5px; opacity:.7; background:rgba(128,128,128,.18); padding:0 6px; border-radius:99px; }
  .sess-list { list-style:none; margin:2px 0 6px; padding:0 0 0 16px; border-left:2px solid var(--border); margin-left:16px; }
  .sess-row { display:flex; align-items:center; gap:7px; padding:7px 9px; border-radius:9px; font-size:12.5px; cursor:pointer; overflow:hidden; }
  .sess-row:hover { background:var(--border); }
  .sess-row.on { background:var(--accent); color:#fff; }
  .sess-row.muted { cursor:default; color:var(--muted); }
  .dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .dot-idle { background:#9ca3af; }
  .dot-running { background:#22c55e; }
  .dot-error { background:#dc2626; }
  main { flex:1; display:flex; flex-direction:column; min-width:0; }
  .chat { flex:1; overflow-y:auto; padding:18px; max-width:900px; width:100%; margin:0 auto; }
  .chat-empty { text-align:center; margin-top:48px; color:var(--muted); }
  .msg { margin-bottom:14px; max-width:80%; display:flex; flex-direction:column; }
  .msg.user { margin-left:auto; align-items:flex-end; }
  .who { font-size:11px; color:var(--muted); margin-bottom:4px; padding:0 4px; }
  .msg.user .who { text-align:right; }
  .bubble { padding:10px 14px; border-radius:16px; background:var(--bg2); border:1px solid var(--border); font-size:14px; line-height:1.6; word-break:break-word; white-space:pre-wrap; }
  .msg.user .bubble { background:var(--user); border-color:transparent; border-bottom-right-radius:6px; }
  .msg:not(.user) .bubble { border-bottom-left-radius:6px; }
  .msg.tool .bubble { padding:5px 10px; font-size:12px; color:var(--muted); background:transparent; border-color:transparent; }
  .msg.error .bubble { border-color:#dc2626; color:#dc2626; }
  .bubble pre { background:var(--code); color:#e6edf3; padding:9px 11px; border-radius:10px; overflow-x:auto; font-size:12.5px; margin:7px 0 0; }
  .bubble code.inline { background:var(--border); padding:1px 6px; border-radius:5px; font-size:12.5px; }
  .composer { border-top:1px solid var(--border); background:var(--bg2); padding:12px; display:flex; gap:8px; align-items:flex-end; max-width:900px; width:100%; margin:0 auto; border-radius:18px 18px 0 0; box-shadow:var(--shadow); }
  .voice-btn { width:44px; height:44px; border-radius:50%; padding:0; font-size:18px; border:none; background:var(--border); color:var(--fg); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; position:relative; flex-shrink:0; user-select:none; -webkit-user-select:none; touch-action:none; }
  .voice-btn.rec { background:#dc2626; color:#fff; animation:pulse 1.1s ease-in-out infinite; }
  .voice-btn.busy { opacity:.6; pointer-events:none; }
  .voice-icon { line-height:1; }
  .voice-label { position:absolute; bottom:-20px; left:50%; transform:translateX(-50%); font-size:10.5px; white-space:nowrap; color:var(--muted); }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.6; } }
  .convert-overlay { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.28); backdrop-filter:blur(2px); }
  .convert-card { display:flex; flex-direction:column; align-items:center; gap:14px; padding:26px 34px; background:var(--bg2); border:1px solid var(--border); border-radius:18px; box-shadow:var(--shadow); }
  .convert-spinner { width:34px; height:34px; border-radius:50%; border:3px solid color-mix(in srgb, var(--accent) 22%, transparent); border-top-color:var(--accent); animation:spin .7s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .convert-text { font-size:13.5px; font-weight:550; }
  .toast { position:fixed; left:50%; bottom:92px; transform:translateX(-50%); background:#111; color:#fff; padding:9px 16px; border-radius:10px; font-size:13px; z-index:70; max-width:90vw; box-shadow:0 8px 24px rgba(0,0,0,.25); }
  .login-view { position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; background:var(--bg); }
  .login-card { width:320px; background:var(--bg2); border:1px solid var(--border); border-radius:20px; padding:30px 26px; display:flex; flex-direction:column; gap:12px; box-shadow:var(--shadow); }
  .login-mark { width:52px; height:52px; border-radius:14px; background:#09090b; margin:0 auto 2px; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 22px rgba(0,0,0,.2); }
  .login-mark svg { width:32px; height:32px; }
  .login-title { font-size:19px; font-weight:750; text-align:center; }
  .login-hint { font-size:12.5px; color:var(--muted); text-align:center; margin-bottom:2px; line-height:1.5; }
  .login-msg { font-size:12.5px; color:#dc2626; min-height:16px; text-align:center; }
  @media (max-width:720px) {
    aside { position:fixed; left:0; top:52px; bottom:0; z-index:40; transform:translateX(-100%); transition:transform .22s ease; width:84vw; max-width:330px; box-shadow:0 12px 32px rgba(0,0,0,.25); border-radius:0 14px 14px 0; }
    aside.open { transform:translateX(0); }
    .msg { max-width:92%; }
    .composer { border-radius:16px 16px 0 0; padding:10px; }
  }
</style>
