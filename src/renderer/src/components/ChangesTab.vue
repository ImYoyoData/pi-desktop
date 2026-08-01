<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";
import type { DropdownOption, SelectOption } from "naive-ui";
import {
  NButton,
  NCheckbox,
  NDropdown,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NSelect,
  NSpin,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import {
  ArrowDownOutline,
  ArrowUndoOutline,
  ArrowUpOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
  CloudDownloadOutline,
  CloudOutline,
  CreateOutline,
  EllipsisHorizontalOutline,
  GitBranchOutline,
  GitCommitOutline,
  GitCompareOutline,
  GitMergeOutline,
  EyeOffOutline,
  EyeOutline,
  RefreshOutline,
  TimeOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { t } from "@renderer/i18n";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { countDiffStats } from "@renderer/utils/tool-diff";
import ChangesDiffEditor from "@renderer/components/ChangesDiffEditor.vue";
import ChangesConflictResolve from "@renderer/components/ChangesConflictResolve.vue";
import type { GitErrorCode } from "../../../shared/git-types";

const props = withDefaults(
  defineProps<{
    /** False when the Changes panel is hidden — defer expensive git refreshes. */
    visible?: boolean;
  }>(),
  { visible: true },
);

type GitFile = {
  relativePath: string;
  status: string;
  code: string;
  staged?: boolean;
  ignored?: boolean;
};
type GitRemote = { name: string; fetchUrl: string; pushUrl: string };
type GitLogEntry = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};
type GitOp =
  | { ok: true; message?: string }
  | { ok: false; message: string; code?: string };

const workspace = useWorkspaceStore();
const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const busy = ref(false);
const isGit = ref(false);
const gitUnavailable = ref(false);
const branch = ref<string | null>(null);
const files = ref<GitFile[]>([]);
const checked = ref<Record<string, boolean>>({});
const selectedPath = ref<string | null>(null);
const patch = ref<string | null>(null);
const conflictPayload = ref<null | {
  working: string;
  labels: { ours: string; theirs: string };
}>(null);
const oldContent = ref("");
const newContent = ref("");
const diffSupported = ref(true);
const commitMessage = ref("");
const localBranches = ref<string[]>([]);
const remoteBranches = ref<string[]>([]);
const remotes = ref<GitRemote[]>([]);
const showRemotes = ref(false);
const showLog = ref(false);
const showNewBranch = ref(false);
const newBranchName = ref("");
const showMerge = ref(false);
const mergeTarget = ref<string | null>(null);
const showEditRemote = ref(false);
const editRemoteName = ref("");
const editRemoteUrl = ref("");
const remoteName = ref("origin");
const remoteUrl = ref("");
const logEntries = ref<GitLogEntry[]>([]);
const logLoading = ref(false);
const showRenameBranch = ref(false);
const renameBranchName = ref("");
const showDeleteBranch = ref(false);
const deleteBranchTarget = ref<string | null>(null);
const showFileLog = ref(false);
const fileLogPath = ref<string | null>(null);
const fileLogEntries = ref<GitLogEntry[]>([]);
const fileLogLoading = ref(false);
const fileLogSelected = ref<{ hash: string; shortHash: string; subject: string } | null>(null);
const fileLogDiff = ref<string | null>(null);
const fileLogDiffLoading = ref(false);
const restoringCommit = ref(false);
/** Selected commit detail (history → file list → per-file diff). */
type CommitDetail = { hash: string; shortHash: string; subject: string; author: string; date: string };
const commitDetail = ref<CommitDetail | null>(null);
const commitFiles = ref<{ status: string; path: string }[]>([]);
const commitFilesLoading = ref(false);
const commitFileSelected = ref<{ path: string; status: string } | null>(null);
const commitFileDiff = ref<string | null>(null);
const commitFileDiffLoading = ref(false);
const resetting = ref<"soft" | "hard" | null>(null);

const checkedPaths = computed(() =>
  files.value.filter((f) => checked.value[f.relativePath]).map((f) => f.relativePath),
);

const allChecked = computed(
  () => files.value.length > 0 && files.value.every((f) => checked.value[f.relativePath]),
);

const someChecked = computed(
  () => files.value.some((f) => checked.value[f.relativePath]) && !allChecked.value,
);

const canCommit = computed(
  () => Boolean(commitMessage.value.trim()) && checkedPaths.value.length > 0 && !busy.value,
);

function isConflictFile(f: GitFile): boolean {
  return f.status === "conflict" || f.code === "C";
}

const discardableCheckedPaths = computed(() =>
  files.value
    .filter((f) => checked.value[f.relativePath] && !isConflictFile(f))
    .map((f) => f.relativePath),
);

const canDiscardSelected = computed(
  () => discardableCheckedPaths.value.length > 0 && !busy.value && isGit.value,
);

const conflictCount = computed(
  () => files.value.filter((f) => f.status === "conflict" || f.code === "C").length,
);

const selectedFileName = computed(() => {
  if (!selectedPath.value) return "";
  return selectedPath.value.split(/[/\\]/).pop() || selectedPath.value;
});

const selectedCode = computed(() => {
  if (!selectedPath.value) return "";
  return files.value.find((f) => f.relativePath === selectedPath.value)?.code ?? "";
});

function statusClass(code: string): string {
  switch (code) {
    case "M":
      return "st-modified";
    case "A":
      return "st-added";
    case "D":
      return "st-deleted";
    case "R":
      return "st-renamed";
    case "U":
      return "st-untracked";
    case "C":
      return "st-conflict";
    default:
      return "st-modified";
  }
}

function fileName(rel: string): string {
  const parts = rel.split("/");
  return parts[parts.length - 1] || rel;
}

function fileDir(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx > 0 ? rel.slice(0, idx) : "";
}

const diffStats = computed(() => {
  if (!patch.value) return null;
  return countDiffStats(patch.value);
});

const showDiffEditor = computed(
  () => Boolean(selectedPath.value && diffSupported.value && patch.value != null),
);

const mergeBranchOptions = computed<SelectOption[]>(() => {
  const opts: SelectOption[] = [];
  for (const name of localBranches.value) {
    if (name === branch.value) continue;
    opts.push({ label: name, value: name });
  }
  for (const name of remoteBranches.value) {
    opts.push({ label: name, value: name });
  }
  return opts;
});

const deleteBranchOptions = computed<SelectOption[]>(() =>
  localBranches.value
    .filter((name) => name !== branch.value)
    .map((name) => ({ label: name, value: name })),
);

const branchMenu = computed<DropdownOption[]>(() => {
  const items: DropdownOption[] = [];
  if (localBranches.value.length) {
    items.push({
      type: "group",
      key: "local-group",
      label: t.changesLocalBranches,
      children: localBranches.value.map((name) => ({
        label: name === branch.value ? `${name} ✓` : name,
        key: `checkout:${name}`,
        disabled: name === branch.value,
      })),
    });
  }
  if (remoteBranches.value.length) {
    items.push({
      type: "group",
      key: "remote-group",
      label: t.changesRemoteBranches,
      children: remoteBranches.value.map((name) => ({
        label: name,
        key: `checkout:${name}`,
      })),
    });
  }
  if (items.length) items.push({ type: "divider", key: "d1" });
  items.push({
    label: t.changesNewBranch,
    key: "new",
    icon: () => h(NIcon, null, { default: () => h(GitBranchOutline) }),
  });
  items.push({
    label: t.changesMergeBranch,
    key: "merge",
    icon: () => h(NIcon, null, { default: () => h(GitMergeOutline) }),
  });
  items.push({
    label: t.changesRenameBranch,
    key: "rename",
    icon: () => h(NIcon, null, { default: () => h(CreateOutline) }),
  });
  items.push({
    label: t.changesDeleteBranch,
    key: "delete",
    icon: () => h(NIcon, null, { default: () => h(TrashOutline) }),
  });
  return items;
});

function formatGitError(result: Extract<GitOp, { ok: false }>): string {
  const code = (result.code || "unknown") as GitErrorCode;
  const key = `gitErr_${code}` as keyof typeof t;
  const localized = typeof t[key] === "string" ? (t[key] as string) : t.gitErr_unknown;
  const detail = result.message?.trim();
  if (!detail || detail === code || detail === localized) return localized;
  if (code === "unknown" || code === "invalid_args") return `${localized}\n${detail}`;
  return localized;
}

function syncChecks(next: GitFile[]): void {
  const prev = checked.value;
  const map: Record<string, boolean> = {};
  for (const f of next) {
    map[f.relativePath] = prev[f.relativePath] ?? true;
  }
  checked.value = map;
  if (selectedPath.value && !map[selectedPath.value]) {
    selectedPath.value = next[0]?.relativePath ?? null;
  } else if (!selectedPath.value && next[0]) {
    selectedPath.value = next[0].relativePath;
  }
}

function setAllChecked(value: boolean): void {
  const map: Record<string, boolean> = {};
  for (const f of files.value) {
    map[f.relativePath] = value;
  }
  checked.value = map;
}

function onToggleAll(value: boolean): void {
  setAllChecked(value);
}

async function refreshRemotes(): Promise<void> {
  if (!isGit.value) {
    remotes.value = [];
    return;
  }
  try {
    remotes.value = await window.api.git.remotes();
  } catch {
    remotes.value = [];
  }
}

/**
 * Refresh git status without piling up concurrent calls. Multiple refreshes
 * (fs-watcher bursts + manual refresh + post-op refresh) used to run git
 * subprocesses at the same time as commit/push/checkout, racing on
 * .git/index.lock and failing with "index.lock: File exists".
 */
let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;
async function refresh(): Promise<void> {
  if (refreshInFlight) {
    // Another refresh is running: run one follow-up afterwards so the latest
    // state is always reflected (but never more than one extra pass).
    refreshQueued = true;
    return refreshInFlight;
  }
  const run = (async () => {
    loading.value = true;
    try {
      const status = await window.api.git.status();
      isGit.value = status.isGitRepository;
      gitUnavailable.value = status.errorCode === "git_unavailable";
      branch.value = status.branch;
      files.value = status.files as GitFile[];
      syncChecks(files.value);
      if (status.errorCode === "git_unavailable") {
        message.error(
          formatGitError({
            ok: false,
            code: "git_unavailable",
            message: status.errorMessage || "",
          }),
        );
      }
      if (status.isGitRepository && !gitUnavailable.value) {
        const br = await window.api.git.branches();
        localBranches.value = br.local;
        remoteBranches.value = br.remote ?? [];
        if (br.current) branch.value = br.current;
        await refreshRemotes();
      } else {
        localBranches.value = [];
        remoteBranches.value = [];
        remotes.value = [];
        selectedPath.value = null;
        patch.value = null;
        conflictPayload.value = null;
        oldContent.value = "";
        newContent.value = "";
      }
      if (selectedPath.value) await loadDiff(selectedPath.value);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      loading.value = false;
    }
  })();
  refreshInFlight = run.finally(() => {
    refreshInFlight = null;
    if (refreshQueued) {
      refreshQueued = false;
      void refresh();
    }
  });
  return refreshInFlight;
}

async function loadDiff(relativePath: string): Promise<void> {
  selectedPath.value = relativePath;
  const file = files.value.find((f) => f.relativePath === relativePath);
  if (file && (file.status === "conflict" || file.code === "C")) {
    const result = await window.api.git.conflictContent(relativePath);
    if (result.supported) {
      conflictPayload.value = { working: result.working, labels: result.labels };
      patch.value = null;
      oldContent.value = "";
      newContent.value = "";
      diffSupported.value = false;
      return;
    }
    conflictPayload.value = null;
  } else {
    conflictPayload.value = null;
  }
  const result = await window.api.git.diff(relativePath);
  diffSupported.value = result.supported;
  if (!result.supported) {
    patch.value = null;
    oldContent.value = "";
    newContent.value = "";
    return;
  }
  patch.value = result.patch ?? null;
  oldContent.value = result.oldContent ?? "";
  newContent.value = result.newContent ?? "";
}

async function runOp(labelOk: string, fn: () => Promise<GitOp>): Promise<boolean> {
  busy.value = true;
  try {
    const result = await fn();
    if (!result.ok) {
      message.error(formatGitError(result));
      if (result.code === "no_remote") showRemotes.value = true;
      await refresh();
      return false;
    }
    message.success(labelOk);
    await refresh();
    return true;
  } finally {
    busy.value = false;
  }
}

async function onCommit(): Promise<void> {
  if (!canCommit.value) return;
  const msg = commitMessage.value.trim();
  const paths = [...checkedPaths.value];
  busy.value = true;
  try {
    const result = await window.api.git.commit({ message: msg, paths });
    if (!result.ok) {
      message.error(formatGitError(result));
      return;
    }
    message.success(t.changesCommitted);
    commitMessage.value = "";
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function onPull(): Promise<void> {
  await runOp(t.changesPulled, () => window.api.git.pull());
}

async function onPush(): Promise<void> {
  await runOp(t.changesPushed, () => window.api.git.push());
}

async function onFetch(): Promise<void> {
  await runOp(t.changesFetched, () => window.api.git.fetch());
}

async function onDiscardSelected(): Promise<void> {
  const paths = [...discardableCheckedPaths.value];
  if (!paths.length) return;
  const d = dialog.warning({
    title: t.changesDiscardSelected,
    content: t.changesDiscardConfirmSelected,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return runOp(t.changesDiscarded, () => window.api.git.restore(paths)).then(() => true);
    },
  });
}

function onStageFile(file: GitFile): void {
  void runOp(t.changesStaged, () => window.api.git.stage([file.relativePath])).then((ok) => {
    if (ok) {
      file.staged = true;
      if (selectedPath.value === file.relativePath) void loadDiff(file.relativePath);
    }
  });
}

function onUnstageFile(file: GitFile): void {
  void runOp(t.changesUnstaged, () => window.api.git.unstage([file.relativePath])).then((ok) => {
    if (ok) {
      file.staged = false;
      if (selectedPath.value === file.relativePath) void loadDiff(file.relativePath);
    }
  });
}

function onIgnoreFile(file: GitFile): void {
  void window.api.git.ignore([file.relativePath]).then(() => {
    file.ignored = true;
    message.success(t.changesIgnored);
  });
}

function onUnignoreFile(file: GitFile): void {
  void window.api.git.unignore(file.relativePath).then(() => {
    file.ignored = false;
    message.success(t.changesUnignored);
  });
}

async function onDiscardFile(relativePath: string): Promise<void> {
  if (!relativePath) return;
  const d = dialog.warning({
    title: t.changesDiscardFile,
    content: t.changesDiscardConfirmFile,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return runOp(t.changesDiscarded, () => window.api.git.restore([relativePath])).then(
        () => true,
      );
    },
  });
}

async function onConflictResolve(content: string): Promise<void> {
  if (!selectedPath.value) return;
  await runOp(t.changesConflictResolved, () =>
    window.api.git.resolveConflict({ relativePath: selectedPath.value!, content }),
  );
}

async function onConflictAcceptSide(side: "ours" | "theirs"): Promise<void> {
  if (!selectedPath.value) return;
  await runOp(t.changesConflictResolved, () =>
    window.api.git.checkoutConflictSide({ relativePath: selectedPath.value!, side }),
  );
}

async function onAbortMerge(): Promise<void> {
  const d = dialog.warning({
    title: t.changesConflictAbort,
    content: t.changesConflictAbortConfirm,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return runOp(t.changesConflictAborted, () => window.api.git.abortMerge()).then(() => true);
    },
  });
}

