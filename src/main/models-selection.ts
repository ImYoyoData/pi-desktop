/**
 * Persists the desktop-side model curation (`~/.config/…/models-selection.json`).
 *
 * Kept out of `models.json` on purpose: that file is shared with the `pi` CLI and
 * pi-web, and Pi validates provider entries — a GUI-only preference does not
 * belong there.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

import {
  EMPTY_MODEL_SELECTION,
  parseModelSelection,
  type ModelSelection,
} from "../shared/model-selection";

let cache: ModelSelection | null = null;

function storePath(): string {
  return join(app.getPath("userData"), "models-selection.json");
}

export function readModelSelection(): ModelSelection {
  if (cache) return cache;
  try {
    cache = parseModelSelection(JSON.parse(readFileSync(storePath(), "utf8")));
  } catch {
    cache = { ...EMPTY_MODEL_SELECTION, providers: {} };
  }
  return cache;
}

export function writeModelSelection(next: ModelSelection): ModelSelection {
  const parsed = parseModelSelection(next);
  cache = parsed;
  try {
    const file = storePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (err) {
    console.warn("[models-selection] failed to persist", err);
  }
  return parsed;
}
