import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolAuditEntry, ToolAuditLogger } from "../types/index.js";

export function createFileAuditLogger(baseDir = getDefaultBaseDir()): ToolAuditLogger {
  const logPath = getAuditLogPath(baseDir);
  return async (entry) => {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  };
}

export async function readAuditLog(limit = 20, baseDir = getDefaultBaseDir()): Promise<ToolAuditEntry[]> {
  const logPath = getAuditLogPath(baseDir);
  try {
    const text = await readFile(logPath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ToolAuditEntry)
      .slice(-Math.max(0, limit))
      .reverse();
  } catch {
    return [];
  }
}

export function getAuditLogPath(baseDir = getDefaultBaseDir()): string {
  return path.join(baseDir, ".workbench", "audit-log.jsonl");
}

function getDefaultBaseDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
}