async function onInitGit(): Promise<void> {
  await runOp(t.changesGitInitialized, () => window.api.git.init());
}

async function openRemotes(): Promise<void> {
  showRemotes.value = true;
  await refreshRemotes();
}

async function openLog(): Promise<void> {
  showLog.value = true;
  logLoading.value = true;
  try {
    const result = await window.api.git.log(80);
    logEntries.value = result.entries;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    logEntries.value = [];
  } finally {
    logLoading.value = false;
  }
}
async function openCommitDetail(entry: GitLogEntry): Promise<void> {
  commitDetail.value = {
    hash: entry.hash,
    shortHash: entry.shortHash,
    subject: entry.subject,
    author: entry.author,
    date: entry.date,
  };
  commitFiles.value = [];
  commitFileSelected.value = null;
  commitFileDiff.value = null;
  commitFilesLoading.value = true;
  try {
    const res = await window.api.git.showCommitFiles(entry.hash);
    commitFiles.value = res.files ?? [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    commitFilesLoading.value = false;
  }
}

function closeCommitDetail(): void {
  commitDetail.value = null;
  commitFiles.value = [];
  commitFileSelected.value = null;
  commitFileDiff.value = null;
}

async function showCommitFileDiff(file: { path: string; status: string }): Promise<void> {
  const commit = commitDetail.value;
  if (!commit || busy.value) return;
  commitFileSelected.value = file;
  commitFileDiff.value = null;
  commitFileDiffLoading.value = true;
  try {
    const res = await window.api.git.fileDiffAtCommit(file.path, commit.hash);
    commitFileDiff.value = res.supported ? (res.patch ?? null) : null;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    commitFileDiffLoading.value = false;
  }
}

function backFromCommitFileDiff(): void {
  commitFileSelected.value = null;
  commitFileDiff.value = null;
}

function restoreCommitFile(): void {
  const file = commitFileSelected.value;
  const commit = commitDetail.value;
  if (!file || !commit || busy.value) return;
  const d = dialog.warning({
    title: t.changesRestoreToCommit,
    content: t.changesRestoreFileConfirm(file.path, commit.shortHash),
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return runOp(t.changesRestored, () =>
        window.api.git.restoreFileToCommit(file.path, commit.hash),
      );
    },
  });
}

