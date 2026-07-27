import { app } from "electron";

/**
 * Prefer Chromium GPU compositing / raster when a discrete or integrated GPU
 * is available. Must run before app.ready. Safe no-ops on software fallback.
 */
export function enableHardwareAcceleration(): void {
  // Never call app.disableHardwareAcceleration() — keep GPU path open.
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch(
    "enable-features",
    "CanvasOopRasterization,AcceleratedVideoDecode",
  );
  // Slightly smoother scrolling on HiDPI panels
  app.commandLine.appendSwitch("enable-smooth-scrolling");
}
