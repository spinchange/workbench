import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./registry.js";
import type { FsArgs, FsData, FsEntry, ToolResult } from "../types/index.js";

export class FsTool implements Tool<FsArgs, FsData> {
  async execute(args: FsArgs): Promise<ToolResult<FsData>> {
    const started = Date.now();

    try {
      switch (args.op) {
        case "exists":
          return {
            ok: true,
            data: {
              op: "exists",
              path: args.path,
              exists: await exists(args.path),
            },
            meta: { durationMs: Date.now() - started },
          };
        case "readText":
          return {
            ok: true,
            data: {
              op: "readText",
              path: args.path,
              text: await readFile(args.path, "utf8"),
            },
            meta: { durationMs: Date.now() - started },
          };
        case "readJson": {
          const text = await readFile(args.path, "utf8");
          return {
            ok: true,
            data: {
              op: "readJson",
              path: args.path,
              value: JSON.parse(text),
            },
            meta: { durationMs: Date.now() - started },
          };
        }
        case "listDir": {
          const entries = await readdir(args.path, { withFileTypes: true });
          return {
            ok: true,
            data: {
              op: "listDir",
              path: args.path,
              entries: entries.map(toFsEntry),
            },
            meta: { durationMs: Date.now() - started },
          };
        }
        case "mkdir":
          await mkdir(args.path, { recursive: args.recursive ?? true });
          return {
            ok: true,
            data: {
              op: "mkdir",
              path: args.path,
            },
            meta: { durationMs: Date.now() - started },
          };
        case "writeText":
          await writeFile(args.path, args.contents, "utf8");
          return {
            ok: true,
            data: {
              op: "writeText",
              path: args.path,
            },
            meta: { durationMs: Date.now() - started },
          };
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "fs_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        meta: { durationMs: Date.now() - started },
      };
    }
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function toFsEntry(entry: { name: string; isDirectory(): boolean; isFile(): boolean }): FsEntry {
  return {
    name: entry.name,
    type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
  };
}
