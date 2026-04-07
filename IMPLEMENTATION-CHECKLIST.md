# Implementation Checklist

## v0.1

- [ ] Scaffold CLI entrypoint
- [ ] Implement persistent session runtime
- [ ] Implement typed tool registry
- [ ] Implement shell tool with structured results
- [ ] Implement fs tool wrappers needed by helpers
- [ ] Implement basic workspace detection
- [ ] Implement helper globals
- [ ] Implement `setRepo()`
- [ ] Implement `gitStatus()`
- [ ] Implement `npmScript()` and `npmTest()`
- [ ] Implement `preflight()`
- [ ] Implement `summarizeStatus()`
- [ ] Implement `repoAudit()`
- [ ] Implement `testOrExplain()`
- [ ] Implement user-global bootstrap loading
- [ ] Implement repo-local bootstrap loading
- [ ] Add minimal permissions checks for destructive operations
- [ ] Add unit tests for summary and decision logic
- [ ] Add one fixture-backed end-to-end test

## v0.2

- [ ] Save named sessions
- [ ] Load named sessions
- [ ] Persist command history
- [ ] Add slash commands
- [ ] Add structured output rendering
- [ ] Detect package manager
- [ ] Add repo registry
- [ ] Add project-relative path helpers
- [ ] Add audit log for tool calls
- [ ] Add integration tests at tool seam
- [ ] Add golden tests for help and summaries

## v0.3

- [ ] Plugin API for globals and tools
- [ ] Workspace policies
- [ ] Confirmation prompts for risky actions
- [ ] Multi-repo awareness
- [ ] Session snapshots
- [ ] Optional MCP integration seam
- [ ] TUI polish
- [ ] Expanded fixture repos
- [ ] End-to-end coverage for session restore and plugins

## Slice Plan

### Slice 1: Session

- [ ] open session
- [ ] evaluate expressions
- [ ] preserve globals between evaluations

### Slice 2: Shell

- [ ] `run()` helper
- [ ] structured shell result
- [ ] timeout handling
- [ ] working directory support

### Slice 3: Repo

- [ ] `setRepo()`
- [ ] detect `package.json`
- [ ] detect `.git`
- [ ] `gitStatus()`
- [ ] `npmTest()`

### Slice 4: Audit

- [ ] `preflight()`
- [ ] `summarizeStatus()`
- [ ] `repoAudit()`
- [ ] `testOrExplain()`

### Slice 5: Bootstrap

- [ ] load global bootstrap
- [ ] load repo bootstrap
- [ ] expose `startSession()`

### Slice 6: Persistence

- [ ] save session
- [ ] load session
- [ ] restore repo and history

## Test Matrix

### `testOrExplain()`

- [ ] no package.json
- [ ] package.json without test script
- [ ] test script passes
- [ ] test script fails
- [ ] shell timeout
- [ ] invalid workdir

### `summarizeStatus()`

- [ ] clean repo
- [ ] modified tracked file
- [ ] untracked file
- [ ] rename
- [ ] mixed status

### Bootstrap

- [ ] missing bootstrap file
- [ ] valid bootstrap file
- [ ] bootstrap throws
- [ ] repo-local bootstrap overrides global bootstrap
