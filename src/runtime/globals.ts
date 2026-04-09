import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { WorkbenchSession } from "./session.js";
import type { FsArgs, FsData, ShellArgs, ShellData, ToolResult, WorkspaceInfo } from "../types/index.js";
import { detectWorkspace } from "../workspace/detect-workspace.js";

async function fileExistsFallback(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function tryFs(session: WorkbenchSession, args: FsArgs): Promise<ToolResult<FsData> | undefined> {
  const result = await session.getToolRegistry().execute<FsArgs, FsData>("fs", args);
  if (!result.ok && result.error?.code === "tool_not_found") {
    return undefined;
  }
  return result;
}

function expectFsData<TExpected extends FsData["op"]>(
  result: ToolResult<FsData>,
  expectedOp: TExpected,
): Extract<FsData, { op: TExpected }> {
  if (!result.ok || !result.data || result.data.op !== expectedOp) {
    throw new Error(result.error?.message ?? `fs ${expectedOp} failed`);
  }

  return result.data as Extract<FsData, { op: TExpected }>;
}

async function fsReadText(session: WorkbenchSession, target: string): Promise<string> {
  const result = await tryFs(session, { op: "readText", path: target });
  if (result) {
    return expectFsData(result, "readText").text;
  }

  return readFile(target, "utf8");
}

async function fsReadJson(session: WorkbenchSession, target: string): Promise<unknown> {
  const result = await tryFs(session, { op: "readJson", path: target });
  if (result) {
    return expectFsData(result, "readJson").value;
  }

  return JSON.parse(await readFile(target, "utf8"));
}

async function fsExists(session: WorkbenchSession, target: string): Promise<boolean> {
  const result = await tryFs(session, { op: "exists", path: target });
  if (result) {
    return expectFsData(result, "exists").exists;
  }

  return fileExistsFallback(target);
}

async function fsListDir(session: WorkbenchSession, target: string): Promise<Array<{ name: string; type: "dir" | "file" | "other" }>> {
  const result = await tryFs(session, { op: "listDir", path: target });
  if (result) {
    return expectFsData(result, "listDir").entries;
  }

  const entries = await readdir(target, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
  }));
}

function unwrapShell(result: ToolResult<ShellData>): string {
  if (!result.ok || !result.data) {
    throw new Error(result.error?.message ?? "shell command failed");
  }

  return result.data.combined.trim();
}

