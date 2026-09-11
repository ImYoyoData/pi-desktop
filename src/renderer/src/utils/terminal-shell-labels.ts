import type { TerminalShellOption } from "../../../shared/protocol";
import { t } from "@renderer/i18n";

/** 下拉菜单展示名。可执行文件名是实现细节，只有未收录的 shell 才回退到文件名。 */
export function terminalShellLabel(shell: TerminalShellOption): string {
  switch (shell.id) {
    case "pwsh":
      return t.terminalShellPwsh;
    case "powershell":
      return t.terminalShellWindowsPowerShell;
    case "git-bash":
      return t.terminalShellGitBash;
    case "cmd":
      return t.terminalShellCmd;
    default:
      return shell.file.replace(/\\/g, "/").split("/").pop() ?? shell.file;
  }
}