function onResetCommit(mode: "soft" | "hard"): void {
  const commit = commitDetail.value;
  if (!commit || busy.value) return;
  const d = dialog.warning({
    title: mode === "soft" ? t.changesResetSoft : t.changesResetHard,
    content: t.changesResetConfirm(commit.shortHash, mode),
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      resetting.value = mode;
      return runOp(
        mode === "soft" ? t.changesResetSoft : t.changesResetHard,
        () => window.api.git.resetToCommit(commit.hash, mode),
      ).finally(() => {
        resetting.value = null;
      });
    },
  });
}

async function onAddRemote(): Promise<void> {
  const name = remoteName.value.trim();
  const url = remoteUrl.value.trim();
  if (!name || !url) {
    message.error(t.gitErr_invalid_args);
    return;
  }
  const ok = await runOp(t.changesRemoteAdded, () =>
    window.api.git.addRemote({ name, url }),
  );
  if (ok) {
    remoteUrl.value = "";
    await refreshRemotes();
  }
}

async function onEditRemote(remote: GitRemote): Promise<void> {
  editRemoteName.value = remote.name;
  editRemoteUrl.value = remote.pushUrl || remote.fetchUrl;
  showEditRemote.value = true;
}

async function submitEditRemote(): Promise<boolean> {
  const url = editRemoteUrl.value.trim();
  if (!url) {
    message.warning(t.changesRemoteUrl);
    return false;
  }
  const ok = await runOp(t.changesRemoteUpdated, () =>
    window.api.git.setRemoteUrl({ name: editRemoteName.value, url }),
  );
  if (ok) {
    showEditRemote.value = false;
    await refreshRemotes();
  }
  return ok;
}

async function onRemoveRemote(remote: GitRemote): Promise<void> {
  const d = dialog.warning({
    title: t.changesRemoteRemove,
    content: `${t.changesRemoteRemove}: ${remote.name}?`,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return (async () => {
        try {
          await runOp(t.changesRemoteRemoved, () => window.api.git.removeRemote(remote.name));
          await refreshRemotes();
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
          d.loading = false;
          return false;
        }
      })();
    },
  });
}

const moreMenu = computed<DropdownOption[]>(() => [
  {
    label: t.changesRemotes,
    key: "remotes",
    icon: () => h(NIcon, null, { default: () => h(CloudOutline) }),
  },
  {
    label: t.changesLog,
    key: "log",
    icon: () => h(NIcon, null, { default: () => h(TimeOutline) }),
  },
  {
    label: t.changesRefresh,
    key: "refresh",
    icon: () => h(NIcon, null, { default: () => h(RefreshOutline) }),
  },
]);

function onMoreSelect(key: string | number): void {
  const k = String(key);
  if (k === "remotes") void openRemotes();
  else if (k === "log") void openLog();
  else if (k === "refresh") void refresh();
}

function onCommitKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" || e.shiftKey || e.altKey) return;
  e.preventDefault();
  void onCommit();
}

