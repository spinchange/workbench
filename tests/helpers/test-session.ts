import { WorkbenchSession } from "../../src/runtime/session.js";
import { FsTool } from "../../src/tools/fs-tool.js";
import { ShellTool } from "../../src/tools/shell-tool.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { HostShellRunner, ShellArgs, ShellData } from "../../src/types/index.js";

export interface TestSessionHarness {
  session: WorkbenchSession;
  shellCalls: ShellArgs[];
}

export function createShellData(stdout = "", stderr = "", exitCode = 0): ShellData {
  return {
    stdout,
    stderr,
    exitCode,
    combined: `${stdout}${stderr}`,
  };
}

export async function createTestSession(
  cwd: string,
  runner: HostShellRunner = async () => {
    throw new Error("unexpected shell command");
  },
): Promise<TestSessionHarness> {
  const shellCalls: ShellArgs[] = [];
  const registry = new ToolRegistry();
  registry.register("fs", new FsTool());
  registry.register(
    "shell",
    new ShellTool(async (args) => {
      shellCalls.push({ ...args });
      return runner(args);
    }),
  );

  const session = new WorkbenchSession(cwd, registry);
  await session.initialize();
  return { session, shellCalls };
}
