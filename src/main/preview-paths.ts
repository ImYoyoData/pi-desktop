import path from "node:path";
import { isPathInsideRoot, resolveWorkspacePath } from "../shared/path-sandbox";

/**
 * 预览读取路径：绝对路径按原样（工作区外的本地文件也可预览），
 * 相对路径相对工作区解析。
 */
export function resolvePreviewReadPath(root: string, filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(root, filePath);
}

/**
 * 预览写入路径：工作区内，或 pi 用户资源目录（智能体设置页需要编辑用户级/扩展级定制文件）。
 * 兜底分支与主路径同样以工作区根为基准，避免相对路径按进程 cwd 解析。
 */
export function resolvePreviewWritePath(
  root: string,
  filePath: string,
  agentRoot: string,
): string {
  try {
    return resolveWorkspacePath(root, filePath);
  } catch (error) {
    const resolved = path.resolve(root, filePath);
    if (isPathInsideRoot(agentRoot, resolved)) return resolved;
    throw error;
  }
}
