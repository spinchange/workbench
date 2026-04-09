import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RepoRegistryEntry {
  name: string;
  path: string;
  savedAt: string;
}

interface RepoRegistryFile {
  version: 1;
  repos: RepoRegistryEntry[];
}

export async function listRegisteredRepos(baseDir = getDefaultBaseDir()): Promise<RepoRegistryEntry[]> {
  const registry = await readRegistryFile(baseDir);
  return [...registry.repos].sort((left, right) => left.name.localeCompare(right.name));
}

export async function saveRegisteredRepo(name: string, repoPath: string, baseDir = getDefaultBaseDir()): Promise<RepoRegistryEntry> {
  const registry = await readRegistryFile(baseDir);
  const entry: RepoRegistryEntry = {
    name: normalizeRepoName(name),
    path: path.resolve(repoPath),
    savedAt: new Date().toISOString(),
  };
  const nextRepos = registry.repos.filter((repo) => repo.name !== entry.name);
  nextRepos.push(entry);
  await writeRegistryFile({ version: 1, repos: nextRepos }, baseDir);
  return entry;
}

export async function resolveRegisteredRepo(nameOrPath: string, baseDir = getDefaultBaseDir()): Promise<string> {
  const trimmed = nameOrPath.trim();
  if (!trimmed) {
    throw new Error("Repo name or path is required.");
  }
  if (path.isAbsolute(trimmed) || trimmed.includes("\\") || trimmed.includes("/")) {
    return path.resolve(trimmed);
  }
  const registry = await readRegistryFile(baseDir);
  const match = registry.repos.find((repo) => repo.name === normalizeRepoName(trimmed));
  if (!match) {
    throw new Error(`Unknown repo: ${trimmed}`);
  }
  return match.path;
}

export function toProjectPath(repoPath: string, ...segments: string[]): string {
  return path.join(path.resolve(repoPath), ...segments);
}

function getRegistryPath(baseDir = getDefaultBaseDir()): string {
  return path.join(baseDir, ".workbench", "repos.json");
}

async function readRegistryFile(baseDir: string): Promise<RepoRegistryFile> {
  try {
    const parsed = JSON.parse(await readFile(getRegistryPath(baseDir), "utf8")) as RepoRegistryFile;
    if (parsed.version === 1 && Array.isArray(parsed.repos)) {
      return {
        version: 1,
        repos: parsed.repos.filter((entry): entry is RepoRegistryEntry => {
          return typeof entry?.name === "string"
            && typeof entry?.path === "string"
            && typeof entry?.savedAt === "string";
        }),
      };
    }
  } catch {
    // Fall back to empty registry.
  }
  return { version: 1, repos: [] };
}

async function writeRegistryFile(registry: RepoRegistryFile, baseDir: string): Promise<void> {
  const targetPath = getRegistryPath(baseDir);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function normalizeRepoName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Repo name is required.");
  }
  return normalized;
}

function getDefaultBaseDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
}
