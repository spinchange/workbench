import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createShellData, createTestSession } from "./helpers/test-session.js";
import { runProofRound } from "../src/proof/run-proof-round.js";

const fixtureRepo = path.resolve(process.cwd(), "examples/fixture-repos/clean-node-repo");
const degradedFixtureRepo = path.resolve(process.cwd(), "examples/fixture-repos/dirty-node-repo");

test("runProofRound writes a deterministic artifact for the clean-node fixture", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-proof-"));
  const outputPath = path.join(tempRoot, "proof-round.json");

  try {
    const { session, shellCalls } = await createTestSession(fixtureRepo, async ({ command }) => {
      if (command === "git status --short") {
        return createShellData("");
      }

      if (command === "npm test") {
        return createShellData("fixture tests passed\n");
      }

      if (command === "npm run") {
        return createShellData("Lifecycle scripts included in clean-node-repo:\n  test\n");
      }

      throw new Error(`unexpected shell command: ${command}`);
    });

    const artifact = await runProofRound(session, {
      repoPath: fixtureRepo,
      outputPath,
    });

    assert.equal(artifact.version, 1);
    assert.equal(artifact.inputs.repoPath, fixtureRepo);
    assert.equal(artifact.inputs.outputPath, outputPath);
    assert.equal(artifact.overallStatus, "pass");
    assert.equal(artifact.blockers.length, 0);
    assert.deepEqual(artifact.loadedBootstraps, []);
    assert.equal(artifact.workspace?.hasPackageJson, true);
    assert.deepEqual(
      artifact.commandsAttempted.map((entry) => entry.command),
      ["git status --short", "npm run"],
    );
    assert.equal(shellCalls.length, 6);
    assert.deepEqual(shellCalls.map((entry) => entry.command), [
      "git status --short",
      "npm test",
      "git status --short",
      "npm test",
      "git status --short",
      "npm run",
    ]);
    assert.ok(artifact.steps.some((step) => step.id === "test_or_explain" && step.status === "ok"));

    const written = JSON.parse(await readFile(outputPath, "utf8")) as typeof artifact;
    assert.equal(written.overallStatus, "pass");
    assert.deepEqual(written.commandsAttempted.map((entry) => entry.command), ["git status --short", "npm run"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runProofRound records a degraded artifact for the dirty-node fixture", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-proof-"));
  const outputPath = path.join(tempRoot, "dirty-proof-round.json");

  try {
    const { session, shellCalls } = await createTestSession(degradedFixtureRepo, async ({ command }) => {
      if (command === "git status --short") {
        return createShellData("M src/check.js\n?? scratch.txt\n");
      }

      if (command === "npm test") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "fixture tests failed\n",
          combined: "fixture tests failed\n",
        };
      }

      if (command === "npm run") {
        return createShellData("Lifecycle scripts included in dirty-node-repo:\n  test\n");
      }

      throw new Error(`unexpected shell command: ${command}`);
    });

    const artifact = await runProofRound(session, {
      repoPath: degradedFixtureRepo,
      outputPath,
    });

    assert.equal(artifact.inputs.repoPath, degradedFixtureRepo);
    assert.equal(artifact.inputs.outputPath, outputPath);
    assert.equal(artifact.overallStatus, "warn");
    assert.equal(artifact.blockers.length, 0);
    assert.ok(artifact.findings.some((finding) => finding.id === "test-path-not-green"));
    assert.ok(artifact.steps.some((step) => step.id === "test_or_explain" && step.status === "warn"));
    assert.equal(
      artifact.commandsAttempted.map((entry) => entry.command).join(","),
      "git status --short,npm run",
    );
    assert.equal(shellCalls.length, 6);
    assert.equal((artifact.steps.find((step) => step.id === "git_status_raw")?.data as { stdout?: string } | undefined)?.stdout, "M src/check.js\n?? scratch.txt\n");

    const written = JSON.parse(await readFile(outputPath, "utf8")) as typeof artifact;
    assert.equal(written.overallStatus, "warn");
    assert.ok(written.findings.some((finding) => finding.id === "test-path-not-green"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

