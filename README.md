# Workbench

Workbench is a local-first repo console for coding sessions.

It is not trying to be a full IDE. The current product shape is:

- a persistent JavaScript session
- typed local tools
- repo-aware helpers
- structured shell and git results
- repeatable session bootstrap files
- proof-round artifacts that make an investigation auditable
- named session snapshots
- terminal commands for audit inspection and session management

The important architectural constraint is that Workbench does not spawn child processes directly. Shell execution is a host capability. The runtime consumes a host-provided shell runner instead of binding itself to `child_process`.

## Current State

The repo now has a complete first product slice:

- CLI entrypoint and REPL loop
- persistent in-process session state for globals and history during a run
- named session save/load under `~/.workbench/sessions/`
- workspace detection and helper globals
- `setRepo()`, `gitStatus()`, `npmScript()`, `npmTest()`, `preflight()`, `summarizeStatus()`, `repoAudit()`, and `testOrExplain()`
- user-global and repo-local bootstrap loading
- `workbench proof` artifact generation
- `workbench proof list` summaries
- tool-boundary audit logging
- REPL slash commands and improved CLI result rendering
- Node-based automated tests for runtime globals, bootstrap loading, proof flow, persistence, audit logging, and shell policy

Still missing from the broader vision:

- repo registry
- project-relative path helpers
- multi-repo awareness
- plugin API for globals and tools
- TUI polish
- stronger confirmation policy beyond the current non-interactive shell guard

## Product Shape

Workbench has five layers:

1. `runtime`
   A persistent JS session that owns globals, history, and session state.
2. `tools`
   Typed capabilities exposed to the runtime such as shell, fs, git, http, and project inspection.
3. `workspace`
   Repo detection, package-manager detection, path resolution, and project metadata.
4. `bootstrap`
   User-global and repo-local startup files that register helpers and defaults.
5. `ui`
   A terminal-first interaction surface with commands, history, and structured output.

## CLI Shape

```text
workbench
workbench --repo C:\path\to\repo
workbench eval "await repoAudit()"
workbench proof --repo C:\path\to\repo
workbench proof list
workbench sessions save my-session
workbench sessions load my-session
workbench audit --limit 20
```

## REPL Commands

The REPL now supports slash commands in addition to plain JavaScript:

- `/help`
- `/globals`
- `/session`
- `/repo <path>`
- `/save <name>`
- `/load <name>`
- `/audit [limit]`
- `/exit`

## Canonical Proof Round

The deterministic flow is `proof`:

```text
workbench --host .\dist\host\node-child-process-runner.js proof --repo C:\path\to\repo --search todo
```

It runs one bounded sequence and emits a JSON artifact with:

- workspace detection
- bootstrap inventory
- root file listing
- likely entrypoint detection
- `repoAudit()`
- `testOrExplain()`
- raw shell verification commands like `git status --short`
- optional targeted search

Artifacts are written outside the inspected repo by default under `~/.workbench/proof-rounds/`.

## Runtime Globals

Current built-in globals:

- `wb`
- `cwd`
- `repo`
- `setRepo()`
- `run()`
- `read()`
- `json()`
- `ls()`
- `exists()`
- `head()`
- `tail()`
- `findText()`
- `git()`
- `gitStatus()`
- `npmScript()`
- `npmTest()`
- `assert()`
- `test()`
- `preflight()`
- `summarizeStatus()`
- `repoAudit()`
- `testOrExplain()`
- `replHelp()`

## Host-Provided Shell Runner

Current contract:

```ts
export interface ShellArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  allowDestructive?: boolean;
}

export interface ShellData {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

export type HostShellRunner = (args: ShellArgs) => Promise<ShellData>;
```

Workbench applies a best-effort non-interactive policy before invoking the host runner. It blocks obvious destructive commands, risky pipe-to-shell flows, and dynamic evaluation commands unless `allowDestructive: true` is set explicitly.

## Audit Log

Tool executions can be written to:

- `~/.workbench/audit-log.jsonl`

The CLI surface for inspection is:

```text
workbench audit --limit 20
```

In a standalone build without a host shell runner, failed shell attempts still appear in the audit log, which makes the execution policy visible rather than silent.

## Session Persistence

Named session snapshots are stored under:

- `~/.workbench/sessions/`

The persisted snapshot currently includes:

- `cwd`
- `repo`
- `history`

This is intentionally conservative. Workbench does not try to serialize arbitrary globals or functions.

## Running Tests

```powershell
npm test
```

This runs:

- main TypeScript typecheck
- a separate TypeScript compile for `tests/`
- emitted `node:test` files from `dist-test/tests/`

## Product Notes

The proof loop remains the clearest wedge, but the project now has enough persistence, policy, auditability, and terminal surface area to feel like a real product candidate rather than just a proof harness.

If the product is going to win, it still needs to become excellent at a narrow job:

- durable repo investigation with repeatable artifacts and host-mediated execution you can trust
