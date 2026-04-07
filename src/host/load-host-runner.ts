import path from "node:path";
import { pathToFileURL } from "node:url";
import type { HostShellRunner, WorkbenchHostModule } from "../types/index.js";

export async function loadHostShellRunner(modulePath: string): Promise<HostShellRunner> {
  const absolutePath = path.resolve(modulePath);
  const imported = await import(pathToFileURL(absolutePath).href);
  const hostModule = imported as WorkbenchHostModule;

  if (typeof hostModule.createShellRunner === "function") {
    return hostModule.createShellRunner();
  }

  if (typeof hostModule.shellRunner === "function") {
    return hostModule.shellRunner;
  }

  if (typeof imported.default === "function") {
    return imported.default as HostShellRunner;
  }

  throw new Error(
    `Host module '${absolutePath}' must export createShellRunner(), shellRunner, or a default HostShellRunner.`,
  );
}
