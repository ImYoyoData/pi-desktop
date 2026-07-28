import { describe, expect, it } from "vitest";
import { classifyGitFailure, isEmbeddedGitMissing } from "../../src/main/git-errors";

describe("classifyGitFailure", () => {
  it("detects missing remote from push messages", () => {
    expect(
      classifyGitFailure(
        "fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>",
      ),
    ).toBe("no_remote");
  });

  it("detects missing upstream", () => {
    expect(
      classifyGitFailure(
        "fatal: The current branch main has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin main",
      ),
    ).toBe("no_upstream");
  });

  it("detects auth failures", () => {
    expect(classifyGitFailure("fatal: Authentication failed for 'https://github.com/x/y.git/'")).toBe(
      "auth_failed",
    );
  });

  it("detects merge conflicts via dugite parser", () => {
    expect(
      classifyGitFailure("Automatic merge failed; fix conflicts and then commit the result."),
    ).toBe("conflicts");
  });

  it("detects not a repository", () => {
    expect(classifyGitFailure("fatal: not a git repository (or any of the parent directories): .git")).toBe(
      "not_repo",
    );
  });

  it("falls back to unknown", () => {
    expect(classifyGitFailure("something completely unexpected happened")).toBe("unknown");
  });
});

describe("isEmbeddedGitMissing", () => {
  it("matches dugite ENOENT packaging errors", () => {
    expect(
      isEmbeddedGitMissing(
        new Error(
          "ENOENT: Git failed to execute. This typically means that the path provided doesn't exist or that the Git executable could not be found which could indicate a problem with the packaging of dugite. Verify that resolveGitBinary returns a valid path to the git binary.",
        ),
      ),
    ).toBe(true);
    expect(isEmbeddedGitMissing(new Error("fatal: not a git repository"))).toBe(false);
  });
});
