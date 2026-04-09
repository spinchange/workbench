import type { ToolAuditEntry } from "../types/index.js";

export const REPL_HELP_TEXT = [
  "/help",
  "/globals",
  "/session",
  "/repos",
  "/repo <path-or-name>",
  "/save-repo <name> [path]",
  "/save <name>",
  "/load <name>",
  "/audit [limit]",
  "/exit",
].join("\n");

export function renderResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result;
  }

  if (Array.isArray(result) && result.every((entry) => isAuditEntry(entry))) {
    const entries = result as ToolAuditEntry[];
    if (entries.length === 0) {
      return "No audit entries.";
    }
    return entries
      .map((entry) => {
        const status = entry.ok ? "ok" : `error:${entry.error?.code ?? "unknown"}`;
        const policy = entry.policyDecision ? ` policy:${entry.policyDecision}` : "";
        const confirmation = entry.policyDecision === "confirm"
          ? ` confirmed:${entry.confirmationSatisfied ? "yes" : "no"}`
          : "";
        return `${entry.at} ${entry.tool} ${status}${policy}${confirmation} ${formatAuditArgs(entry.args)}`.trim();
      })
      .join("\n");
  }

  if (isSessionActionResult(result)) {
    const pathText = typeof result.path === "string" ? ` -> ${result.path}` : "";
    return `${result.action} session '${result.name}'${pathText}\nrepo: ${result.repo ?? "(none)"}\nhistory: ${result.historyCount}`;
  }

  if (isRepoEntry(result)) {
    return `repo '${result.name}' -> ${result.path}`;
  }

  if (isCancelledAction(result)) {
    return `Cancelled risky command: ${result.command}`;
  }

  return undefined;
}

function formatAuditArgs(args: unknown): string {
  if (typeof args === "string") {
    return args;
  }
  if (typeof args === "object" && args !== null) {
    return JSON.stringify(args);
  }
  return String(args);
}

function isAuditEntry(value: unknown): value is ToolAuditEntry {
  return typeof value === "object"
    && value !== null
    && typeof (value as { tool?: unknown }).tool === "string"
    && typeof (value as { at?: unknown }).at === "string";
}

function isSessionActionResult(value: unknown): value is {
  action: "save" | "load";
  name: string;
  path?: string;
  repo: string | null;
  historyCount: number;
} {
  return typeof value === "object"
    && value !== null
    && ((value as { action?: unknown }).action === "save" || (value as { action?: unknown }).action === "load")
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { historyCount?: unknown }).historyCount === "number";
}

function isRepoEntry(value: unknown): value is { name: string; path: string } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { path?: unknown }).path === "string";
}

function isCancelledAction(value: unknown): value is { action: "cancelled"; command: string } {
  return typeof value === "object"
    && value !== null
    && (value as { action?: unknown }).action === "cancelled"
    && typeof (value as { command?: unknown }).command === "string";
}
