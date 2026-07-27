import { protocol, net } from "electron";
import { pathToFileURL } from "node:url";
import { resolveWorkspacePath } from "../shared/path-sandbox";
import { getWorkspace } from "./workspace-ipc";

/** Must run before app.ready. */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "pi-local",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Serve workspace-relative files for <video>/<audio>/<img> (after app.ready). */
export function installLocalFileProtocol(): void {
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
      const absolute = resolveWorkspacePath(root, decodeURIComponent(rel));
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