export async function installBuiltinGlobals(session: WorkbenchSession): Promise<void> {
  const registry = session.getToolRegistry();
  let workspace: WorkspaceInfo | undefined;

  session.setGlobal("cwd", session.state.cwd);
  session.setGlobal("repo", session.state.repo ?? null);

  session.setGlobal("setRepo", async (repoPath: string) => {
    workspace = await detectWorkspace(repoPath);
    session.state.repo = repoPath;
    session.setGlobal("repo", repoPath);
    session.setGlobal("wb", { cwd: session.state.cwd, repo: repoPath, workspace });
    return workspace;
  });

  session.setGlobal("run", async (command: string, cwd = session.state.repo ?? session.state.cwd, timeoutMs = 20_000) => {
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command,
      cwd,
      timeoutMs,
    });
    return unwrapShell(result);
  });

  session.setGlobal("read", async (target: string) => fsReadText(session, target));
  session.setGlobal("json", async (target: string) => fsReadJson(session, target));
  session.setGlobal("exists", async (target: string) => fsExists(session, target));
  session.setGlobal("ls", async (target = session.state.repo ?? session.state.cwd) => fsListDir(session, target));
  session.setGlobal("head", async (target: string, lines = 20) => {
    const text = await fsReadText(session, target);
    return text.split(/\r?\n/).slice(0, lines).join("\n");
  });
  session.setGlobal("tail", async (target: string, lines = 20) => {
    const text = await fsReadText(session, target);
    return text.split(/\r?\n/).slice(-lines).join("\n");
  });
  session.setGlobal("git", async (args: string, repoPath = session.state.repo ?? session.state.cwd, timeoutMs = 30_000) => {
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command: `git ${args}`,
      cwd: repoPath,
      timeoutMs,
    });
    return unwrapShell(result);
  });
  session.setGlobal("gitStatus", async (repoPath = session.state.repo ?? session.state.cwd) => {
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command: "git status --short",
      cwd: repoPath,
      timeoutMs: 30_000,
    });
    return unwrapShell(result);
  });
  session.setGlobal("npmScript", async (name: string, repoPath = session.state.repo ?? session.state.cwd, timeoutMs = 120_000) => {
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command: `npm run ${name}`,
      cwd: repoPath,
      timeoutMs,
    });
    return unwrapShell(result);
  });
  session.setGlobal("npmTest", async (repoPath = session.state.repo ?? session.state.cwd, timeoutMs = 120_000) => {
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command: "npm test",
      cwd: repoPath,
      timeoutMs,
    });
    return unwrapShell(result);
  });
  session.setGlobal("assert", (condition: boolean, message = "assertion failed") => {
    if (!condition) {
      throw new Error(message);
    }
    return true;
  });
  session.setGlobal("test", async (name: string, fn: () => Promise<unknown> | unknown) => {
    const startedAt = new Date().toISOString();
    try {
      const value = await fn();
      return { name, ok: true, value, startedAt, finishedAt: new Date().toISOString() };
    } catch (error) {
      return {
        name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }
  });
  session.setGlobal("findText", async (pattern: string, target = session.state.repo ?? session.state.cwd, timeoutMs = 20_000) => {
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command: `rg -n --hidden --glob '!**/node_modules/**' --glob '!**/.git/**' "${pattern}" "${target}"`,
      cwd: session.state.cwd,
      timeoutMs,
    });
    return unwrapShell(result);
  });
  session.setGlobal("preflight", async (repoPath = session.state.repo ?? session.state.cwd) => {
    const info = await detectWorkspace(repoPath);
    const gitStatus = await registry.execute<ShellArgs, ShellData>("shell", {
      command: "git status --short",
      cwd: repoPath,
      timeoutMs: 30_000,
    });
    let testsPassed = false;
    if (info.scripts.includes("test")) {
      const testResult = await registry.execute<ShellArgs, ShellData>("shell", {
        command: "npm test",
        cwd: repoPath,
        timeoutMs: 120_000,
      });
      testsPassed = Boolean(testResult.ok && testResult.data?.exitCode === 0);
    }
    return {
      branchClean: unwrapShell(gitStatus) === "",
      scripts: info.scripts,
      hasPackageJson: info.hasPackageJson,
      hasTestScript: info.scripts.includes("test"),
      testsPassed,
    };
  });
  session.setGlobal("summarizeStatus", async (repoPath = session.state.repo ?? session.state.cwd) => {
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command: "git status --short",
      cwd: repoPath,
      timeoutMs: 30_000,
    });
    const lines = unwrapShell(result)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      repo: repoPath,
      clean: lines.length === 0,
      changedCount: lines.length,
      changed: lines,
    };
  });
  session.setGlobal("repoAudit", async (repoPath = session.state.repo ?? session.state.cwd) => {
    const info = await detectWorkspace(repoPath);
    const packageJsonPath = path.join(repoPath, "package.json");
    const readmePath = path.join(repoPath, "README.md");
    const preflight = await (session.globals.preflight as (repoPath?: string) => Promise<unknown>)(repoPath);
    const status = await (session.globals.summarizeStatus as (repoPath?: string) => Promise<unknown>)(repoPath);
    return {
      repo: repoPath,
      gitDir: info.hasGit,
      hasReadme: await fsExists(session, readmePath),
      hasPackageJson: await fsExists(session, packageJsonPath),
      preflight,
      status,
    };
  });
  session.setGlobal("testOrExplain", async (repoPath = session.state.repo ?? session.state.cwd) => {
    const info = await detectWorkspace(repoPath);
    if (!info.hasPackageJson) {
      return {
        repo: repoPath,
        ok: false,
        reason: "no package.json",
        nextStep: "Use run(...) directly or switch to a repo with a package.json.",
      };
    }
    if (!info.scripts.includes("test")) {
      return {
        repo: repoPath,
        ok: false,
        reason: "no test script",
        scripts: info.scripts,
        nextStep: "Run a different script with npmScript(name) or use run(...) for a custom command.",
      };
    }
    const result = await registry.execute<ShellArgs, ShellData>("shell", {
      command: "npm test",
      cwd: repoPath,
      timeoutMs: 120_000,
    });
    return {
      repo: repoPath,
      ok: Boolean(result.ok && result.data?.exitCode === 0),
      reason: result.ok && result.data?.exitCode === 0 ? "tests passed" : "tests failed",
      output: result.ok ? result.data?.combined ?? "" : result.error?.message ?? "",
    };
  });
  session.setGlobal("replHelp", () => ({
    repo: session.state.repo ?? null,
    cwd: session.state.cwd,
    helpers: [
      "setRepo",
      "run",
      "read",
      "json",
      "exists",
      "ls",
      "head",
      "tail",
      "findText",
      "git",
      "gitStatus",
      "npmScript",
      "npmTest",
      "assert",
      "test",
      "preflight",
      "summarizeStatus",
      "repoAudit",
      "testOrExplain",
      "replHelp",
    ],
  }));
  session.setGlobal("wb", { cwd: session.state.cwd, repo: session.state.repo ?? null, workspace });
}