async function onCommitAndPush(): Promise<void> {
  if (!canCommit.value) return;
  const msg = commitMessage.value.trim();
  const paths = [...checkedPaths.value];
  busy.value = true;
  try {
    const commit = await window.api.git.commit({ message: msg, paths });
    if (!commit.ok) {
      message.error(formatGitError(commit));
      return;
    }
    message.success(t.changesCommitted);
    commitMessage.value = "";
    const push = await window.api.git.push();
    if (!push.ok) {
      message.error(formatGitError(push));
      return;
    }
    message.success(t.changesPushed);
    await refresh();
  } finally {
    busy.value = false;
  }
}

function onBranchSelect(key: string | number): void {
  const k = String(key);
  if (k === "new") {
    newBranchName.value = "";
    showNewBranch.value = true;
    return;
  }
  if (k === "merge") {
    mergeTarget.value = null;
    showMerge.value = true;
    return;
  }
  if (k === "rename") {
    renameBranchName.value = branch.value ?? "";
    showRenameBranch.value = true;
    return;
  }
  if (k === "delete") {
    deleteBranchTarget.value = null;
    showDeleteBranch.value = true;
    return;
  }
  if (k.startsWith("checkout:")) {
    const name = k.slice("checkout:".length);
    void runOp(t.changesCheckoutOk, () => window.api.git.checkout(name));
  }
}

async function submitRenameBranch(): Promise<boolean> {
  const next = renameBranchName.value.trim();
  const current = branch.value ?? "";
  if (!next) {
    message.warning(t.changesRenameBranchPrompt);
    return false;
  }
  const ok = await runOp(t.changesBranchRenamed, () =>
    window.api.git.renameBranch({ branch: current, nextName: next }),
  );
  if (ok) showRenameBranch.value = false;
  return ok;
}

async function submitDeleteBranch(): Promise<boolean> {
  const name = (deleteBranchTarget.value ?? "").trim();
  if (!name) {
    message.warning(t.changesDeleteBranchPrompt);
    return false;
  }
  const ok = await runOp(t.changesBranchDeleted, () => window.api.git.deleteBranch(name));
  if (ok) showDeleteBranch.value = false;
  return ok;
}

async function openFileLog(relativePath: string): Promise<void> {
  if (!relativePath) return;
  fileLogPath.value = relativePath;
  showFileLog.value = true;
  fileLogLoading.value = true;
  fileLogEntries.value = [];
  fileLogSelected.value = null;
  fileLogDiff.value = null;
  try {
    const result = await window.api.git.logFile(relativePath, 50);
    fileLogEntries.value = result.entries;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    fileLogEntries.value = [];
  } finally {
    fileLogLoading.value = false;
  }
}

async function showFileLogDiff(entry: GitLogEntry): Promise<void> {
  const filePath = fileLogPath.value;
  if (!filePath) return;
  fileLogSelected.value = { hash: entry.hash, shortHash: entry.shortHash, subject: entry.subject };
  fileLogDiffLoading.value = true;
  fileLogDiff.value = null;
  try {
    const result = await window.api.git.fileDiffAtCommit({
      relativePath: filePath,
      commitHash: entry.hash,
    });
    fileLogDiff.value = result.supported ? (result.patch ?? null) : null;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    fileLogDiff.value = null;
  } finally {
    fileLogDiffLoading.value = false;
  }
}

function closeFileLogDiff(): void {
  fileLogSelected.value = null;
  fileLogDiff.value = null;
}

function onRestoreToCommit(): void {
  const filePath = fileLogPath.value;
  const commit = fileLogSelected.value;
  if (!filePath || !commit || restoringCommit.value) return;
  const d = dialog.warning({
    title: t.changesRestoreToCommit,
    content: t.changesRestoreToCommitConfirm(commit.shortHash),
    positiveText: t.changesRestoreToCommit,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return (async () => {
        restoringCommit.value = true;
        try {
          const result = await window.api.git.restoreFileToCommit({
            relativePath: filePath,
            commitHash: commit.hash,
          });
          if (!result.ok) {
            message.error(formatGitError(result));
            return false;
          }
          message.success(t.changesRestoredToCommit);
          showFileLog.value = false;
          closeFileLogDiff();
          await refresh();
          if (selectedPath.value) await loadDiff(selectedPath.value);
          return true;
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
          return false;
        } finally {
          restoringCommit.value = false;
        }
      })();
    },
  });
}

async function submitNewBranch(): Promise<boolean> {
  const name = newBranchName.value.trim();
  if (!name) {
    message.warning(t.changesNewBranchPrompt);
    return false;
  }
  const ok = await runOp(t.changesBranchCreated, () => window.api.git.createBranch(name));
  if (ok) showNewBranch.value = false;
  return ok;
}

async function submitMerge(): Promise<boolean> {
  const name = (mergeTarget.value ?? "").trim();
  if (!name) {
    message.warning(t.changesMergePrompt);
    return false;
  }
  const ok = await runOp(t.changesMerged, () => window.api.git.merge(name));
  if (ok) showMerge.value = false;
  return ok;
}

function formatLogDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let fsRefreshPending = false;

function onFsChanged(): void {
  if (!workspace.root) return;
  // Coalesce bursty watcher events; skip work while the panel is hidden.
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  fsRefreshTimer = setTimeout(() => {
    fsRefreshTimer = null;
    if (!props.visible) {
      fsRefreshPending = true;
      return;
    }
    void refresh();
  }, 400);
}

onMounted(() => {
  void refresh();
  window.addEventListener("pi-fs-changed", onFsChanged);
});

onUnmounted(() => {
  window.removeEventListener("pi-fs-changed", onFsChanged);
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
});

watch(
  () => workspace.root,
  () => {
    void refresh();
  },
);

watch(
  () => props.visible,
  (visible) => {
    if (!visible || !fsRefreshPending) return;
    fsRefreshPending = false;
    void refresh();
  },
);
</script>

