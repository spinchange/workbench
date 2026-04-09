import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listRegisteredRepos, resolveRegisteredRepo, saveRegisteredRepo, toProjectPath } from "../src/workspace/repo-registry.js";

test("repo registry saves, lists, and resolves named repos", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-repos-"));
  try {
    const entry = await saveRegisteredRepo("main repo", "C:\\dev\\repos\\workbench", tempRoot);
    assert.equal(entry.name, "main-repo");
    assert.equal(entry.path, path.resolve("C:\\dev\\repos\\workbench"));

    const repos = await listRegisteredRepos(tempRoot);
    assert.equal(repos.length, 1);
    assert.equal(repos[0]?.name, "main-repo");

    const resolved = await resolveRegisteredRepo("main repo", tempRoot);
    assert.equal(resolved, path.resolve("C:\\dev\\repos\\workbench"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("repo registry accepts absolute paths and builds project-relative paths", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-repos-"));
  try {
    const absolutePath = path.resolve("C:\\dev\\repos\\workbench");
    assert.equal(await resolveRegisteredRepo(absolutePath, tempRoot), absolutePath);
    assert.equal(toProjectPath(absolutePath, "src", "cli", "main.ts"), path.join(absolutePath, "src", "cli", "main.ts"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
