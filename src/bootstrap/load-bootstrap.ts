import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkbenchSession } from "../runtime/session.js";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function loadBootstrap(session: WorkbenchSession, repoPath?: string): Promise<string[]> {
  const loaded: string[] = [];
  const globalBootstrap = path.join(process.env.USERPROFILE ?? session.state.cwd, ".workbench", "session-start.mjs");
  const repoBootstrap = repoPath ? path.join(repoPath, ".workbench", "session-start.mjs") : undefined;

  if (await exists(globalBootstrap)) {
    await runBootstrapModule(globalBootstrap, session);
    loaded.push(globalBootstrap);
  }

  if (repoBootstrap && await exists(repoBootstrap)) {
    await runBootstrapModule(repoBootstrap, session);
    loaded.push(repoBootstrap);
  }

  session.state.loadedBootstraps.push(...loaded);
  return loaded;
}

async function runBootstrapModule(modulePath: string, session: WorkbenchSession): Promise<void> {
  const imported = await import(pathToFileURL(modulePath).href);
  const register = imported.default ?? imported.register;
  if (typeof register === "function") {
    await register(session);
  }
}
