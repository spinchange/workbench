import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTestSession } from "./helpers/test-session.js";
import { loadBootstrap } from "../src/bootstrap/load-bootstrap.js";

test("loadBootstrap loads global and repo-local bootstrap files in order", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-bootstrap-"));
  const originalUserProfile = process.env.USERPROFILE;
  const repoPath = path.join(tempRoot, "repo");
  const globalBootstrapDir = path.join(tempRoot, ".workbench");
  const repoBootstrapDir = path.join(repoPath, ".workbench");

  try {
    process.env.USERPROFILE = tempRoot;
    await mkdir(globalBootstrapDir, { recursive: true });
    await mkdir(repoBootstrapDir, { recursive: true });

    await writeFile(
      path.join(globalBootstrapDir, "session-start.mjs"),
      `export default async function register(session) {
  session.setGlobal("bootstrapSource", "global");
  session.setGlobal("bootstrapValues", ["global"]);
}
`,
      "utf8",
    );

    await writeFile(
      path.join(repoBootstrapDir, "session-start.mjs"),
      `export default async function register(session) {
  const values = Array.isArray(session.globals.bootstrapValues) ? session.globals.bootstrapValues : [];
  session.setGlobal("bootstrapSource", "repo");
  session.setGlobal("bootstrapValues", [...values, "repo"]);
}
`,
      "utf8",
    );

    const { session } = await createTestSession(repoPath);
    const loaded = await loadBootstrap(session, repoPath);

    assert.deepEqual(loaded, [
      path.join(globalBootstrapDir, "session-start.mjs"),
      path.join(repoBootstrapDir, "session-start.mjs"),
    ]);
    assert.deepEqual(session.state.loadedBootstraps, loaded);
    assert.equal(session.globals.bootstrapSource, "repo");
    assert.deepEqual(session.globals.bootstrapValues, ["global", "repo"]);
  } finally {
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("loadBootstrap rejects when a bootstrap file throws", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-bootstrap-throws-"));
  const originalUserProfile = process.env.USERPROFILE;
  const repoPath = path.join(tempRoot, "repo");
  const globalBootstrapDir = path.join(tempRoot, ".workbench");

  try {
    process.env.USERPROFILE = tempRoot;
    await mkdir(globalBootstrapDir, { recursive: true });
    await mkdir(repoPath, { recursive: true });

    await writeFile(
      path.join(globalBootstrapDir, "session-start.mjs"),
      `export default function register() {
  throw new Error("bootstrap boom");
}
`,
      "utf8",
    );

    const { session } = await createTestSession(repoPath);

    await assert.rejects(
      loadBootstrap(session, repoPath),
      /bootstrap boom/,
    );
    assert.deepEqual(session.state.loadedBootstraps, []);
  } finally {
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("loadBootstrap tolerates missing bootstrap files", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-bootstrap-missing-"));
  const originalUserProfile = process.env.USERPROFILE;
  const repoPath = path.join(tempRoot, "repo");

  try {
    process.env.USERPROFILE = tempRoot;
    await mkdir(repoPath, { recursive: true });

    const { session } = await createTestSession(repoPath);
    const loaded = await loadBootstrap(session, repoPath);

    assert.deepEqual(loaded, []);
    assert.deepEqual(session.state.loadedBootstraps, []);
  } finally {
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
