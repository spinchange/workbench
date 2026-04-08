import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface ProofSummary {
  file: string;
  repo: string | null;
  status: string | null;
  branchClean: boolean | null;
  hasTestScript: boolean | null;
  testsPassed: boolean | null;
  changedCount: number | null;
  testStepStatus: string | null;
  testReason: string | null;
  recommendedNextAction: string | null;
}

export interface ProofSummaryList {
  proofsDir: string;
  count: number;
  summaries: ProofSummary[];
}

export async function listProofRounds(
  proofsDir = path.join(process.env.USERPROFILE ?? process.cwd(), ".workbench", "proof-rounds"),
): Promise<ProofSummaryList> {
  const entries = await readdir(proofsDir, { withFileTypes: true });
  const proofFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(proofsDir, entry.name));

  const summaries: ProofSummary[] = [];
  for (const proofFile of proofFiles) {
    const artifact = JSON.parse(await readFile(proofFile, "utf8")) as {
      inputs?: { repoPath?: string };
      overallStatus?: string;
      recommendedNextAction?: string;
      steps?: Array<{ id?: string; status?: string; data?: Record<string, unknown> }>;
    };
    const audit = artifact.steps?.find((step) => step.id === "repo_audit")?.data ?? {};
    const testStep = artifact.steps?.find((step) => step.id === "test_or_explain");

    summaries.push({
      file: proofFile,
      repo: artifact.inputs?.repoPath ?? null,
      status: artifact.overallStatus ?? null,
      branchClean: readNestedBoolean(audit, ["preflight", "branchClean"]),
      hasTestScript: readNestedBoolean(audit, ["preflight", "hasTestScript"]),
      testsPassed: readNestedBoolean(audit, ["preflight", "testsPassed"]),
      changedCount: readNestedNumber(audit, ["status", "changedCount"]),
      testStepStatus: testStep?.status ?? null,
      testReason: readNestedString(testStep?.data, ["reason"]),
      recommendedNextAction: artifact.recommendedNextAction ?? null,
    });
  }

  const rank: Record<string, number> = { fail: 0, warn: 1, pass: 2 };
  summaries.sort((left, right) => {
    const leftRank = rank[left.status ?? ""] ?? 99;
    const rightRank = rank[right.status ?? ""] ?? 99;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return String(left.repo).localeCompare(String(right.repo));
  });

  return {
    proofsDir,
    count: summaries.length,
    summaries,
  };
}

function readNestedBoolean(value: unknown, pathParts: string[]): boolean | null {
  const result = readNested(value, pathParts);
  return typeof result === "boolean" ? result : null;
}

function readNestedNumber(value: unknown, pathParts: string[]): number | null {
  const result = readNested(value, pathParts);
  return typeof result === "number" ? result : null;
}

function readNestedString(value: unknown, pathParts: string[]): string | null {
  const result = readNested(value, pathParts);
  return typeof result === "string" ? result : null;
}

function readNested(value: unknown, pathParts: string[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
