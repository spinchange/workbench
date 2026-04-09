import type { HostShellRunner, ShellArgs, ShellData, ShellPolicyDecision, ToolError, ToolResult } from "../types/index.js";
import type { Tool } from "./registry.js";

interface ShellPolicyAssessment {
  decision: ShellPolicyDecision;
  reason?: string;
  expectedConfirmationToken?: string;
}

export class ShellTool implements Tool<ShellArgs, ShellData> {
  constructor(private readonly runner: HostShellRunner) {}

  async execute(args: ShellArgs): Promise<ToolResult<ShellData>> {
    const started = Date.now();
    const assessment = assessShellCommand(args.command);

    if (assessment.decision === "blocked") {
      return {
        ok: false,
        error: buildPolicyError("destructive_command_blocked", assessment, args.command),
        meta: {
          durationMs: Date.now() - started,
          policyDecision: assessment.decision,
          policyReason: assessment.reason,
          confirmationSatisfied: false,
        },
      };
    }

    if (assessment.decision === "confirm") {
      const confirmed = Boolean(args.allowDestructive) && args.confirmationToken === assessment.expectedConfirmationToken;
      if (!confirmed) {
        return {
          ok: false,
          error: buildPolicyError("confirmation_required", assessment, args.command),
          meta: {
            durationMs: Date.now() - started,
            policyDecision: assessment.decision,
            policyReason: assessment.reason,
            confirmationSatisfied: false,
          },
        };
      }
    }

    try {
      const data = await this.runner(args);
      return {
        ok: true,
        data,
        meta: {
          durationMs: Date.now() - started,
          policyDecision: assessment.decision,
          policyReason: assessment.reason,
          confirmationSatisfied: assessment.decision === "confirm",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          code: "shell_failed",
          message,
        },
        meta: {
          durationMs: Date.now() - started,
          policyDecision: assessment.decision,
          policyReason: assessment.reason,
          confirmationSatisfied: assessment.decision === "confirm",
        },
      };
    }
  }
}

export function unavailableShellRunner(message = "No host shell runner is configured."): HostShellRunner {
  return async () => {
    throw new Error(message);
  };
}

export function createShellConfirmationToken(command: string): string {
  return `confirm:${command.trim().replace(/\s+/g, " ")}`;
}

function buildPolicyError(code: "destructive_command_blocked" | "confirmation_required", assessment: ShellPolicyAssessment, command: string): ToolError {
  if (code === "confirmation_required") {
    return {
      code,
      message: `Confirmation required for ${assessment.reason ?? "risky"} shell command: ${command}. Rerun with allowDestructive: true and confirmationToken: \"${assessment.expectedConfirmationToken}\".`,
      details: {
        expectedConfirmationToken: assessment.expectedConfirmationToken,
        policyDecision: assessment.decision,
        policyReason: assessment.reason,
      },
    };
  }

  return {
    code,
    message: `Blocked ${assessment.reason ?? "risky"} shell command: ${command}.`,
    details: {
      policyDecision: assessment.decision,
      policyReason: assessment.reason,
    },
  };
}

function assessShellCommand(command: string): ShellPolicyAssessment {
  const trimmed = command.trim();
  if (!trimmed) {
    return { decision: "safe" };
  }

  if (isPipeToShellCommand(trimmed)) {
    return { decision: "blocked", reason: "risky shell pipeline" };
  }

  const risk = getCommandRisk(trimmed);
  if (!risk) {
    return { decision: "safe" };
  }

  if (risk.level === "confirm") {
    return {
      decision: "confirm",
      reason: risk.reason,
      expectedConfirmationToken: createShellConfirmationToken(trimmed),
    };
  }

  return {
    decision: "blocked",
    reason: risk.reason,
  };
}

