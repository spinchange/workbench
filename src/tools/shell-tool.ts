import type { HostShellRunner, ShellArgs, ShellData, ToolResult } from "../types/index.js";
import type { Tool } from "./registry.js";

export class ShellTool implements Tool<ShellArgs, ShellData> {
  constructor(private readonly runner: HostShellRunner) {}

  async execute(args: ShellArgs): Promise<ToolResult<ShellData>> {
    const started = Date.now();
    const blockedReason = getBlockedShellCommandReason(args);

    if (blockedReason) {
      return {
        ok: false,
        error: {
          code: "destructive_command_blocked",
          message: blockedReason,
        },
        meta: { durationMs: Date.now() - started },
      };
    }

    try {
      const data = await this.runner(args);
      return {
        ok: true,
        data,
        meta: { durationMs: Date.now() - started },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          code: "shell_failed",
          message,
        },
        meta: { durationMs: Date.now() - started },
      };
    }
  }
}

export function unavailableShellRunner(message = "No host shell runner is configured."): HostShellRunner {
  return async () => {
    throw new Error(message);
  };
}

function getBlockedShellCommandReason(args: ShellArgs): string | undefined {
  if (args.allowDestructive) {
    return undefined;
  }

  const command = args.command.trim();
  if (!command) {
    return undefined;
  }

  if (isPipeToShellCommand(command)) {
    return `Blocked risky shell pipeline: ${args.command}. Pass allowDestructive: true to bypass this guard.`;
  }

  const risk = getCommandRisk(command);
  if (!risk) {
    return undefined;
  }

  return `Blocked ${risk} shell command: ${args.command}. Pass allowDestructive: true to bypass this guard.`;
}

function getCommandRisk(command: string): string | undefined {
  const segments = splitShellSegments(command);
  for (const segment of segments) {
    const tokens = tokenizeShellSegment(segment);
    const normalizedTokens = stripShellWrappers(tokens).map(normalizeCommandToken);
    if (normalizedTokens.length === 0) {
      continue;
    }

    if (isDynamicEvaluationCommand(normalizedTokens)) {
      return "dynamic-evaluation";
    }

    if (isDirectlyDestructiveCommand(normalizedTokens)) {
      return "destructive";
    }

    if (isDestructiveGitCommand(normalizedTokens)) {
      return "destructive git";
    }

    if (isSystemLevelRiskCommand(normalizedTokens)) {
      return "system-level";
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

function isDirectlyDestructiveCommand(tokens: string[]): boolean {
  const first = tokens[0];
  return [
    "rm",
    "rmdir",
    "del",
    "erase",
    "remove-item",
    "move",
    "move-item",
    "mv",
    "format",
    "diskpart",
    "shutdown",
    "restart-computer",
    "stop-computer",
  ].includes(first);
}

function isDestructiveGitCommand(tokens: string[]): boolean {
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

function isSystemLevelRiskCommand(tokens: string[]): boolean {
  return ["sc", "reg"].includes(tokens[0]) && tokens.some((token) => ["delete", "remove"].includes(token));
}

function normalizeCommandToken(token: string): string {
  return token.toLowerCase().replace(/^['"]|['"]$/g, "");
}