<template>
  <div class="changes-tab">
    <div class="toolbar">
      <NDropdown trigger="click" :options="branchMenu" :disabled="!isGit || busy" @select="onBranchSelect">
        <NButton size="tiny" quaternary :disabled="!isGit || busy">
          <template #icon>
            <NIcon :component="GitBranchOutline" :size="14" />
          </template>
          {{ branch || t.changesBranch }}
        </NButton>
      </NDropdown>
      <div class="spacer" />
      <NButton
        class="icon-btn"
        size="tiny"
        quaternary
        circle
        :disabled="!isGit || busy"
        :title="t.changesFetch"
        @click="onFetch"
      >
        <template #icon>
          <NIcon :component="CloudDownloadOutline" :size="15" />
        </template>
      </NButton>
      <NButton
        class="icon-btn"
        size="tiny"
        quaternary
        circle
        :disabled="!isGit || busy"
        :title="t.changesPull"
        @click="onPull"
      >
        <template #icon>
          <NIcon :component="ArrowDownOutline" :size="15" />
        </template>
      </NButton>
      <NButton
        class="icon-btn"
        size="tiny"
        quaternary
        circle
        :disabled="!isGit || busy"
        :title="t.changesPush"
        @click="onPush"
      >
        <template #icon>
          <NIcon :component="ArrowUpOutline" :size="15" />
        </template>
      </NButton>
      <NDropdown
        trigger="click"
        :options="moreMenu"
        :disabled="!isGit || busy"
        @select="onMoreSelect"
      >
        <NButton size="tiny" quaternary circle :disabled="!isGit || busy" :title="t.changesMore">
          <template #icon>
            <NIcon :component="EllipsisHorizontalOutline" :size="16" />
          </template>
        </NButton>
      </NDropdown>
    </div>

    <div v-if="isGit && conflictCount > 0" class="conflict-banner">
      <span>{{ t.changesConflictBanner }} ({{ conflictCount }})</span>
      <NButton size="tiny" quaternary :disabled="busy" @click="onAbortMerge">
        {{ t.changesConflictBannerAction }}
      </NButton>
    </div>

    <NSpin :show="loading" class="body">
      <template v-if="gitUnavailable">
        <div class="empty-wrap">
          <NEmpty :description="t.gitErr_git_unavailable" size="small">
            <template #icon>
              <NIcon :component="GitCompareOutline" :size="28" />
            </template>
            <template #extra>
              <NText depth="3" style="font-size: 12px">{{ t.changesGitUnavailableHint }}</NText>
            </template>
          </NEmpty>
        </div>
      </template>
      <template v-else-if="!isGit">
        <div class="empty-wrap">
          <NEmpty :description="t.changesNotGit" size="small">
            <template #icon>
              <NIcon :component="GitCompareOutline" :size="28" />
            </template>
            <template #extra>
              <NButton
                type="primary"
                size="small"
                :loading="busy"
                :disabled="!workspace.root"
                @click="onInitGit"
              >
                {{ t.changesInitGit }}
              </NButton>
            </template>
          </NEmpty>
        </div>
      </template>
      <template v-else-if="!files.length">
        <div class="empty-wrap">
          <NEmpty :description="t.changesEmpty" size="small">
            <template #icon>
              <NIcon :component="GitCompareOutline" :size="28" />
            </template>
          </NEmpty>
        </div>
      </template>
      <div v-else class="split">
        <div class="file-list">
          <div class="list-head">
            <NCheckbox
              :checked="allChecked"
              :indeterminate="someChecked"
              size="small"
              :title="allChecked ? t.changesSelectNone : t.changesSelectAll"
              @update:checked="onToggleAll"
            />
            <NText depth="3" style="font-size: 11px">
              {{ t.changesFiles }} ({{ checkedPaths.length }}/{{ files.length }})
            </NText>
            <button
              type="button"
              class="select-all-link"
              @click="onToggleAll(!allChecked)"
            >
              {{ allChecked ? t.changesSelectNone : t.changesSelectAll }}
            </button>
          </div>
          <button
            v-for="f in files"
            :key="f.relativePath"
            type="button"
            class="file-row"
            :class="{
              active: selectedPath === f.relativePath,
              ignored: f.ignored,
              staged: f.staged,
            }"
            @click="loadDiff(f.relativePath)"
          >
            <NCheckbox
              :checked="checked[f.relativePath]"
              size="small"
              @click.stop
              @update:checked="(v) => (checked[f.relativePath] = v)"
            />
            <button
              type="button"
              class="row-stage"
              :class="{ on: f.staged }"
              :title="f.staged ? t.changesUnstage : t.changesStage"
              :disabled="busy || f.ignored"
              @click.stop="f.staged ? onUnstageFile(f) : onStageFile(f)"
            >
              <NIcon :component="GitCommitOutline" :size="13" />
            </button>
            <span class="status-badge" :class="statusClass(f.code)">{{ f.code }}</span>
            <span class="file-main">
              <span class="file-name" :title="f.relativePath">{{ fileName(f.relativePath) }}</span>
              <span class="file-dir">{{ fileDir(f.relativePath) }}</span>
            </span>
            <button
              v-if="!isConflictFile(f)"
              type="button"
              class="row-discard"
              :title="t.changesFileHistory"
              :disabled="busy"
              @click.stop="openFileLog(f.relativePath)"
            >
              <NIcon :component="TimeOutline" :size="13" />
            </button>
            <button
              v-if="!isConflictFile(f)"
              type="button"
              class="row-discard"
              :title="t.changesDiscardFile"
              :disabled="busy"
              @click.stop="onDiscardFile(f.relativePath)"
            >
              <NIcon :component="ArrowUndoOutline" :size="13" />
            </button>
            <button
              v-if="!isConflictFile(f)"
              type="button"
              class="row-discard"
              :title="f.ignored ? t.changesUnignore : t.changesIgnore"
              :disabled="busy"
              @click.stop="f.ignored ? onUnignoreFile(f) : onIgnoreFile(f)"
            >
              <NIcon :component="f.ignored ? EyeOutline : EyeOffOutline" :size="14" />
            </button>
          </button>
        </div>
        <div class="diff-pane">
          <template v-if="!selectedPath">
            <NText depth="3" style="font-size: 12px; padding: 12px">
              {{ t.changesSelectFile }}
            </NText>
          </template>
          <template v-else>
            <header class="diff-head">
              <span v-if="selectedCode" class="status-badge" :class="statusClass(selectedCode)">{{ selectedCode }}</span>
              <div class="diff-titles">
                <div class="diff-name" :title="selectedPath">{{ selectedFileName }}</div>
                <div v-if="selectedPath" class="diff-path" :title="selectedPath">{{ selectedPath }}</div>
              </div>
              <div v-if="diffStats" class="diff-stats" :title="selectedPath ?? undefined">
                <span class="add">+{{ diffStats.additions }}</span>
                <span class="del">-{{ diffStats.deletions }}</span>
              </div>
              <NButton
                v-if="!conflictPayload && selectedPath"
                size="tiny"
                quaternary
                :disabled="busy"
                :title="t.changesFileHistory"
                @click="openFileLog(selectedPath)"
              >
                <template #icon>
                  <NIcon :component="TimeOutline" :size="14" />
                </template>
                {{ t.changesFileHistory }}
              </NButton>
              <NButton
                v-if="!conflictPayload"
                size="tiny"
                quaternary
                :disabled="busy"
                :title="t.changesDiscardFile"
                @click="onDiscardFile(selectedPath)"
              >
                <template #icon>
                  <NIcon :component="ArrowUndoOutline" :size="14" />
                </template>
                {{ t.changesDiscard }}
              </NButton>
            </header>
            <ChangesConflictResolve
              v-if="conflictPayload && selectedPath"
              :file-path="selectedPath"
              :working="conflictPayload.working"
              :labels="conflictPayload.labels"
              @resolve="onConflictResolve"
              @accept-side="onConflictAcceptSide"
            />
            <template v-else>
              <NText v-if="!diffSupported || !patch" depth="3" style="font-size: 12px; padding: 12px">
                {{ t.changesNoDiff }}
              </NText>
              <div v-else class="diff-editor-wrap">
                <ChangesDiffEditor
                  v-if="showDiffEditor && selectedPath"
                  :file-path="selectedPath"
                  :old-content="oldContent"
                  :new-content="newContent"
                />
              </div>
            </template>
          </template>
        </div>
      </div>
    </NSpin>

    <div v-if="isGit" class="commit-box">
      <div class="commit-head">
        <div class="commit-summary">
          <NIcon :component="GitCommitOutline" :size="13" />
          <span>{{ t.changesCommitFiles(checkedPaths.length) }}</span>
        </div>
        <button
          type="button"
          class="commit-discard-link"
          :disabled="!canDiscardSelected || busy"
          @click="onDiscardSelected"
        >
          {{ t.changesDiscardSelected }}
        </button>
      </div>
      <NInput
        v-model:value="commitMessage"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        :placeholder="t.changesCommitPlaceholder"
        :disabled="busy"
        @keydown="onCommitKeydown"
      />
      <div class="commit-foot">
        <NText depth="3" style="font-size: 10.5px">{{ t.changesCommitEnterHint }}</NText>
        <div class="commit-actions">
          <NButton
            class="tool-btn"
            size="tiny"
            type="primary"
            :disabled="!canCommit"
            :loading="busy"
            @click="onCommit"
          >
            <template #icon>
              <NIcon :component="GitCommitOutline" :size="14" />
            </template>
            {{ t.changesCommit }}
          </NButton>
          <NButton
            class="tool-btn"
            size="tiny"
            secondary
            :disabled="!canCommit"
            :loading="busy"
            @click="onCommitAndPush"
          >
            <template #icon>
              <NIcon :component="ArrowUpOutline" :size="14" />
            </template>
            {{ t.changesCommitPush }}
          </NButton>
        </div>
      </div>
    </div>

    <NModal
      v-model:show="showRemotes"
      preset="card"
      :title="t.changesRemotes"
      style="width: min(520px, 92vw)"
      :mask-closable="true"
    >
      <div class="remote-form">
        <NInput v-model:value="remoteName" size="small" :placeholder="t.changesRemoteName" :disabled="busy" />
        <NInput v-model:value="remoteUrl" size="small" :placeholder="t.changesRemoteUrl" :disabled="busy" />
        <NButton type="primary" size="small" :disabled="busy || !remoteName.trim() || !remoteUrl.trim()" @click="onAddRemote">
          {{ t.changesRemoteSave }}
        </NButton>
      </div>
      <NEmpty v-if="!remotes.length" :description="t.changesRemoteEmpty" size="small" style="margin-top: 12px" />
      <ul v-else class="remote-list">
        <li v-for="r in remotes" :key="r.name" class="remote-item">
          <div class="remote-meta">
            <div class="remote-name">{{ r.name }}</div>
            <div class="remote-url" :title="r.fetchUrl || r.pushUrl">{{ r.fetchUrl || r.pushUrl }}</div>
          </div>
          <div class="remote-actions">
            <NButton size="tiny" quaternary :disabled="busy" @click="onEditRemote(r)">{{ t.changesRemoteEdit }}</NButton>
            <NButton size="tiny" quaternary type="error" :disabled="busy" @click="onRemoveRemote(r)">
              {{ t.changesRemoteRemove }}
            </NButton>
          </div>
        </li>
      </ul>
    </NModal>

    <NModal
      v-model:show="showLog"
      preset="card"
      :title="t.changesLog"
      style="width: min(720px, 94vw)"
      :mask-closable="true"
    >
      <!-- Commit detail: file list + reset + per-file diff -->
      <template v-if="commitDetail">
        <div class="commit-detail-head">
          <button type="button" class="commit-back" :disabled="busy" @click="closeCommitDetail">
            <NIcon :component="ChevronBackOutline" :size="14" />
            {{ t.back }}
          </button>
          <div class="commit-detail-title" :title="commitDetail.subject">
            <code class="log-hash">{{ commitDetail.shortHash }}</code>
            <span class="log-subject">{{ commitDetail.subject }}</span>
          </div>
          <div class="commit-actions">
            <NButton
              size="tiny"
              secondary
              :disabled="busy || resetting !== null"
              :loading="resetting === 'soft'"
              @click="onResetCommit('soft')"
            >
              {{ t.changesResetSoft }}
            </NButton>
            <NButton
              size="tiny"
              secondary
              type="error"
              :disabled="busy || resetting !== null"
              :loading="resetting === 'hard'"
              @click="onResetCommit('hard')"
            >
              {{ t.changesResetHard }}
            </NButton>
          </div>
        </div>
        <div class="commit-detail-meta">{{ commitDetail.author }} · {{ formatLogDate(commitDetail.date) }}</div>

        <template v-if="commitFileSelected">
          <div class="file-log-diff-head">
            <button type="button" class="file-log-back" :disabled="busy" @click="backFromCommitFileDiff">
              <NIcon :component="ChevronBackOutline" :size="14" />
              {{ t.back }}
            </button>
            <div class="file-log-diff-title" :title="commitFileSelected.path">
              <span class="file-status" :class="'st-' + commitFileSelected.status">{{ commitFileSelected.status }}</span>
              <code class="log-hash">{{ commitDetail.shortHash }}</code>
              <span class="log-subject">{{ commitFileSelected.path }}</span>
            </div>
            <div class="file-log-restore">
              <NButton
                size="tiny"
                type="warning"
                secondary
                :disabled="busy || commitFileDiffLoading"
                @click="restoreCommitFile"
              >
                <template #icon>
                  <NIcon :component="ArrowUndoOutline" :size="13" />
                </template>
                {{ t.changesRestoreToCommit }}
              </NButton>
            </div>
          </div>
          <NSpin :show="commitFileDiffLoading">
            <pre v-if="commitFileDiff" class="file-log-diff"><code><span
              v-for="(line, i) in commitFileDiff.split('\n')"
              :key="i"
              class="dline"
              :class="{
                add: line.startsWith('+') && !line.startsWith('+++'),
                del: line.startsWith('-') && !line.startsWith('---'),
                meta: line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'),
              }"
            >{{ line || ' ' }}</span></code></pre>
            <NEmpty v-else-if="!commitFileDiffLoading" :description="t.changesNoDiff" size="small" />
          </NSpin>
        </template>

        <template v-else>
          <div class="commit-files-title">{{ t.changesFilesChanged }}</div>
          <NSpin :show="commitFilesLoading">
            <NEmpty
              v-if="!commitFilesLoading && !commitFiles.length"
              :description="t.changesLogEmpty"
              size="small"
            />
            <ul v-else class="commit-files">
              <li v-for="file in commitFiles" :key="file.path" class="commit-file">
                <button
                  type="button"
                  class="commit-file-btn"
                  :disabled="busy"
                  :title="file.path"
                  @click="showCommitFileDiff(file)"
                >
                  <span class="file-status" :class="'st-' + file.status">{{ file.status }}</span>
                  <span class="file-path">{{ file.path }}</span>
                  <NIcon class="log-chevron" :component="ChevronForwardOutline" :size="13" />
                </button>
              </li>
            </ul>
          </NSpin>
        </template>
      </template>

      <!-- Commit list -->
      <NSpin v-else :show="logLoading">
        <NEmpty v-if="!logEntries.length" :description="t.changesLogEmpty" size="small" />
        <ul v-else class="log-list">
          <li v-for="entry in logEntries" :key="entry.hash">
            <button
              type="button"
              class="log-item"
              :disabled="busy"
              @click="openCommitDetail(entry)"
            >
              <code class="log-hash">{{ entry.shortHash }}</code>
              <div class="log-body">
                <div class="log-subject">{{ entry.subject }}</div>
                <div class="log-meta">{{ entry.author }} · {{ formatLogDate(entry.date) }}</div>
              </div>
              <NIcon class="log-chevron" :component="ChevronForwardOutline" :size="13" />
            </button>
          </li>
        </ul>
      </NSpin>
    </NModal>

    <NModal
      v-model:show="showFileLog"
      preset="card"
      :title="t.changesFileHistory"
      style="width: min(640px, 94vw)"
      :mask-closable="true"
    >
      <div v-if="fileLogPath" class="file-log-path" :title="fileLogPath">{{ fileLogPath }}</div>

      <template v-if="fileLogSelected">
        <div class="file-log-diff-head">
          <button type="button" class="file-log-back" :disabled="busy" @click="closeFileLogDiff">
            <NIcon :component="ChevronBackOutline" :size="14" />
            {{ t.back }}
          </button>
          <div class="file-log-diff-title" :title="fileLogSelected.subject">
            <code class="log-hash">{{ fileLogSelected.shortHash }}</code>
            <span class="log-subject">{{ fileLogSelected.subject }}</span>
          </div>
          <div class="file-log-restore">
            <NButton
              size="tiny"
              type="warning"
              secondary
              :disabled="busy || fileLogDiffLoading"
              :loading="restoringCommit"
              @click="onRestoreToCommit"
            >
              <template #icon>
                <NIcon :component="ArrowUndoOutline" :size="13" />
              </template>
              {{ t.changesRestoreToCommit }}
            </NButton>
          </div>
        </div>
        <NSpin :show="fileLogDiffLoading">
          <pre v-if="fileLogDiff" class="file-log-diff"><code><span
            v-for="(line, i) in fileLogDiff.split('\n')"
            :key="i"
            class="dline"
            :class="{
              add: line.startsWith('+') && !line.startsWith('+++'),
              del: line.startsWith('-') && !line.startsWith('---'),
              meta: line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'),
            }"
          >{{ line || ' ' }}</span></code></pre>
          <NEmpty v-else-if="!fileLogDiffLoading" :description="t.changesNoDiff" size="small" />
        </NSpin>
      </template>

      <NSpin v-else :show="fileLogLoading">
        <NEmpty v-if="!fileLogEntries.length" :description="t.changesFileLogEmpty" size="small" />
        <ul v-else class="log-list">
          <li v-for="entry in fileLogEntries" :key="entry.hash">
            <button
              type="button"
              class="log-item"
              :disabled="busy"
              :title="t.changesFileLogViewDiff"
              @click="showFileLogDiff(entry)"
            >
              <code class="log-hash">{{ entry.shortHash }}</code>
              <div class="log-body">
                <div class="log-subject">{{ entry.subject }}</div>
                <div class="log-meta">{{ entry.author }} · {{ formatLogDate(entry.date) }}</div>
              </div>
              <NIcon class="log-chevron" :component="ChevronForwardOutline" :size="13" />
            </button>
          </li>
        </ul>
      </NSpin>
    </NModal>

    <NModal
      v-model:show="showRenameBranch"
      preset="dialog"
      :title="t.changesRenameBranch"
      :positive-text="t.confirm"
      :negative-text="t.cancel"
      :positive-button-props="{ disabled: busy || !renameBranchName.trim(), loading: busy }"
      @positive-click="submitRenameBranch"
    >
      <NInput
        v-model:value="renameBranchName"
        size="small"
        :placeholder="t.changesRenameBranchPrompt"
        :disabled="busy"
        autofocus
        @keydown.enter.prevent="() => void submitRenameBranch()"
      />
    </NModal>

    <NModal
      v-model:show="showDeleteBranch"
      preset="dialog"
      :title="t.changesDeleteBranch"
      :positive-text="t.confirm"
      :negative-text="t.cancel"
      :positive-button-props="{ disabled: busy || !deleteBranchTarget, loading: busy }"
      @positive-click="submitDeleteBranch"
    >
      <NSelect
        v-model:value="deleteBranchTarget"
        size="small"
        filterable
        :placeholder="t.changesDeleteBranchPrompt"
        :options="deleteBranchOptions"
        :disabled="busy"
      />
    </NModal>

    <NModal
      v-model:show="showNewBranch"
      preset="dialog"
      :title="t.changesNewBranch"
      :positive-text="t.confirm"
      :negative-text="t.cancel"
      :positive-button-props="{ disabled: busy || !newBranchName.trim(), loading: busy }"
      @positive-click="submitNewBranch"
    >
      <NInput
        v-model:value="newBranchName"
        size="small"
        :placeholder="t.changesNewBranchPrompt"
        :disabled="busy"
        autofocus
        @keydown.enter.prevent="() => void submitNewBranch()"
      />
    </NModal>

    <NModal
      v-model:show="showMerge"
      preset="dialog"
      :title="t.changesMergeBranch"
      :positive-text="t.confirm"
      :negative-text="t.cancel"
      :positive-button-props="{ disabled: busy || !mergeTarget, loading: busy }"
      @positive-click="submitMerge"
    >
      <NSelect
        v-model:value="mergeTarget"
        size="small"
        filterable
        :placeholder="t.changesMergePrompt"
        :options="mergeBranchOptions"
        :disabled="busy"
      />
    </NModal>

    <NModal
      v-model:show="showEditRemote"
      preset="dialog"
      :title="t.changesRemoteEdit"
      :positive-text="t.confirm"
      :negative-text="t.cancel"
      :positive-button-props="{ disabled: busy || !editRemoteUrl.trim(), loading: busy }"
      @positive-click="submitEditRemote"
    >
      <div class="remote-form">
        <NText depth="3" style="font-size: 12px">{{ editRemoteName }}</NText>
        <NInput
          v-model:value="editRemoteUrl"
          size="small"
          :placeholder="t.changesRemoteUrl"
          :disabled="busy"
          autofocus
          @keydown.enter.prevent="() => void submitEditRemote()"
        />
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.changes-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tool-btn {
  font-size: 12px;
  gap: 4px;
}

