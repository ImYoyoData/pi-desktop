import { GitError, parseError } from "dugite";
import type { GitErrorCode } from "../shared/git-types";

/**
 * Map dugite/Git stderr into a stable error code for UI localization.
 * Prefer dugite's parser; fall back to common CLI message patterns.
 */
export function classifyGitFailure(stderr: string, stdout = ""): GitErrorCode {
  const text = `${stderr}\n${stdout}`.trim();
  const dugiteErr = parseError(stderr) ?? (stdout ? parseError(stdout) : null);

  if (dugiteErr != null) {
    switch (dugiteErr) {
      case GitError.NotAGitRepository:
        return "not_repo";
      case GitError.HTTPSAuthenticationFailed:
      case GitError.SSHAuthenticationFailed:
      case GitError.SSHPermissionDenied:
      case GitError.SSHKeyAuditUnverified:
        return "auth_failed";
      case GitError.MergeConflicts:
      case GitError.RebaseConflicts:
      case GitError.UnresolvedConflicts:
      case GitError.ConflictModifyDeletedInBranch:
      case GitError.RevertConflicts:
        return "conflicts";
      case GitError.PushNotFastForward:
        return "not_fast_forward";
      case GitError.NothingToCommit:
        return "nothing_to_commit";
      case GitError.BranchAlreadyExists:
        return "branch_exists";
      case GitError.LocalChangesOverwritten:
      case GitError.MergeWithLocalChanges:
      case GitError.RebaseWithLocalChanges:
        return "local_changes";
      case GitError.HTTPSRepositoryNotFound:
      case GitError.SSHRepositoryNotFound:
        return "remote_not_found";
      case GitError.HostDown:
      case GitError.RemoteDisconnection:
        return "network";
      case GitError.NoMatchingRemoteBranch:
      case GitError.NoExistingRemoteBranch:
        return "no_upstream";
      case GitError.RemoteAlreadyExists:
        return "remote_exists";
      case GitError.BadConfigValue:
      case GitError.BadRevision:
      case GitError.InvalidMerge:
      case GitError.InvalidRebase:
      case GitError.InvalidObjectName:
      case GitError.InvalidRefLength:
      case GitError.HexBranchNameRejected:
      case GitError.EmptyRebasePatch:
      case GitError.CannotMergeUnrelatedHistories:
      case GitError.NonFastForwardMergeIntoEmptyHead:
      case GitError.PatchDoesNotApply:
      case GitError.BranchDeletionFailed:
      case GitError.DefaultBranchDeletionFailed:
      case GitError.BranchRenameFailed:
      case GitError.PathDoesNotExist:
      case GitError.PathExistsButNotInRef:
      case GitError.OutsideRepository:
      case GitError.LockFileAlreadyExists:
      case GitError.ConfigLockFileAlreadyExists:
      case GitError.NoMergeToAbort:
      case GitError.NoSubmoduleMapping:
      case GitError.SubmoduleRepositoryDoesNotExist:
      case GitError.InvalidSubmoduleSHA:
      case GitError.LocalPermissionDenied:
      case GitError.LFSAttributeDoesNotMatch:
      case GitError.GPGFailedToSignData:
      case GitError.PushWithFileSizeExceedingLimit:
      case GitError.ForcePushRejected:
      case GitError.ProtectedBranchRequiresReview:
      case GitError.ProtectedBranchForcePush:
      case GitError.ProtectedBranchDeleteRejected:
      case GitError.ProtectedBranchRequiredStatus:
      case GitError.PushWithPrivateEmail:
      case GitError.TagAlreadyExists:
      case GitError.MergeCommitNoMainlineOption:
      case GitError.UnsafeDirectory:
      case GitError.PushWithSecretDetected:
        return "unknown";
      default: {
        const _exhaustive: never = dugiteErr;
        void _exhaustive;
        return "unknown";
      }
    }
  }

  if (/has no upstream branch|no upstream configured|set a remote tracking branch|there is no tracking information|set the remote as upstream/i.test(text)) {
    return "no_upstream";
  }
  if (
    /no configured push destination|does not appear to have a remote repository|no remote repository specified|remote origin does not exist|please specify which remote/i.test(
      text,
    )
  ) {
    return "no_remote";
  }
  if (
    /authentication failed|permission denied \(publickey\)|could not read username|invalid credentials|terminal prompts disabled|support for password authentication was removed/i.test(
      text,
    )
  ) {
    return "auth_failed";
  }
  if (/conflict|needs merge|unmerged paths|fix all conflicts|merging is not possible/i.test(text)) {
    return "conflicts";
  }
  if (/not a git repository/i.test(text)) {
    return "not_repo";
  }
  if (/could not resolve host|failed to connect|network is unreachable|connection timed out/i.test(text)) {
    return "network";
  }
  if (/remote .+ already exists/i.test(text)) {
    return "remote_exists";
  }

  return "unknown";
}

/** dugite packaging miss — binary path resolves but file is gone, or ENOENT on spawn. */
export function isEmbeddedGitMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Git failed to execute|Git executable could not be found|resolveGitBinary|ENOENT: Git failed/i.test(
    msg,
  );
}

export function detailFromGitOutput(stderr: string, stdout = ""): string {
  const detail = (stderr || stdout).trim();
  if (!detail) return "";
  // Keep UI toast readable; full text stays available for "unknown".
  const lines = detail.split(/\r?\n/).filter(Boolean);
  return lines.slice(0, 8).join("\n");
}
