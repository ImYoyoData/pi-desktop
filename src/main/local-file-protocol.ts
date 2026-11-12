import { protocol, net } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isFontFilePath, wallpaperKindForPath } from "../shared/appearance";
import { isPathInsideRoot, resolveWorkspacePath } from "../shared/path-sandbox";
import { agentDir } from "./agent-dir";
import { getWorkspace } from "./workspace-ipc";

/**
 * pi-local 额外放行的目录（工作区之外）。
 *
 * 工作区外的预览文档需要加载同目录的图片/视频；这里只放行主进程确实读过、
 * 并交给界面展示的目录，而不是任意绝对路径 —— 否则这条协议就是一台
 * "任意本地文件读取器"（渲染层一旦被注入就能读 ~/.ssh 之类）。
 */
const EXTRA_MEDIA_ROOTS = new Set<string>();
const MAX_EXTRA_MEDIA_ROOTS = 32;

/** 登记一个刚被主进程读取、允许渲染层加载其媒体资源的目录。 */
export function allowLocalMediaPath(filePath: string): void {
	const dir = path.dirname(path.resolve(filePath));
	if (EXTRA_MEDIA_ROOTS.has(dir)) return;
	while (EXTRA_MEDIA_ROOTS.size >= MAX_EXTRA_MEDIA_ROOTS) {
		const oldest = EXTRA_MEDIA_ROOTS.values().next().value;
		if (oldest === undefined) break;
		EXTRA_MEDIA_ROOTS.delete(oldest);
	}
	EXTRA_MEDIA_ROOTS.add(dir);
}

/** 把请求里的路径解析成允许读取的绝对路径；越界或未登记返回 null。 */
function resolveLocalMediaPath(raw: string): string | null {
	const root = getWorkspace();
	if (!root) return null;
	try {
		// 工作区内（相对地址，或绝对地址但落在工作区里）：交给沙箱校验。
		return resolveWorkspacePath(root, raw);
	} catch {
		// 工作区外：继续按白名单检查。
	}
	if (!path.isAbsolute(raw)) return null;
	const absolute = path.resolve(raw);
	// 会话附件（`<session>.jsonl.attachments`）与自定义字体都在 agent 目录下。
	if (isPathInsideRoot(agentDir(), absolute)) return absolute;
	for (const dir of EXTRA_MEDIA_ROOTS) {
		if (isPathInsideRoot(dir, absolute)) return absolute;
	}
	return null;
}

const SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  bypassCSP: true,
  corsEnabled: true,
} as const;

/** Must run before app.ready. */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "pi-local", privileges: { ...SCHEME_PRIVILEGES } },
    { scheme: "pi-media", privileges: { ...SCHEME_PRIVILEGES } },
  ]);
}

/** 壁纸协议：只服务图片/视频/字体扩展名的本地绝对路径。 */
function handleWallpaperMedia(request: Request): Promise<Response> | Response {
  try {
    // searchParams 已经解码过一次，再解一次会把文件名里的 % 打成非法序列。
    const p = new URL(request.url).searchParams.get("p");
    if (!p) return new Response("Missing path", { status: 400 });
    const absolute = path.normalize(p);
    if (
      !path.isAbsolute(absolute) ||
      (!wallpaperKindForPath(absolute) && !isFontFilePath(absolute))
    ) {
      return new Response("Unsupported media path", { status: 400 });
    }
    return net.fetch(pathToFileURL(absolute).href);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 400 });
  }
}

/** Serve workspace-relative files for <video>/<audio>/<img> (after app.ready). */
export function installLocalFileProtocol(): void {
  protocol.handle("pi-media", handleWallpaperMedia);

  protocol.handle("pi-local", (request) => {
    try {
      const url = new URL(request.url);
      const rel = url.searchParams.get("p");
      if (!rel) {
        return new Response("Missing path", { status: 400 });
      }
      const root = getWorkspace();
      if (!root) {
        return new Response("No workspace", { status: 404 });
      }
      const absolute = resolveLocalMediaPath(rel);
      if (!absolute) {
        return new Response("Path not allowed", { status: 403 });
      }
      return net.fetch(pathToFileURL(absolute).href);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 400 });
    }
  });
}

/** Build a renderer-safe URL for a workspace-relative path. */
export function localMediaSrc(relativePosix: string): string {
  return `pi-local://media/?p=${encodeURIComponent(relativePosix)}`;
}
