import { protocol, net } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isFontFilePath, wallpaperKindForPath } from "../shared/appearance";
import { resolveWorkspacePath } from "../shared/path-sandbox";
import { getWorkspace } from "./workspace-ipc";

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
      const absolute = path.isAbsolute(rel)
        ? path.normalize(rel)
        : resolveWorkspacePath(root, rel);
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
