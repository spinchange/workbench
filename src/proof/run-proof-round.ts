import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkbenchSession } from "../runtime/session.js";
import type { ShellArgs, ShellData, ToolResult, WorkspaceInfo } from "../types/index.js";

type ProofStepStatus = "ok" | "warn" | "fail" | "skipped";
type ProofOverallStatus = "pass" | "warn" | "fail";

export interface ProofRoundOptions {
  repoPath: string;
  outputPath?: string;
  searchPattern?: string;
}

export interface ProofStep {
  id: string;
  status: ProofStepStatus;
  summary: string;
  data?: unknown;
  error?: string;
}

export interface ProofFinding {
  id: string;
  severity: "info" | "warn" | "error";
  summary: string;
  evidence: string[];
  nextAction?: string;
}

export interface ProofRoundArtifact {
  version: 1;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputs: {
    repoPath: string;
    outputPath?: string;
    searchPattern?: string;
  };
  workspace?: WorkspaceInfo;
  loadedBootstraps: string[];
  filesInspected: string[];
  commandsAttempted: Array<{
    command: string;
    cwd: string;
    timeoutMs: number;
    ok: boolean;
    exitCode?: number;
    error?: string;
  }>;
  steps: ProofStep[];
  findings: ProofFinding[];
  blockers: string[];
  recommendedNextAction: string;
  overallStatus: ProofOverallStatus;
}

interface ShellAttempt {
  result: ToolResult<ShellData>;
}

const LEGACY_PROOF_ARTIFACTS = [
  "proof-round-output.json",
  "tmp-proof-round-output.json",
];

