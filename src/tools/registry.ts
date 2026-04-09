import type { ToolAuditEntry, ToolAuditLogger, ToolName, ToolResult } from "../types/index.js";

export interface Tool<TArgs = unknown, TData = unknown> {
  execute(args: TArgs): Promise<ToolResult<TData>>;
}

export class ToolRegistry {
  private readonly tools = new Map<ToolName, Tool<any, any>>();
  private auditLogger?: ToolAuditLogger;

  register<TArgs, TData>(name: ToolName, tool: Tool<TArgs, TData>): void {
    this.tools.set(name, tool);
  }

  setAuditLogger(logger: ToolAuditLogger): void {
    this.auditLogger = logger;
  }

  async execute<TArgs, TData>(name: ToolName, args: TArgs): Promise<ToolResult<TData>> {
    const tool = this.tools.get(name);
    let result: ToolResult<TData>;

    if (!tool) {
      result = {
        ok: false,
        error: {
          code: "tool_not_found",
          message: `Tool '${name}' is not registered.`,
        },
      };
      await this.logAuditEntry(name, args, result);
      return result;
    }

    result = await tool.execute(args);
    await this.logAuditEntry(name, args, result);
    return result;
  }

  private async logAuditEntry<TArgs, TData>(name: ToolName, args: TArgs, result: ToolResult<TData>): Promise<void> {
    if (!this.auditLogger) {
      return;
    }

    const entry: ToolAuditEntry = {
      at: new Date().toISOString(),
      tool: name,
      args: summarizeValue(args),
      ok: result.ok,
      durationMs: result.meta?.durationMs,
      error: result.error,
      result: summarizeValue(result.data),
      policyDecision: result.meta?.policyDecision,
      policyReason: result.meta?.policyReason,
      confirmationSatisfied: result.meta?.confirmationSatisfied,
    };

    try {
      await this.auditLogger(entry);
    } catch {
      // Audit logging should not break tool execution.
    }
  }
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 197)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null || typeof value === "undefined") {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[array:${value.length}]`;
    }
    return value.slice(0, 10).map((entry) => summarizeValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= 2) {
      return "[object]";
    }

    const record = value as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record).slice(0, 12)) {
      if (key === "contents" && typeof entry === "string") {
        summary[key] = `<redacted:${entry.length} chars>`;
        continue;
      }
      if (key === "confirmationToken" && typeof entry === "string") {
        summary[key] = "<provided>";
        continue;
      }
      summary[key] = summarizeValue(entry, depth + 1);
    }
    return summary;
  }

  return String(value);
}
