import { app } from "electron";

/**
 * Prefer Chromium GPU compositing / raster when available.
 * Must run before app.ready. On macOS keep flags minimal — aggressive
 * switches (zero-copy / ignore-blocklist) have caused black windows on some Macs.
 */
export function enableHardwareAcceleration(): void {
  // Never call app.disableHardwareAcceleration() — keep GPU path open.
  app.commandLine.appendSwitch("enable-smooth-scrolling");

  if (process.platform === "darwin") {
    return;
  }

  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch(
    "enable-features",
    "CanvasOopRasterization,AcceleratedVideoDecode",
  );
}
