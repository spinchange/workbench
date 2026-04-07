import type { ToolName, ToolResult } from "../types/index.js";

export interface Tool<TArgs = unknown, TData = unknown> {
  execute(args: TArgs): Promise<ToolResult<TData>>;
}

export class ToolRegistry {
  private readonly tools = new Map<ToolName, Tool<any, any>>();

  register<TArgs, TData>(name: ToolName, tool: Tool<TArgs, TData>): void {
    this.tools.set(name, tool);
  }

  async execute<TArgs, TData>(name: ToolName, args: TArgs): Promise<ToolResult<TData>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: {
          code: "tool_not_found",
          message: `Tool '${name}' is not registered.`,
        },
      };
    }

    return tool.execute(args);
  }
}
