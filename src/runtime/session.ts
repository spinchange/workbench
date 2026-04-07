import type { SessionState } from "../types/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { installBuiltinGlobals } from "./globals.js";
import { SessionEvaluator } from "./evaluator.js";

export class WorkbenchSession {
  readonly state: SessionState;
  readonly globals: Record<string, unknown>;
  readonly evaluator: SessionEvaluator;
  private readonly evaluationContext: Record<string, unknown>;

  constructor(
    cwd: string,
    private readonly tools: ToolRegistry,
  ) {
    this.state = {
      cwd,
      loadedBootstraps: [],
      history: [],
      globals: {},
    };
    this.globals = {};
    this.evaluationContext = {
      console,
    };
    this.evaluator = new SessionEvaluator(this);
  }

  async initialize(): Promise<void> {
    await installBuiltinGlobals(this);
  }

  remember(input: string): void {
    this.state.history.push(input);
  }

  setGlobal(name: string, value: unknown): void {
    this.globals[name] = value;
    this.state.globals[name] = value;
    this.evaluationContext[name] = value;
  }

  getToolRegistry(): ToolRegistry {
    return this.tools;
  }

  getEvaluationContext(): Record<string, unknown> {
    return this.evaluationContext;
  }
}
