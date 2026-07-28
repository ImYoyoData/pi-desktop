# Pi Desktop — Security Settings Design

**Date:** 2026-07-28  
**Status:** Approved for planning  
**Product:** Desktop Agent Workspace security (project trust + tool approval)

## Goal

Align Pi Desktop with Pi SDK workspace-trust semantics, and add Desktop security settings for per-category tool approval (`bash` / write / network), a bash command allowlist, and an in-chat permission confirmation strip — without bypassing kernel trust, path isolation, or letting the Agent mutate the trust list.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Scope | Project trust **and** command allowlist **and** execution modes |
| Approval model | Per tool category (Cursor-style), not a single global switch |
| Categories (v1) | `bash`, `write` (edit/write tools), `network` (reserve if no dedicated tool yet) |
| Trust UX | Dialog on open when workspace has trust-requiring resources and is untrusted |
| Settings storage | Global `~/.pi/agent/settings.json` field `desktopSecurity` |
| Trust storage | Official `~/.pi/agent/trust.json` via SDK `ProjectTrustStore` only |
| Ask UI | Chat bottom confirmation strip (like ask_user strip) |
| Defaults | All three categories `ask`; empty bash allowlist |
| Interception | Agent-worker gate (`beforeToolCall` + bash exec wrapper); IPC to renderer |
| Approach | Worker intercept + Desktop settings UI (not a Pi extension UI path) |

## Constraints (non-negotiable)

1. Two-level dirs: global `~/.pi/agent`, project `./.pi/`. Static texts (e.g. `AGENTS.md`) always load; extensions, skills, local settings only when **trusted**.
2. Trust state is controlled by `~/.pi/agent/trust.json`. Headless/SDK path has no interactive CLI popup — Desktop supplies the dialog. Untrusted ⇒ disable high-risk project resources. Agent must not modify the trust list; guide users to trust via UI (equivalent to `/trust` / `--approve`).
3. File/bash/network actions go through permission review; with no allow policy and no UI answer ⇒ deny. Workspace cwd path isolation remains; no out-of-tree access.
4. Prefer diagnosing trust first when features fail; on permission deny stop retrying, explain limits, and offer remediations.
5. Never bypass trust checks, tamper with trust files outside explicit user actions, or break path isolation.
6. `auth.json` remains global-only.

## Architecture

```text
Open Folder
  → resolve trust (ProjectTrustStore + trust-requiring resources)
  → if untrusted + needs trust → TrustDialog (trust / distrust / later)
  → createAgentSessionServices({ projectTrusted })

Tool about to run (worker)
  → classify: bash | write | network | other
  → load desktopSecurity + session temporary allows
  → allow / allowlist hit → execute
  → ask → IPC PermissionRequest → PermissionStrip → allow once | allow category (session) | deny
  → deny → tool error with clear reason (no auto-retry bypass)
```

### Components

| Unit | Responsibility |
|------|----------------|
| Trust resolve on workspace open | Read `trust.json`, detect trust-requiring project resources, show dialog, write user choice |
| `SecuritySettings` panel | Edit `desktopSecurity`, show trust status, trust/untrust current workspace |
| Settings I/O | Read/merge/write `desktopSecurity` in `~/.pi/agent/settings.json`; notify live workers |
| Permission gate (worker) | Classify tools, apply mode + bash allowlist, block or await UI |
| `PermissionStrip` (renderer) | Bottom bar: allow once / allow category this session / deny |
| Session temp allows | In-memory map per session; cleared on session end / app restart |

## Settings shape

Stored under global `~/.pi/agent/settings.json`:

```json
{
  "desktopSecurity": {
    "bash": "ask",
    "write": "ask",
    "network": "ask",
    "bashAllowlist": ["git status", "git diff", "npm test"]
  }
}
```

- Each of `bash` | `write` | `network`: `"ask"` | `"allow"`.
- Defaults when missing: all `"ask"`, `bashAllowlist: []`.
- CLI ignores unknown fields; Desktop owns `desktopSecurity`.
- Settings page offers “set all to ask” / “set all to allow” plus per-category overrides.

### Category mapping

| Key | Tools |
|-----|--------|
| `bash` | `bash` / equivalent shell tools |
| `write` | `edit`, `write`, and other workspace-mutating file tools |
| `network` | Tools with network side effects when present; if none in this SDK build, UI shows reserved/disabled with explanation |

### Bash allowlist

- Applies only when `bash === "ask"`: after trim, **prefix match** (e.g. `git status` matches `git status --short`).
- When `bash === "allow"`, allowlist is display-only (no extra restriction).
- No arbitrary regex in v1.

## Trust UX

1. On open folder: if path (or ancestor) not trusted in `trust.json` **and** project has trust-requiring resources → show dialog once.
2. **Trust:** write `true`, create/reload services with `projectTrusted: true`.
3. **Don't trust:** write `false`, run with project extensions/skills/local settings disabled; static texts still load.
4. **Later:** this session untrusted, do not write; ask again next open.
5. Security settings show current workspace trust + one-click trust/untrust (user-only writes to `trust.json`).
6. Desktop must stop defaulting `projectTrusted: true` when trust is unresolved.

## Permission strip

- Distinct from `ask_user` (copy and IPC kind differ); same bottom-of-chat placement.
- Shows tool name + short summary (command or file path).
- Actions: **Allow once** | **Allow this category for this session** | **Deny**.
- Deny ⇒ tool returns explicit failure; Agent/UI must not loop retries to bypass; message points to Security settings / trust.

## Error handling

| Case | Behavior |
|------|----------|
| Untrusted ⇒ skills/extensions missing | Explain untrusted workspace; offer Trust |
| Tool blocked (ask, user denied) | Surface deny reason; stop; link to Security |
| Tool blocked (no UI / timeout) | Treat as deny |
| Allowlist miss under ask | Show permission strip |
| settings.json corrupt/partial | Fall back to secure defaults (all ask) |
| Network category with no tool | UI reserved; no fake interception |

## Acceptance criteria

1. Opening an untrusted folder with `.pi` trust-requiring resources shows the trust dialog; Trust loads project resources; Don't trust does not.
2. Settings → Security edits bash/write/network modes and bash allowlist; persists to `~/.pi/agent/settings.json`.
3. Defaults are all `ask`; ask mode shows bottom strip with once / session category / deny.
4. Under bash `ask`, allowlist prefix hits skip the strip; deny fails the tool without bypass retries.
5. Agent cannot modify `trust.json`; failures preferentially mention trust and security settings.

## Non-goals (v1)

- Full OS/container sandbox or per-path ACL beyond existing cwd isolation
- Per-builtin-tool toggles beyond bash / write / network
- Rewriting Pi kernel trust or bypassing path isolation
- Pretending to gate network when no network tool exists in the SDK build
- Pi extension-based `ui.confirm` path (Desktop wires its own IPC strip instead)

## Implementation notes

- Prefer `beforeToolCall` for classification; wrap `BashOperations.exec` as a second line for bash.
- Hot-reload `desktopSecurity` into running workers after settings save (no need to rewrite trust).
- After trust change, recreate session services so `projectTrusted` takes effect.
- Reuse patterns from existing ask_user IPC (worker → main → renderer → reply), with a dedicated permission channel/payload.
