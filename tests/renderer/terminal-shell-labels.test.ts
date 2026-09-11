import { describe, expect, it } from "vitest";
import { terminalShellLabel } from "../../src/renderer/src/utils/terminal-shell-labels";
import { t } from "../../src/renderer/src/i18n";

const shell = (id: string, file: string) => ({ id, file, args: [] });

describe("terminalShellLabel", () => {
  it("shows friendly names, never the executable file name", () => {
    const pwsh = terminalShellLabel(
      shell("pwsh", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"),
    );
    expect(pwsh).toBe(t.terminalShellPwsh);
    expect(pwsh).not.toContain("pwsh.exe");
  });

  it("names every bundled Windows shell", () => {
    expect(
      terminalShellLabel(
        shell("powershell", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
      ),
    ).toBe(t.terminalShellWindowsPowerShell);
    expect(terminalShellLabel(shell("git-bash", "C:\\Program Files\\Git\\bin\\bash.exe"))).toBe(
      t.terminalShellGitBash,
    );
    expect(terminalShellLabel(shell("cmd", "C:\\Windows\\System32\\cmd.exe"))).toBe(
      t.terminalShellCmd,
    );
  });

  it("has no default suffix", () => {
    const label = terminalShellLabel(shell("pwsh", "/opt/homebrew/bin/pwsh"));
    expect(label).not.toContain("·");
    expect(label).toBe(t.terminalShellPwsh);
  });

  it("falls back to the file name for shells without a localized name", () => {
    expect(terminalShellLabel(shell("fish", "/opt/homebrew/bin/fish"))).toBe("fish");
    expect(terminalShellLabel(shell("nu", "/usr/bin/nu"))).toBe("nu");
  });
});
