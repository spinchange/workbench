# Implementation Checklist

This checklist reflects the repo as it exists after the confirmation/repo-registry follow-up slice.

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
- [x] Dedicated CLI render helpers with golden-style output tests
- [x] Slash commands in the REPL
- [x] Audit log for tool calls
- [x] Shell policy with `safe` / `confirm` / `blocked` classification
- [x] Interactive confirmation retry for confirmable commands
- [x] Repo registry
- [x] Project-relative path helpers
- [x] Node-based test harness
- [x] Runtime globals tests
- [x] Bootstrap tests
- [x] Session persistence tests
- [x] Audit log tests
- [x] Repo registry tests
- [x] CLI render golden tests
- [x] Fixture-backed proof-round pass and degraded-path tests
- [x] Expanded fixture repos

## Still Missing

- [ ] Multi-repo awareness
- [ ] Plugin API for globals and tools
- [ ] TUI polish
- [ ] End-to-end coverage for session restore through the CLI surface
- [ ] End-to-end coverage for interactive confirmation through the CLI surface

## Remaining Quality Gaps

- [ ] Add timeout-specific behavior coverage instead of only generic shell failure coverage
- [ ] Add invalid-workdir coverage if the runtime grows explicit workdir validation
- [ ] Decide whether the shell policy should remain command-classifier based or move to a fuller policy model
- [ ] Reconcile README examples and CLI help text if the command surface expands again

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
- [x] policy and confirmation state in audit entries

### CLI Rendering

- [x] slash help output
- [x] audit line rendering
- [x] session save/load rendering
- [x] repo entry rendering
- [x] cancelled confirmation rendering
