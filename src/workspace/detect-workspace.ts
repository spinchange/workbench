import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceInfo } from "../types/index.js";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(root: string): Promise<WorkspaceInfo["packageManager"]> {
  const lockfiles = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ] as const;

  for (const [file, manager] of lockfiles) {
    if (await exists(path.join(root, file))) {
      return manager;
    }
  }

  return "unknown";
}

export async function detectWorkspace(root: string): Promise<WorkspaceInfo> {
  const hasGit = await exists(path.join(root, ".git"));
  const packageJsonPath = path.join(root, "package.json");
  const hasPackageJson = await exists(packageJsonPath);

  let scripts: string[] = [];
  if (hasPackageJson) {
    const text = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(text) as { scripts?: Record<string, string> };
    scripts = Object.keys(parsed.scripts ?? {});
  }

  return {
    root,
    hasGit,
    hasPackageJson,
    packageManager: await detectPackageManager(root),
    scripts,
  };
}