.spacer {
  flex: 1;
}

.remote-count {
  margin-left: 4px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.conflict-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: #8a1f1f;
  background: color-mix(in srgb, #cf222e 12%, var(--bg));
  border-bottom: 1px solid color-mix(in srgb, #cf222e 28%, var(--border));
}

.commit-box {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated, var(--bg));
  box-shadow: var(--shadow-sm, none);
}

.commit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.commit-summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--fg-muted, #666);
  font-weight: 550;
}

.commit-discard-link {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 11px;
  color: var(--fg-muted, #666);
  cursor: pointer;
}

.commit-discard-link:hover:not(:disabled) {
  color: #c44;
  text-decoration: underline;
}

.commit-discard-link:disabled {
  opacity: 0.45;
  cursor: default;
}

.commit-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.commit-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.icon-btn {
  flex-shrink: 0;
}

.body {
  flex: 1;
  min-height: 0;
}

.body :deep(.n-spin-content) {
  height: 100%;
}

.empty-wrap {
  height: 100%;
  display: grid;
  place-items: center;
}

.split {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(190px, 36%) 1fr;
  min-height: 0;
}

.file-list {
  border-right: 1px solid var(--border);
  overflow: auto;
  min-height: 0;
}

.list-head {
  padding: 6px 8px;
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.select-all-link {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
}

.select-all-link:hover {
  text-decoration: underline;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--fg);
}

.file-row.active {
  background: color-mix(in srgb, var(--accent) 7%, var(--bg-panel));
  box-shadow: inset 2px 0 0 var(--accent);
}

.file-row:hover:not(.active) {
  background: var(--bg-hover);
}

.row-discard {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  opacity: 0;
  cursor: pointer;
  padding: 0;
}

.file-row:hover .row-discard,
.file-row.active .row-discard {
  opacity: 0.65;
}

.row-discard:hover:not(:disabled) {
  opacity: 1;
  background: var(--bg-hover);
  color: #c44;
}

.row-discard:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

.status-badge {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  font-family: var(--font-mono), monospace;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.st-modified {
  color: #0969da;
  background: rgba(9, 105, 218, 0.12);
}

.st-added {
  color: #1a7f37;
  background: rgba(26, 127, 55, 0.12);
}

.st-deleted {
  color: #cf222e;
  background: rgba(207, 34, 46, 0.12);
}

.st-renamed {
  color: #8250df;
  background: rgba(130, 80, 223, 0.12);
}

.st-untracked {
  color: #9a6700;
  background: rgba(154, 103, 0, 0.12);
}

.st-conflict {
  color: #bc4c00;
  background: rgba(188, 76, 0, 0.14);
}

.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--fg);
}

