import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionSnapshot } from "../types/index.js";

export interface SessionStoreOptions {
  baseDir?: string;
}

export function getSessionStoreRoot(baseDir = getDefaultBaseDir()): string {
  return path.join(baseDir, ".workbench", "sessions");
}

export function getSessionSnapshotPath(name: string, baseDir = getDefaultBaseDir()): string {
  return path.join(getSessionStoreRoot(baseDir), `${normalizeSessionName(name)}.json`);
}

export async function saveSessionSnapshot(
  name: string,
  snapshot: SessionSnapshot,
  options: SessionStoreOptions = {},
): Promise<string> {
  const filePath = getSessionSnapshotPath(name, options.baseDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return filePath;
}

export async function loadSessionSnapshot(
  name: string,
  options: SessionStoreOptions = {},
): Promise<SessionSnapshot> {
  const filePath = getSessionSnapshotPath(name, options.baseDir);
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return validateSessionSnapshot(parsed, filePath);
}

export function validateSessionSnapshot(value: unknown, source = "session snapshot"): SessionSnapshot {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${source}: expected an object.`);
  }
  if (value.version !== 1) {
    throw new Error(`Invalid ${source}: unsupported version.`);
  }
  if (typeof value.cwd !== "string" || value.cwd.length === 0) {
    throw new Error(`Invalid ${source}: missing cwd.`);
  }
  if (typeof value.repo !== "undefined" && typeof value.repo !== "string") {
    throw new Error(`Invalid ${source}: repo must be a string if present.`);
  }
  if (!Array.isArray(value.history) || value.history.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid ${source}: history must be a string array.`);
  }

  return {
    version: 1,
    cwd: value.cwd,
    repo: value.repo,
    history: [...value.history],
  };
}

function getDefaultBaseDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
}

function normalizeSessionName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Session name is required.");
  }

  const normalized = trimmed
    .replace(/[:\\\/<>\"|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    throw new Error("Session name is required.");
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