export async function runProofRound(
  session: WorkbenchSession,
  options: ProofRoundOptions,
): Promise<ProofRoundArtifact> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const steps: ProofStep[] = [];
  const findings: ProofFinding[] = [];
  const blockers: string[] = [];
  const filesInspected: string[] = [];
  const commandsAttempted: ProofRoundArtifact["commandsAttempted"] = [];

  const repoPath = path.resolve(options.repoPath);
  const resolvedOutputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : defaultProofOutputPath(repoPath);
  const ignoredRepoRelativePaths = getIgnoredRepoRelativePaths(repoPath, resolvedOutputPath);
  let workspace: WorkspaceInfo | undefined;

  const workspaceStep = await recordStep("workspace", async () => {
    const value = await callGlobal<WorkspaceInfo>(session, "setRepo", repoPath);
    workspace = value;
    return {
      summary: `Workspace detected for ${repoPath}`,
      data: value,
      files: [path.join(repoPath, "package.json"), path.join(repoPath, ".git")],
    };
  });
  steps.push(workspaceStep.step);
  pushUnique(filesInspected, workspaceStep.files);

  const bootstrapStep = await recordStep("bootstrap", async () => ({
    summary:
      session.state.loadedBootstraps.length > 0
        ? `Loaded ${session.state.loadedBootstraps.length} bootstrap file(s)`
        : "No bootstrap files loaded",
    data: session.state.loadedBootstraps,
  }));
  steps.push(bootstrapStep.step);

  const rootListingStep = await recordStep("root_listing", async () => {
    const entries = await readdir(repoPath, { withFileTypes: true });
    const listing = entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
      }))
      .filter((entry) => !ignoredRepoRelativePaths.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      summary: `Found ${listing.length} root entries`,
      data: listing,
      files: listing.slice(0, 12).map((entry) => path.join(repoPath, entry.name)),
    };
  });
  steps.push(rootListingStep.step);
  pushUnique(filesInspected, rootListingStep.files);

  const entrypointStep = await recordStep("entrypoints", async () => {
    const candidates = [
      "README.md",
      "package.json",
      "src/index.ts",
      "src/index.tsx",
      "src/main.ts",
      "src/main.tsx",
      "index.html",
      "index.js",
      "index.ts",
      "server.js",
      "server.ts",
    ].map((relativePath) => path.join(repoPath, relativePath));
    const discovered: Array<{ path: string; excerpt?: string }> = [];

    for (const candidate of candidates) {
      try {
        const text = await readFile(candidate, "utf8");
        discovered.push({
          path: candidate,
          excerpt: text.split(/\r?\n/).slice(0, 8).join("\n"),
        });
      } catch {
        continue;
      }
    }

    return {
      status: discovered.length > 0 ? ("ok" as const) : ("warn" as const),
      summary:
        discovered.length > 0
          ? `Identified ${discovered.length} likely entrypoint file(s)`
          : "No canonical entrypoint files were found",
      data: discovered,
      files: discovered.map((entry) => entry.path),
    };
  });
  steps.push(entrypointStep.step);
  pushUnique(filesInspected, entrypointStep.files);

  const auditStep = await recordStep("repo_audit", async () => {
    const value = await callGlobal<Record<string, unknown>>(session, "repoAudit", repoPath);
    const cleanedValue = stripIgnoredPathsFromRepoAudit(value, ignoredRepoRelativePaths);
    return {
      summary: "Collected repo audit snapshot",
      data: cleanedValue,
    };
  });
  steps.push(auditStep.step);

  const testExplainStep = await recordStep("test_or_explain", async () => {
    const value = await callGlobal(session, "testOrExplain", repoPath);
    return {
      status:
        typeof value === "object" && value !== null && "ok" in value && (value as { ok: boolean }).ok
          ? ("ok" as const)
          : ("warn" as const),
      summary: "Evaluated test execution path",
      data: value,
    };
  });
  steps.push(testExplainStep.step);

  const shellCommands: Array<{ id: string; command: string; timeoutMs: number }> = [
    { id: "git_status_raw", command: "git status --short", timeoutMs: 30_000 },
  ];

  if (workspace?.hasPackageJson) {
    shellCommands.push({ id: "script_inventory", command: "npm run", timeoutMs: 30_000 });
  }

  if (options.searchPattern) {
    const outputGlobs = Array.from(ignoredRepoRelativePaths)
      .map((relativePath) => ` --glob '!${relativePath.replace(/\//g, "/")}'`)
      .join("");
    shellCommands.push({
      id: "targeted_search",
      command: `rg -n --hidden --glob '!**/node_modules/**' --glob '!**/.git/**'${outputGlobs} "${escapeDoubleQuotes(options.searchPattern)}" "${repoPath}"`,
      timeoutMs: 20_000,
    });
  }

  for (const shellCommand of shellCommands) {
    const shellStep = await recordShellStep(session, repoPath, shellCommand.command, shellCommand.timeoutMs);
    commandsAttempted.push({
      command: shellCommand.command,
      cwd: repoPath,
      timeoutMs: shellCommand.timeoutMs,
      ok: shellStep.result.ok,
      exitCode: shellStep.result.data?.exitCode,
      error: shellStep.result.error?.message,
    });
    steps.push({
      id: shellCommand.id,
      status: shellStep.result.ok ? "ok" : "warn",
      summary: shellStep.result.ok ? `Command succeeded: ${shellCommand.command}` : `Command failed: ${shellCommand.command}`,
      data: shellStep.result.ok ? cleanShellData(shellStep.result.data, ignoredRepoRelativePaths) : undefined,
      error: shellStep.result.ok ? undefined : shellStep.result.error?.message,
    });
    if (!shellStep.result.ok) {
      blockers.push(`${shellCommand.command}: ${shellStep.result.error?.message ?? "unknown shell failure"}`);
    }
  }

  if (auditStep.step.status !== "ok") {
    findings.push({
      id: "repo-audit-degraded",
      severity: "warn",
      summary: "repoAudit did not complete cleanly during the proof round.",
      evidence: ["repo_audit"],
      nextAction: "Inspect the audit step error and decide whether the round should tolerate or model that failure explicitly.",
    });
    blockers.push("repoAudit could not complete");
  }
  if (testExplainStep.step.status !== "ok") {
    findings.push({
      id: "test-path-not-green",
      severity: "warn",
      summary: "The repo does not have a clean passing test path in the proof round.",
      evidence: ["test_or_explain"],
      nextAction: "Decide whether to add a deterministic verification script or accept a read-only investigation mode.",
    });
  }
  if (options.searchPattern && steps.every((step) => step.id !== "targeted_search" || step.status !== "ok")) {
    findings.push({
      id: "search-unverified",
      severity: "warn",
      summary: `Targeted search for '${options.searchPattern}' did not complete successfully.`,
      evidence: ["targeted_search"],
      nextAction: "Verify the host shell runner and ripgrep availability.",
    });
  }

  const overallStatus = blockers.length > 0
    ? "warn"
    : findings.some((finding) => finding.severity === "error")
      ? "fail"
      : findings.some((finding) => finding.severity === "warn")
        ? "warn"
        : "pass";

  const artifact: ProofRoundArtifact = {
    version: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    inputs: {
      repoPath,
      outputPath: resolvedOutputPath,
      searchPattern: options.searchPattern,
    },
    workspace,
    loadedBootstraps: [...session.state.loadedBootstraps],
    filesInspected,
    commandsAttempted,
    steps,
    findings,
    blockers,
    recommendedNextAction: recommendNextAction(blockers, findings),
    overallStatus,
  };

  if (resolvedOutputPath) {
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }

  return artifact;
}

async function callGlobal<TValue = unknown>(
  session: WorkbenchSession,
  name: string,
  ...args: unknown[]
): Promise<TValue> {
  const value = session.globals[name];
  if (typeof value !== "function") {
    throw new Error(`Global '${name}' is not available.`);
  }
  return value(...args) as Promise<TValue>;
}