.file-dir {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--fg-faint, #999);
  font-family: var(--font-mono), monospace;
}

.diff-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  background: var(--bg-panel);
}

.diff-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg);
}

.diff-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.diff-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-path {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono), monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-stats {
  flex-shrink: 0;
  display: inline-flex;
  gap: 8px;
  font-size: 12px;
  font-family: var(--font-mono), monospace;
  font-variant-numeric: tabular-nums;
  padding-top: 2px;
}

.diff-stats .add {
  color: #1a7f37;
}

.diff-stats .del {
  color: #cf222e;
}

.diff-editor-wrap {
  flex: 1;
  min-height: 0;
}

.remote-form {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  gap: 8px;
  align-items: center;
}

.remote-list,
.log-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  max-height: min(50vh, 420px);
  overflow: auto;
}

.remote-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.remote-meta {
  flex: 1;
  min-width: 0;
}

.remote-name {
  font-size: 13px;
  font-weight: 600;
}

.remote-url {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono), monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.file-log-path {
  font-size: 11.5px;
  color: var(--fg-muted, #666);
  font-family: var(--font-mono, ui-monospace, monospace);
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: 100%;
  padding: 8px 6px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
}

.log-item:hover:not(:disabled) {
  background: var(--bg-hover, rgba(127, 127, 127, 0.06));
}

.log-chevron {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--fg-faint, #999);
  padding-top: 3px;
}

.file-log-diff-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 8px;
}

