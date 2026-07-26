import { SessionManager } from "@earendil-works/pi-coding-agent";

export function renameSessionFile(filePath: string, name: string): void {
  const sm = SessionManager.open(filePath);
  sm.appendSessionInfo(name.trim());
}
