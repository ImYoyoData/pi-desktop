import { describe, expect, it } from "vitest";
import { refreshWorkspaceTree } from "../../src/renderer/src/utils/files-refresh";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      readIgnored: async () => {
        calls.push("readIgnored");
        return ["dist"];
      },
      loadRoot: async () => {
        calls.push("loadRoot");
        return ["src"];
      },
      readGit: () => {
        calls.push("readGit");
        return Promise.resolve({ codes: { "a.ts": "M" } });
      },
      loadDirs: async (dirs: string[]) => {
        calls.push(`loadDirs:${dirs.join(",")}`);
        return new Map<string, string[]>();
      },
      applyIgnored: (patterns: string[]) => calls.push(`applyIgnored:${patterns.join(",")}`),
      applyRoot: (children: string[]) => calls.push(`applyRoot:${children.join(",")}`),
      applyGit: (git: { codes: Record<string, string> }) =>
        calls.push(`applyGit:${Object.keys(git.codes).length}`),
      applyDirs: (batch: Map<string, string[]>) => calls.push(`applyDirs:${batch.size}`),
    },
  };
}

describe("refreshWorkspaceTree", () => {
  it("shows the tree before git status resolves", async () => {
    const git = deferred<{ codes: Record<string, string> }>();
    const { calls, deps } = recorder();
    const run = refreshWorkspaceTree(
      { ...deps, readGit: () => (calls.push("readGit"), git.promise) },
      ["src"],
    );

    await run.tree;
    expect(calls.slice(0, 4)).toEqual([
      "readIgnored",
      "applyIgnored:dist",
      "loadRoot",
      "applyRoot:src",
    ]);
    expect(calls.indexOf("readGit")).toBeGreaterThan(calls.indexOf("applyRoot:src"));

    git.resolve({ codes: { "a.ts": "M" } });
    await run.background;
    expect(calls.slice(-3)).toEqual(["readGit", "applyGit:1", "loadDirs:src"]);
  });

  it("skips the directory batch when no expanded dir was requested", async () => {
    const { calls, deps } = recorder();
    const run = refreshWorkspaceTree(deps, []);
    await run.background;
    expect(calls).toContain("loadDirs:");
    expect(calls.some((call) => call.startsWith("applyDirs"))).toBe(false);
  });

  it("keeps the tree when the git refresh fails", async () => {
    const { calls, deps } = recorder();
    const run = refreshWorkspaceTree(
      { ...deps, readGit: () => Promise.reject(new Error("git lock")) },
      ["src"],
    );
    await expect(run.background).resolves.toBeUndefined();
    expect(calls).toEqual(["readIgnored", "applyIgnored:dist", "loadRoot", "applyRoot:src"]);
  });

  it("propagates a root listing failure to the caller", async () => {
    const { deps } = recorder();
    const run = refreshWorkspaceTree(
      {
        ...deps,
        loadRoot: async () => {
          throw new Error("no workspace");
        },
      },
      [],
    );
    await expect(run.tree).rejects.toThrow("no workspace");
    await expect(run.background).resolves.toBeUndefined();
  });
});
