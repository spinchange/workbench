import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ToolResult } from "../src/types/index.js";
import { createFileAuditLogger, readAuditLog } from "../src/tools/audit-log.js";
import { ToolRegistry, type Tool } from "../src/tools/registry.js";

class EchoTool implements Tool<{ text: string }, { echoed: string }> {
  async execute(args: { text: string }): Promise<ToolResult<{ echoed: string }>> {
    return {
      ok: true,
      data: { echoed: args.text },
      meta: { durationMs: 5 },
    };
  }
}

test("ToolRegistry writes audit log entries through the file logger", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workbench-audit-"));
  try {
    const registry = new ToolRegistry();
    registry.setAuditLogger(createFileAuditLogger(tempRoot));
    registry.register("project", new EchoTool());

    await registry.execute("project", { text: "hello world" });
    await registry.execute("project", { text: "x".repeat(400) });

    const entries = await readAuditLog(10, tempRoot);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.tool, "project");
    assert.equal(entries[0]?.ok, true);
    assert.match(String((entries[0]?.args as { text?: string }).text), /\.\.\.$/);
    assert.deepEqual(entries[1]?.result, { echoed: "hello world" });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
