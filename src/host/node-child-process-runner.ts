import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HostShellRunner, ShellData } from "../types/index.js";

const execFileAsync = promisify(execFile);

export function createShellRunner(): HostShellRunner {
  return async ({ command, cwd, timeoutMs }) => {
    const { stdout, stderr } = await execFileAsync(
      "pwsh",
      ["-NoProfile", "-Command", command],
      {
        cwd,
        timeout: timeoutMs ?? 20_000,
        windowsHide: true,
      },
    );

    const data: ShellData = {
      exitCode: 0,
      stdout,
      stderr,
      combined: `${stdout}${stderr}`,
    };

    return data;
  };
}
