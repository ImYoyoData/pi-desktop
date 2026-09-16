import { protocol, net } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { wallpaperKindForPath } from "../shared/appearance";
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

/** 壁纸协议：只服务图片/视频扩展名的本地绝对路径。 */
function handleWallpaperMedia(request: Request): Promise<Response> | Response {
  try {
    const p = new URL(request.url).searchParams.get("p");
    if (!p) return new Response("Missing path", { status: 400 });
    const absolute = path.normalize(decodeURIComponent(p));
    if (!path.isAbsolute(absolute) || !wallpaperKindForPath(absolute)) {
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
      const target = decodeURIComponent(rel);
      const absolute = path.isAbsolute(target)
        ? path.normalize(target)
        : resolveWorkspacePath(root, target);
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
