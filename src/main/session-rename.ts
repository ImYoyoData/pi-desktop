export async function renameSessionFile(filePath: string, name: string): Promise<void> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const sm = SessionManager.open(filePath);
  sm.appendSessionInfo(name.trim());
}
