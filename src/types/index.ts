export type ToolName = "shell" | "fs" | "git" | "http" | "project";

export interface ToolCall<TArgs = unknown> {
  name: ToolName;
  args: TArgs;
}

export interface ToolError {
  code: string;
  message: string;
}

export interface ToolResult<TData = unknown> {
  ok: boolean;
  data?: TData;
  error?: ToolError;
  meta?: {
    durationMs?: number;
  };
}

export interface ShellArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
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
