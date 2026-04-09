import type { SessionSnapshot, SessionState } from "../types/index.js";
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

  createSnapshot(): SessionSnapshot {
    return {
      version: 1,
      cwd: this.state.cwd,
      repo: this.state.repo,
      history: [...this.state.history],
    };
  }

  applySnapshot(snapshot: SessionSnapshot): void {
    if (snapshot.version !== 1) {
      throw new Error(`Unsupported session snapshot version: ${snapshot.version}`);
    }

    this.state.cwd = snapshot.cwd;
    this.state.repo = snapshot.repo;
    this.state.history = [...snapshot.history];
    this.state.loadedBootstraps = [];
    this.setGlobal("cwd", snapshot.cwd);
    this.setGlobal("repo", snapshot.repo ?? null);
    this.setGlobal("wb", {
      cwd: snapshot.cwd,
      repo: snapshot.repo ?? null,
      workspace: undefined,
    });
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
