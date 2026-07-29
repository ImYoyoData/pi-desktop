/** Shared Git IPC result types (main ↔ preload ↔ renderer). */

export type GitErrorCode =
  | "not_repo"
  | "no_remote"
  | "no_upstream"
  | "auth_failed"
  | "conflicts"
  | "not_fast_forward"
  | "nothing_to_commit"
  | "branch_exists"
  | "local_changes"
  | "network"
  | "remote_not_found"
  | "remote_exists"
  | "invalid_args"
  | "git_unavailable"
  | "unknown";

export type GitOpResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; code: GitErrorCode };

export type GitRemote = {
  name: string;
  fetchUrl: string;
  pushUrl: string;
};

export type GitLogEntry = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type GitLogResult = {
  entries: GitLogEntry[];
};

export type GitConflictContentResult =
  | {
      supported: true;
      working: string;
      ours: string;
      theirs: string;
      labels: { ours: string; theirs: string };
    }
  | { supported: false; reason?: "too_large" | "binary" | "not_found" | "not_repo" };
