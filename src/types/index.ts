export type ToolName = "shell" | "fs" | "git" | "http" | "project";

export interface ToolCall<TArgs = unknown> {
  name: ToolName;
  args: TArgs;
}

export interface ToolError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ToolResult<TData = unknown> {
  ok: boolean;
  data?: TData;
  error?: ToolError;
  meta?: {
    durationMs?: number;
    policyDecision?: ShellPolicyDecision;
    policyReason?: string;
    confirmationSatisfied?: boolean;
  };
}

export type ShellPolicyDecision = "safe" | "confirm" | "blocked";

export interface ToolAuditEntry {
  at: string;
  tool: ToolName;
  args: unknown;
  ok: boolean;
  durationMs?: number;
  error?: ToolError;
  result?: unknown;
  policyDecision?: ShellPolicyDecision;
  policyReason?: string;
  confirmationSatisfied?: boolean;
}

export type ToolAuditLogger = (entry: ToolAuditEntry) => void | Promise<void>;

export interface FsEntry {
  name: string;
  type: "dir" | "file" | "other";
}

export type FsArgs =
  | {
      op: "exists";
      path: string;
    }
  | {
      op: "readText";
      path: string;
    }
  | {
      op: "readJson";
      path: string;
    }
  | {
      op: "listDir";
      path: string;
    }
  | {
      op: "mkdir";
      path: string;
      recursive?: boolean;
    }
  | {
      op: "writeText";
      path: string;
      contents: string;
    };

export type FsData =
  | {
      op: "exists";
      path: string;
      exists: boolean;
    }
  | {
      op: "readText";
      path: string;
      text: string;
    }
  | {
      op: "readJson";
      path: string;
      value: unknown;
    }
  | {
      op: "listDir";
      path: string;
      entries: FsEntry[];
    }
  | {
      op: "mkdir";
      path: string;
    }
  | {
      op: "writeText";
      path: string;
    };

export interface ShellArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  allowDestructive?: boolean;
  confirmationToken?: string;
}

export interface ShellData {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

export type HostShellRunner = (args: ShellArgs) => Promise<ShellData>;

export interface WorkbenchHostModule {
  createShellRunner?: () => HostShellRunner | Promise<HostShellRunner>;
  shellRunner?: HostShellRunner;
}

export interface WorkspaceInfo {
  root: string;
  hasGit: boolean;
  hasPackageJson: boolean;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  scripts: string[];
}

export interface SessionState {
  cwd: string;
  repo?: string;
  loadedBootstraps: string[];
  history: string[];
  globals: Record<string, unknown>;
}

export interface SessionSnapshot {
  version: 1;
  cwd: string;
  repo?: string;
  history: string[];
}
