# Workbench

Workbench is a local-first persistent repo console for coding sessions.

It is not trying to be a full IDE. It is trying to make a coding session feel programmable, durable, and inspectable:

- a persistent JavaScript session
- typed local tools
- repo-aware helpers
- structured shell and git results
- repeatable session bootstrap files

The important architectural constraint is that Workbench should not assume it can spawn child processes directly. Shell execution is a host capability. The session runtime consumes a host-provided shell runner instead of binding itself to Node's `child_process`.

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

## MVP Goals

The first useful version should do these well:

- open a persistent session in a repo
- bind the session to a default repo with `setRepo()`
- run shell commands with structured results
- inspect repo health with `preflight()`, `summarizeStatus()`, and `repoAudit()`
- run real project tests with `testOrExplain()`
- save and load named sessions

## Example User Flow

```ts
await startSession("C:\\dev\\repos\\dotfiles");
await gitStatus();
await repoAudit();
await testOrExplain();
```

## CLI Shape

```text
workbench
workbench --repo C:\path\to\repo
workbench proof list
workbench eval "await repoAudit()"
workbench --host .\dist\host\node-child-process-runner.js proof --repo C:\path\to\repo
workbench sessions save my-session
workbench sessions load my-session
workbench doctor
```

## Canonical Proof Round

The first deterministic flow is the `proof` command:

```text
workbench --host .\dist\host\node-child-process-runner.js proof --repo C:\path\to\repo --search todo
```

It runs one bounded sequence and emits a single JSON artifact:

- workspace detection
- bootstrap inventory
- root file listing
- likely entrypoint detection
- `repoAudit()`
- `testOrExplain()`
- raw shell verification commands like `git status --short`
- optional targeted search

The artifact includes:

- resolved inputs
- loaded bootstraps
- files inspected
- commands attempted
- ordered step results
- findings
- blockers
- recommended next action
- overall status

By default, the artifact is written outside the target repo under `~/.workbench/proof-rounds/` so the proof round does not dirty the repo it is inspecting. You can still pass `--output` explicitly when you want the file somewhere else.

Use `workbench proof list` to summarize the artifacts already written under `~/.workbench/proof-rounds/`.

## Runtime Globals

The first built-in globals should be:

- `wb`
- `cwd`
- `repo`
- `setRepo()`
- `run()`
- `read()`
- `write()`
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

## Seams

The product should stay disciplined about seams:

- runtime vs tools
- tool interface vs tool implementation
- workspace detection vs domain logic
- raw command output vs structured domain objects
- bootstrap wiring vs helper behavior

Those seams make the codebase sliceable and testable.

### Host-Provided Shell Runner

The shell bridge is intentionally host-driven:

- Workbench runtime asks for shell execution through a typed runner contract.
- A host environment is responsible for implementing that runner.
- In a standalone Node build, the shell runner may be unavailable or replaced by an adapter.

Current contract:

```ts
export interface ShellArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface ShellData {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

export type HostShellRunner = (args: ShellArgs) => Promise<ShellData>;
```

This keeps Workbench compatible with environments where the host already owns execution policy, sandboxing, approvals, or remote tool dispatch.

Host modules can be loaded explicitly by the CLI:

```text
workbench --host .\examples\mock-shell-host.mjs
workbench --host .\dist\host\node-child-process-runner.js --repo C:\path\to\repo
```

Supported host module exports:

- `createShellRunner()`
- `shellRunner`
- default export of type `HostShellRunner`

The included example host at [mock-shell-host.mjs](C:\Users\cduff\workbench\examples\mock-shell-host.mjs) is intentionally fake. It proves the adapter seam without requiring real subprocess execution. The Node child-process host at [node-child-process-runner.ts](C:\Users\cduff\workbench\src\host\node-child-process-runner.ts) is an example of a real host implementation for environments where subprocess execution is allowed.

There is also an HTTP-backed host adapter at [http-shell-host.mjs](C:\Users\cduff\workbench\src\host\http-shell-host.mjs) plus companion local host servers:

- [workbench-shell-host.ps1](C:\Users\cduff\workbench\scripts\workbench-shell-host.ps1)
- [workbench_shell_host.py](C:\Users\cduff\workbench\scripts\workbench_shell_host.py)

This is the preferred proof path in constrained environments because the Workbench runtime stays pure while the external host owns command execution.

## Running A Proof Round On Another Machine

1. Copy the `workbench` directory to the other machine.
2. Install dependencies:

```powershell
cd C:\path\to\workbench
npm install
```

3. Copy [proof-round.config.example.json](C:\Users\cduff\workbench\proof-round.config.example.json) to `proof-round.config.json` and edit the repo paths.
4. Run:

```powershell
pwsh -NoProfile -File .\scripts\run-proof-round.ps1
```

The runner will:

- build Workbench
- start the external Python shell host
- run the built-in `workbench proof` command for each configured repo
- write a JSON report to the configured output path

Per-repo proof artifacts generated by the wrapper are written under `~/.workbench/proof-rounds/` so the wrapper does not add proof files inside the repos it is inspecting.

You can also override the config from the command line:

```powershell
pwsh -NoProfile -File .\scripts\run-proof-round.ps1 -Repos @(
  'C:\path\to\repo1',
  'C:\path\to\repo2',
  'C:\path\to\repo3'
) -InvestigationRepo 'C:\path\to\repo1'
```

## Test Pattern

Each major feature should follow the same pattern:

1. unit test for pure logic
2. integration test at the tool seam
3. fixture-backed end-to-end test
4. golden test for user-visible rendering when needed

Fixture repos should include:

- `clean-node-repo`
- `dirty-node-repo`
- `no-test-script-repo`
- `non-node-repo`

The first stable proof target now lives at [clean-node-repo](C:/Dev/repos/workbench/examples/fixture-repos/clean-node-repo). Use that fixture when you want to validate the proof loop itself rather than inspect a live repo that is changing under your feet.

The fixture directories are tracked as normal files in this repo. If you want them reinitialized as local git repos for proof runs after clone, run [setup-fixture-repos.ps1](C:/Dev/repos/workbench/scripts/setup-fixture-repos.ps1).

## Security and Guardrails

The MVP should default to local trust, but still include:

- timeouts on shell commands
- path validation for destructive filesystem operations
- confirmation policies for dangerous commands
- audit logging for tool calls

## Bootstrap Model

Recommended bootstrap paths:

- user-global: `~/.workbench/session-start.mjs`
- repo-local: `<repo>/.workbench/session-start.mjs`

The bootstrap model matters because the product is about session ergonomics as much as execution.

## Development Milestones

See [IMPLEMENTATION-CHECKLIST.md](C:\Users\cduff\workbench\IMPLEMENTATION-CHECKLIST.md) for the build plan.
