import type { WorkbenchSession } from "./session.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (context: Record<string, unknown>) => Promise<unknown>;

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

export class SessionEvaluator {
  constructor(private readonly session: WorkbenchSession) {}

  async evaluate(input: string): Promise<unknown> {
    this.session.remember(input);
    const context = this.session.getEvaluationContext();

    try {
      return await this.evaluateAsExpression(input, context);
    } catch (error) {
      if (!isSyntaxError(error)) {
        throw error;
      }
    }

    return this.evaluateAsStatements(input, context);
  }

  private async evaluateAsExpression(input: string, context: Record<string, unknown>): Promise<unknown> {
    const fn = new AsyncFunction(
      "context",
      `
        const globalThis = context;
        with (context) {
          return await (${input});
        }
      `,
    );
    return fn(context);
  }

  private async evaluateAsStatements(input: string, context: Record<string, unknown>): Promise<unknown> {
    const fn = new AsyncFunction(
      "context",
      `
        const globalThis = context;
        with (context) {
          ${input}
        }
      `,
    );
    return fn(context);
  }
}
