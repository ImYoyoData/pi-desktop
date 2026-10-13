/**
 * 离线模式（PI_OFFLINE）：抑制一切主动的网络检查、刷新与安装。
 *
 * 插件安装与模型目录刷新共用此判定，避免两处实现漂移。
 */

export function isOfflineMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.PI_OFFLINE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}