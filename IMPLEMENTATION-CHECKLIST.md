# Implementation Checklist

This checklist reflects the repo as it exists after the current four-slice implementation pass.

## Shipped In Repo

- [x] CLI entrypoint
- [x] Persistent session runtime
- [x] Typed tool registry
- [x] Shell tool with structured results
- [x] First-class fs tool seam for common helper and proof operations
- [x] Basic workspace detection
- [x] Helper globals
- [x] `setRepo()`
- [x] `gitStatus()`
- [x] `npmScript()` and `npmTest()`
- [x] `preflight()`
- [x] `summarizeStatus()`
- [x] `repoAudit()`
- [x] `testOrExplain()`
- [x] User-global bootstrap loading
- [x] Repo-local bootstrap loading
- [x] Named session save/load and history persistence
- [x] Minimal structured output rendering for session and audit flows
- [x] Slash commands in the REPL
- [x] Audit log for tool calls
- [x] Minimal shell execution policy with explicit destructive opt-out
- [x] Node-based test harness
- [x] Runtime globals tests
- [x] Bootstrap tests
- [x] Session persistence tests
- [x] Audit log tests
- [x] Fixture-backed proof-round pass and degraded-path tests
- [x] Expanded fixture repos

## Still Missing

- [ ] Repo registry
- [ ] Project-relative path helpers
- [ ] Confirmation prompts for risky actions instead of only non-interactive blocking
- [ ] Multi-repo awareness
- [ ] Plugin API for globals and tools
- [ ] TUI polish
- [ ] Golden tests for user-visible rendering
- [ ] End-to-end coverage for session restore through the CLI surface

## Remaining Quality Gaps

- [ ] Add timeout-specific behavior coverage instead of only generic shell failure coverage
- [ ] Add invalid-workdir coverage if the runtime grows explicit workdir validation
- [ ] Decide whether the shell policy should remain lexical or move to a fuller policy model
- [ ] Reconcile README examples and CLI help text if the command surface expands again

## Recommended Next Slice

The highest-value next work is now post-v0.1 product hardening:

- [ ] Add confirmation and policy layers on top of the current shell guard
- [ ] Add repo registry and project-relative helpers
- [ ] Add golden tests for CLI and REPL-facing output
- [ ] Strengthen session restore and audit flows with end-to-end coverage

## Test Matrix

### `testOrExplain()`

- [x] no package.json
- [x] package.json without test script
- [x] test script passes
- [x] test script fails
- [x] generic shell failure
- [ ] shell timeout
- [ ] invalid workdir

### `summarizeStatus()`

- [x] modified tracked file
- [x] untracked file
- [x] mixed status
- [x] clean repo
- [x] rename

### Bootstrap

- [x] missing bootstrap file
- [x] valid bootstrap file
- [x] repo-local bootstrap overrides global bootstrap
- [x] bootstrap throws

### Proof Round

- [x] clean passing fixture
- [x] degraded dirty fixture with warning outcome

### Persistence

- [x] snapshot round-trip
- [x] live session restore from snapshot

### Audit

- [x] audit log file write
- [x] audit log readback
