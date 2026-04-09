import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WorkbenchSession } from "../src/runtime/session.js";
import { getSessionSnapshotPath, loadSessionSnapshot, saveSessionSnapshot } from "../src/runtime/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";

test("session snapshots round-trip cwd, repo, and history", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-session-"));
  try {
    const session = createSession("C:\\workbench\\cwd");
    session.state.repo = "C:\\workbench\\repo";
    session.remember("await repoAudit()");
    session.remember("await testOrExplain()");

    const snapshot = session.createSnapshot();
    assert.deepEqual(snapshot, {
      version: 1,
      cwd: "C:\\workbench\\cwd",
      repo: "C:\\workbench\\repo",
      history: ["await repoAudit()", "await testOrExplain()"],
    });

    const savedPath = await saveSessionSnapshot("alpha session", snapshot, { baseDir: tempRoot });
    assert.equal(savedPath, getSessionSnapshotPath("alpha session", tempRoot));

    const diskText = await readFile(savedPath, "utf8");
    assert.deepEqual(JSON.parse(diskText), snapshot);

    const loaded = await loadSessionSnapshot("alpha session", { baseDir: tempRoot });
    assert.deepEqual(loaded, snapshot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("applySnapshot restores live session state and globals", async () => {
  const session = createSession("C:\\old\\cwd");
  await session.initialize();
  session.state.repo = "C:\\old\\repo";
  session.remember("old command");

  session.applySnapshot({
    version: 1,
    cwd: "C:\\new\\cwd",
    repo: "C:\\new\\repo",
    history: ["first", "second"],
  });

  assert.equal(session.state.cwd, "C:\\new\\cwd");
  assert.equal(session.state.repo, "C:\\new\\repo");
  assert.deepEqual(session.state.history, ["first", "second"]);
  assert.equal(session.globals.cwd, "C:\\new\\cwd");
  assert.equal(session.globals.repo, "C:\\new\\repo");
  assert.deepEqual(session.globals.wb, {
    cwd: "C:\\new\\cwd",
    repo: "C:\\new\\repo",
    workspace: undefined,
  });
});

function createSession(cwd: string): WorkbenchSession {
  return new WorkbenchSession(cwd, new ToolRegistry());
}
