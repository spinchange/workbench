import type { HostShellRunner, ShellArgs, ShellData, ToolResult } from "../types/index.js";
import type { Tool } from "./registry.js";

export class ShellTool implements Tool<ShellArgs, ShellData> {
  constructor(private readonly runner: HostShellRunner) {}

  async execute(args: ShellArgs): Promise<ToolResult<ShellData>> {
    const started = Date.now();

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