.file-log-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.file-log-back:hover:not(:disabled) {
  color: var(--fg-strong);
  border-color: var(--border-strong);
}

.file-log-diff-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-log-restore {
  flex-shrink: 0;
  margin-left: auto;
}

.file-log-diff-title .log-subject {
  font-size: 12.5px;
  flex: 1;
  min-width: 0;
}

.file-log-diff {
  margin: 0;
  padding: 8px 10px;
  max-height: min(46vh, 380px);
  overflow: auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg, #fafafa) 90%, #000 4%);
  font-size: 11.5px;
  line-height: 1.5;
  font-family: var(--font-mono, ui-monospace, Consolas, monospace);
}

.file-log-diff .dline {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
}

.file-log-diff .dline.add {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}

.file-log-diff .dline.del {
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
}

.file-log-diff .dline.meta {
  color: var(--fg-muted);
}

.log-hash {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
  padding-top: 2px;
}

.log-body {
  min-width: 0;
}

.log-subject {
  font-size: 13px;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
}

/* Commit history detail (file list / reset / per-file diff) */
.commit-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.commit-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  flex-shrink: 0;
}

.commit-back:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.commit-detail-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.commit-detail-title .log-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.commit-detail-meta {
  font-size: 11.5px;
  color: var(--fg-muted);
  margin-bottom: 10px;
}

.commit-files-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-faint, var(--fg-muted));
  margin: 8px 2px 6px;
}

.commit-files {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow: auto;
}

.commit-file-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
}

.commit-file-btn:hover {
  background: var(--bg-hover);
}

.commit-file-btn .file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.file-status {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 800;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg-muted) 12%, transparent);
}

.file-status.st-A {
  color: var(--git-u, #16a34a);
  background: color-mix(in srgb, var(--git-u, #16a34a) 14%, transparent);
}

.file-status.st-M {
  color: var(--git-m, #ca8a04);
  background: color-mix(in srgb, var(--git-m, #ca8a04) 14%, transparent);
}

.file-status.st-D {
  color: var(--git-d, #dc2626);
  background: color-mix(in srgb, var(--git-d, #dc2626) 14%, transparent);
}

.file-log-diff-head .file-status {
  margin-right: 4px;
}

/* Stage toggle + filtered (ignored) file rows */
.row-stage {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-faint, var(--fg-muted));
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--duration-fast, 140ms) var(--ease-out, ease);
}

.file-row:hover .row-stage,
.file-row.active .row-stage,
.row-stage.on {
  opacity: 1;
}

.row-stage.on {
  color: var(--accent);
}

.row-stage:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg);
}

.file-row.ignored {
  opacity: 0.55;
}

.file-row.ignored .file-name,
.file-row.ignored .file-dir {
  color: var(--fg-faint, var(--fg-muted));
}

.file-row.ignored .status-badge {
  background: color-mix(in srgb, var(--fg-muted) 8%, transparent);
  color: var(--fg-faint, var(--fg-muted));
}

.file-row.staged .status-badge {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}
</style>