function getCommandRisk(command: string): { level: "confirm" | "blocked"; reason: string } | undefined {
  const segments = splitShellSegments(command);
  for (const segment of segments) {
    const tokens = tokenizeShellSegment(segment);
    const normalizedTokens = stripShellWrappers(tokens).map(normalizeCommandToken);
    if (normalizedTokens.length === 0) {
      continue;
    }

    if (isDynamicEvaluationCommand(normalizedTokens)) {
      return { level: "blocked", reason: "dynamic-evaluation" };
    }

    if (isBlockedSystemLevelCommand(normalizedTokens)) {
      return { level: "blocked", reason: "system-level" };
    }

    if (isConfirmDestructiveCommand(normalizedTokens)) {
      return { level: "confirm", reason: "destructive" };
    }

    if (isConfirmDestructiveGitCommand(normalizedTokens)) {
      return { level: "confirm", reason: "destructive git" };
    }
  }

  return undefined;
}

function isPipeToShellCommand(command: string): boolean {
  const segments = splitShellSegments(command);
  if (segments.length < 2) {
    return false;
  }

  const firstTokens = tokenizeShellSegment(segments[0]).map(normalizeCommandToken);
  const secondTokens = tokenizeShellSegment(segments[1]).map(normalizeCommandToken);
  if (firstTokens.length === 0 || secondTokens.length === 0) {
    return false;
  }

  const left = stripShellWrappers(firstTokens)[0] ?? firstTokens[0];
  const right = secondTokens[0];

  return ["curl", "wget", "invoke-webrequest", "irm", "iwr"].includes(left)
    && ["sh", "bash", "pwsh", "powershell", "powershell.exe", "cmd", "cmd.exe"].includes(right);
}

function splitShellSegments(command: string): string[] {
  return command
    .split(/(?:\r?\n|&&|\|\||;|\|)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function tokenizeShellSegment(segment: string): string[] {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function stripShellWrappers(tokens: string[]): string[] {
  const normalized = [...tokens];

  while (normalized.length > 0) {
    const first = normalizeCommandToken(normalized[0]);
    if (first === "sudo" || first === "command") {
      normalized.shift();
      continue;
    }

    if (first === "cmd" || first === "cmd.exe") {
      normalized.shift();
      if (normalized.length > 0 && ["/c", "-c"].includes(normalizeCommandToken(normalized[0]))) {
        normalized.shift();
      }
      continue;
    }

    if (["pwsh", "powershell", "powershell.exe", "bash", "sh", "zsh"].includes(first)) {
      normalized.shift();
      if (normalized.length > 0 && ["-command", "-c", "-file"].includes(normalizeCommandToken(normalized[0]))) {
        normalized.shift();
      }
      continue;
    }

    break;
  }

  return normalized;
}

function isDynamicEvaluationCommand(tokens: string[]): boolean {
  return ["iex", "invoke-expression", "eval"].includes(tokens[0]);
}

function isConfirmDestructiveCommand(tokens: string[]): boolean {
  const first = tokens[0];
  return ["rm", "rmdir", "del", "erase", "remove-item", "move", "move-item", "mv"].includes(first);
}

function isConfirmDestructiveGitCommand(tokens: string[]): boolean {
  if (tokens[0] !== "git" || tokens.length < 2) {
    return false;
  }

  const subcommand = tokens[1];
  const hasForceFlag = tokens.some((token) => token === "-f" || token === "--force");

  if (subcommand === "clean") {
    return true;
  }

  if (subcommand === "reset" && tokens.includes("--hard")) {
    return true;
  }

  if ((subcommand === "checkout" || subcommand === "switch") && hasForceFlag) {
    return true;
  }

  if (subcommand === "push" && hasForceFlag) {
    return true;
  }

  if (subcommand === "branch" && tokens.includes("-D")) {
    return true;
  }

  if (subcommand === "tag" && (tokens.includes("-d") || tokens.includes("--delete"))) {
    return true;
  }

  return false;
}

function isBlockedSystemLevelCommand(tokens: string[]): boolean {
  const first = tokens[0];
  if (["format", "diskpart", "shutdown", "restart-computer", "stop-computer"].includes(first)) {
    return true;
  }

  return ["sc", "reg"].includes(first) && tokens.some((token) => ["delete", "remove"].includes(token));
}

function normalizeCommandToken(token: string): string {
  return token.toLowerCase().replace(/^['"]|['"]$/g, "");
}
