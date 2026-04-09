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
- explicit confirmation for risky shell commands
- repo registry and project-relative helpers
- terminal commands for audit inspection, session management, and repo navigation

The important architectural constraint is that Workbench does not spawn child processes directly. Shell execution is a host capability. The runtime consumes a host-provided shell runner instead of binding itself to `child_process`.

## Current State

The repo now has a complete first product slice plus the first trust/navigation follow-up:

- CLI entrypoint and REPL loop
- persistent in-process session state for globals and history during a run
- named session save/load under `~/.workbench/sessions/`
- workspace detection and helper globals
- `setRepo()`, `gitStatus()`, `npmScript()`, `npmTest()`, `preflight()`, `summarizeStatus()`, `repoAudit()`, and `testOrExplain()`
- user-global and repo-local bootstrap loading
- `workbench proof` artifact generation
- `workbench proof list` summaries
- tool-boundary audit logging
- shell policy with `safe`, `confirm`, and `blocked` decisions
- interactive confirmation retry for confirmable risky shell commands
- repo registry via `workbench repos` and `/save-repo`
- REPL slash commands and improved CLI result rendering
- Node-based automated tests for runtime globals, bootstrap loading, proof flow, persistence, audit logging, shell policy, repo registry, and CLI rendering

Still missing from the broader vision:

- multi-repo awareness
- plugin API for globals and tools
- TUI polish
- stronger policy semantics beyond the current command classifier and confirmation token flow

## Product Shape

Workbench has five layers:

1. `runtime`
   A persistent JS session that owns globals, history, and session state.
2. `tools`
   Typed capabilities exposed to the runtime such as shell, fs, git, http, and project inspection.
3. `workspace`
   Repo detection, registry, path resolution, and project metadata.
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
workbench repos list
workbench repos add my-repo C:\path\to\repo
workbench audit --limit 20
```

## REPL Commands

The REPL now supports slash commands in addition to plain JavaScript:

- `/help`
- `/globals`
- `/session`
- `/repos`
- `/repo <path-or-name>`
- `/save-repo <name> [path]`
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
- `runConfirmed()`
- `confirmationToken()`
- `read()`
- `json()`
- `ls()`
- `exists()`
- `head()`
- `tail()`
- `findText()`
- `registerRepo()`
- `listRepos()`
- `projectPath()`
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
  confirmationToken?: string;
}

export interface ShellData {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

export type HostShellRunner = (args: ShellArgs) => Promise<ShellData>;
```

Workbench applies a best-effort command policy before invoking the host runner. Commands are classified as `safe`, `confirm`, or `blocked`. Confirmable commands require both `allowDestructive: true` and a matching `confirmationToken`.

## Audit Log

Tool executions can be written to:

- `~/.workbench/audit-log.jsonl`

The CLI surface for inspection is:

```text
workbench audit --limit 20
```

In a standalone build without a host shell runner, failed shell attempts still appear in the audit log, which makes the execution policy visible rather than silent.

Audit entries now include policy and confirmation state when relevant, for example:

```text
2026-04-09T08:14:27.476Z shell error:confirmation_required policy:confirm confirmed:no {"command":"git reset --hard","cwd":"C:\\dev\\repos\\workbench","timeoutMs":20000}
```

## Repo Registry

Registered repos are stored under:

- `~/.workbench/repos.json`

Current helpers and commands:

- `workbench repos list`
- `workbench repos add <name> <path>`
- `/repos`
- `/save-repo <name> [path]`
- `registerRepo(name, repoPath?)`
- `listRepos()`
- `projectPath(...segments)`

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
- exact-string render coverage for the CLI help and terminal output surface

## Product Notes

The proof loop remains the clearest wedge, but the project now has enough persistence, policy, auditability, navigation, and terminal surface area to feel like a real product candidate rather than just a proof harness.

If the product is going to win, it still needs to become excellent at a narrow job:

- durable repo investigation with repeatable artifacts and host-mediated execution you can trust