async function recordShellStep(
  session: WorkbenchSession,
  cwd: string,
  command: string,
  timeoutMs: number,
): Promise<ShellAttempt> {
  const registry = session.getToolRegistry();
  const result = await registry.execute<ShellArgs, ShellData>("shell", {
    command,
    cwd,
    timeoutMs,
  });
  return { result };
}

async function recordStep(
  id: string,
  action: () => Promise<{
    status?: ProofStepStatus;
    summary: string;
    data?: unknown;
    error?: string;
    files?: string[];
  }>,
): Promise<{ step: ProofStep; files: string[] }> {
  try {
    const result = await action();
    return {
      step: {
        id,
        status: result.status ?? "ok",
        summary: result.summary,
        data: result.data,
        error: result.error,
      },
      files: result.files ?? [],
    };
  } catch (error) {
    return {
      step: {
        id,
        status: "warn",
        summary: `${id} failed`,
        error: error instanceof Error ? error.message : String(error),
      },
      files: [],
    };
  }
}

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function recommendNextAction(blockers: string[], findings: ProofFinding[]): string {
  if (blockers.length > 0) {
    return "Fix the shell or repo-access blockers first, then rerun the proof command to re-baseline the artifact.";
  }
  if (findings.some((finding) => finding.id === "test-path-not-green")) {
    return "Pick one deterministic verification command for the repo and make it pass inside the proof round.";
  }
  return "Use the artifact as the baseline for the next bounded investigation or implementation slice.";
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/"/g, '\\"');
}

function defaultProofOutputPath(repoPath: string): string {
  const homeDir = process.env.USERPROFILE ?? process.cwd();
  const repoLabel = repoPath
    .replace(/[:\\/]+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return path.join(homeDir, ".workbench", "proof-rounds", `${repoLabel || "repo"}.json`);
}

function toRepoRelativePath(repoPath: string, candidatePath: string): string | undefined {
  const relativePath = path.relative(repoPath, candidatePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return relativePath.replace(/\\/g, "/");
}

function cleanShellData(data: ShellData | undefined, ignoredRepoRelativePaths: Set<string>): ShellData | undefined {
  if (!data || ignoredRepoRelativePaths.size === 0) {
    return data;
  }
  const filteredStdout = filterStatusText(data.stdout, ignoredRepoRelativePaths);
  const filteredStderr = filterStatusText(data.stderr, ignoredRepoRelativePaths);
  return {
    ...data,
    stdout: filteredStdout,
    stderr: filteredStderr,
    combined: `${filteredStdout}${filteredStderr}`,
  };
}

function filterStatusText(text: string, ignoredRepoRelativePaths: Set<string>): string {
  const variants = new Set<string>();
  for (const relativePath of ignoredRepoRelativePaths) {
    variants.add(relativePath);
    variants.add(relativePath.replace(/\//g, "\\"));
  }
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }
      for (const variant of variants) {
        if (trimmed.endsWith(variant)) {
          return false;
        }
      }
      return true;
    })
    .join("\n");
}

function stripIgnoredPathsFromRepoAudit(
  value: Record<string, unknown>,
  ignoredRepoRelativePaths: Set<string>,
): Record<string, unknown> {
  if (ignoredRepoRelativePaths.size === 0) {
    return value;
  }

  const status = isRecord(value.status) ? value.status : undefined;
  const preflight = isRecord(value.preflight) ? value.preflight : undefined;
  const changed = Array.isArray(status?.changed)
    ? status.changed.filter((entry): entry is string => {
        if (typeof entry !== "string") {
          return false;
        }
        const trimmed = entry.trim();
        for (const relativePath of ignoredRepoRelativePaths) {
          if (trimmed.endsWith(relativePath) || trimmed.endsWith(relativePath.replace(/\//g, "\\"))) {
            return false;
          }
        }
        return true;
      })
    : undefined;

  return {
    ...value,
    preflight: preflight
      ? {
          ...preflight,
          branchClean: typeof preflight.branchClean === "boolean"
            ? (changed?.length ?? 0) === 0
            : preflight.branchClean,
        }
      : value.preflight,
    status: status
      ? {
          ...status,
          clean: changed ? changed.length === 0 : status.clean,
          changedCount: changed ? changed.length : status.changedCount,
          changed: changed ?? status.changed,
        }
      : value.status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getIgnoredRepoRelativePaths(repoPath: string, resolvedOutputPath: string): Set<string> {
  const ignored = new Set<string>(LEGACY_PROOF_ARTIFACTS);
  const relativeOutputPath = toRepoRelativePath(repoPath, resolvedOutputPath);
  if (relativeOutputPath) {
    ignored.add(relativeOutputPath);
  }
  return ignored;
}
