import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createShellData, createTestSession } from "./helpers/test-session.js";

const fixtureRepo = path.resolve(process.cwd(), "examples/fixture-repos/clean-node-repo");

test("built-in globals update repo state and summarize git status", async () => {
  const { session, shellCalls } = await createTestSession(fixtureRepo, async ({ command }) => {
    if (command === "git status --short") {
      return createShellData("M src/check.js\n?? scratch.txt\n");
    }

    throw new Error(`unexpected shell command: ${command}`);
  });

  const workspace = await (session.globals.setRepo as (repoPath: string) => Promise<unknown>)(fixtureRepo);
  assert.equal(session.state.repo, fixtureRepo);
  assert.equal(session.globals.repo, fixtureRepo);
  assert.equal(shellCalls.length, 0);
  assert.equal((session.globals.wb as { repo?: string }).repo, fixtureRepo);
  assert.equal((workspace as { hasPackageJson?: boolean }).hasPackageJson, true);

  const summary = await (session.globals.summarizeStatus as (repoPath: string) => Promise<unknown>)(fixtureRepo);
  assert.deepEqual(summary, {
    repo: fixtureRepo,
    clean: false,
    changedCount: 2,
    changed: ["M src/check.js", "?? scratch.txt"],
  });
});

test("summarizeStatus reports a clean repo and preserves mixed status lines", async () => {
  const cleanHarness = await createTestSession(fixtureRepo, async ({ command }) => {
    if (command === "git status --short") {
      return createShellData("");
    }

    throw new Error(`unexpected shell command: ${command}`);
  });

  const cleanSummary = await (cleanHarness.session.globals.summarizeStatus as (repoPath: string) => Promise<unknown>)(fixtureRepo);
  assert.deepEqual(cleanSummary, {
    repo: fixtureRepo,
    clean: true,
    changedCount: 0,
    changed: [],
  });

  const mixedHarness = await createTestSession(fixtureRepo, async ({ command }) => {
    if (command === "git status --short") {
      return createShellData("R  src/old-name.js -> src/new-name.js\nM src/check.js\n?? scratch.txt\n");
    }

    throw new Error(`unexpected shell command: ${command}`);
  });

  const mixedSummary = await (mixedHarness.session.globals.summarizeStatus as (repoPath: string) => Promise<unknown>)(fixtureRepo);
  assert.deepEqual(mixedSummary, {
    repo: fixtureRepo,
    clean: false,
    changedCount: 3,
    changed: [
      "R  src/old-name.js -> src/new-name.js",
      "M src/check.js",
      "?? scratch.txt",
    ],
  });
});

test("testOrExplain handles missing package.json, no test script, failing tests, and shell failures", async () => {
  await withTempDir(async (tempRoot) => {
    const repoWithoutPackage = path.join(tempRoot, "no-package");
    await mkdir(repoWithoutPackage, { recursive: true });

    const missingPackageHarness = await createTestSession(repoWithoutPackage);
    const missingPackageResult = await (missingPackageHarness.session.globals.testOrExplain as (repoPath: string) => Promise<unknown>)(repoWithoutPackage);

    assert.deepEqual(missingPackageResult, {
      repo: repoWithoutPackage,
      ok: false,
      reason: "no package.json",
      nextStep: "Use run(...) directly or switch to a repo with a package.json.",
    });
    assert.equal(missingPackageHarness.shellCalls.length, 0);

    const repoWithoutTestScript = path.join(tempRoot, "no-test-script");
    await mkdir(repoWithoutTestScript, { recursive: true });
    await writeFile(
      path.join(repoWithoutTestScript, "package.json"),
      JSON.stringify(
        {
          name: "no-test-script",
          version: "1.0.0",
          scripts: {
            check: "node -e \"console.log('check only')\"",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const noTestScriptHarness = await createTestSession(repoWithoutTestScript);
    const noTestScriptResult = await (noTestScriptHarness.session.globals.testOrExplain as (repoPath: string) => Promise<unknown>)(repoWithoutTestScript);

    assert.deepEqual(noTestScriptResult, {
      repo: repoWithoutTestScript,
      ok: false,
      reason: "no test script",
      scripts: ["check"],
      nextStep: "Run a different script with npmScript(name) or use run(...) for a custom command.",
    });
    assert.equal(noTestScriptHarness.shellCalls.length, 0);

    const passingHarness = await createTestSession(fixtureRepo, async ({ command }) => {
      if (command === "npm test") {
        return createShellData("fixture tests passed\n");
      }

      throw new Error(`unexpected shell command: ${command}`);
    });

    const passingResult = await (passingHarness.session.globals.testOrExplain as (repoPath: string) => Promise<unknown>)(fixtureRepo);

    assert.deepEqual(passingResult, {
      repo: fixtureRepo,
      ok: true,
      reason: "tests passed",
      output: "fixture tests passed\n",
    });
    assert.equal(passingHarness.shellCalls.length, 1);
    assert.equal(passingHarness.shellCalls[0]?.command, "npm test");
    assert.equal(passingHarness.shellCalls[0]?.cwd, fixtureRepo);

    const failingHarness = await createTestSession(fixtureRepo, async ({ command }) => {
      if (command === "npm test") {
        return createShellData("fixture tests failed\n", "", 1);
      }

      throw new Error(`unexpected shell command: ${command}`);
    });

    const failingResult = await (failingHarness.session.globals.testOrExplain as (repoPath: string) => Promise<unknown>)(fixtureRepo);

    assert.deepEqual(failingResult, {
      repo: fixtureRepo,
      ok: false,
      reason: "tests failed",
      output: "fixture tests failed\n",
    });
    assert.equal(failingHarness.shellCalls.length, 1);
    assert.equal(failingHarness.shellCalls[0]?.command, "npm test");

    const failingShellHarness = await createTestSession(fixtureRepo, async ({ command }) => {
      if (command === "npm test") {
        throw new Error("shell runner exploded");
      }

      throw new Error(`unexpected shell command: ${command}`);
    });

    const failingShellResult = await (failingShellHarness.session.globals.testOrExplain as (repoPath: string) => Promise<unknown>)(fixtureRepo);

    assert.deepEqual(failingShellResult, {
      repo: fixtureRepo,
      ok: false,
      reason: "tests failed",
      output: "shell runner exploded",
    });
    assert.equal(failingShellHarness.shellCalls.length, 1);
    assert.equal(failingShellHarness.shellCalls[0]?.command, "npm test");
  });
});

async function withTempDir<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-runtime-"));
  try {
    return await fn(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
