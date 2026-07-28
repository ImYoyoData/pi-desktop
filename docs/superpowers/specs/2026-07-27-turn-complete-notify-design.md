# Turn-complete notify — Design

**Date:** 2026-07-27  
**Status:** Approved  
**Product:** Pi Desktop

## Goal

When an agent turn finishes (`prompt_done`), optionally play a built-in chime and/or show a system notification if the app window is not focused.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Foreground | Sound only (no system notification) |
| Background | System notification if enabled; sound if sound enabled |
| Settings | Two independent toggles (default **on**) |
| Sound file | Bundle `qipao.mp3` into the app (from user-provided asset) |
| Trigger | `prompt_done` only (not `prompt_error`) |

## Behavior

1. On `prompt_done` for any session:
   - If **sound** on → play bundled `qipao.mp3` once (renderer `Audio`)
   - If **notification** on **and** main window not focused → Electron `Notification` (title + short body)
2. Settings →「通知」: toggles + 试听 button
3. Prefs in `localStorage` (`pi-desktop:notify-prefs`)

## Non-goals (v1)

- Custom sound picker  
- Notify on errors  
- Thinking-stream UI (separate feature)

## Test plan

- Toggle sound off → no audio on complete  
- Focused window → no OS notification  
- Unfocused + notify on → OS toast  
- 试听 plays chime  
