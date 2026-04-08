import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { ToolRegistry } from "../tools/registry.js";
import { ShellTool, unavailableShellRunner } from "../tools/shell-tool.js";
import { WorkbenchSession } from "../runtime/session.js";
import { loadBootstrap } from "../bootstrap/load-bootstrap.js";
import { loadHostShellRunner } from "../host/load-host-runner.js";
import { runProofRound } from "../proof/run-proof-round.js";

async function main(): Promise<void> {
  const { repoPath, evalInput, hostModulePath, proofOptions } = parseArgs(process.argv.slice(2));
  const registry = new ToolRegistry();
  const shellRunner = hostModulePath
    ? await loadHostShellRunner(hostModulePath)
    : unavailableShellRunner(
      "No host shell runner is configured. This build can evaluate JavaScript, but repo helpers that require shell access need a host-provided runner.",
    );
  registry.register(
    "shell",
    new ShellTool(shellRunner),
  );

  const session = new WorkbenchSession(process.cwd(), registry);
  await session.initialize();
  if (repoPath) {
    await (session.globals.setRepo as (repoPath: string) => Promise<unknown>)(repoPath);
  }
  await loadBootstrap(session, session.state.repo);

  if (proofOptions) {
    const artifact = await runProofRound(session, proofOptions);
    printResult(artifact);
    return;
  }

  if (evalInput) {
    const result = await session.evaluator.evaluate(evalInput);
    printResult(result);
    return;
  }

  console.log("Workbench proof slice ready.");
  console.log("Type JavaScript and press Enter. Use .exit to quit.");
  console.log(
    "Shell status:",
    hostModulePath
      ? `host runner loaded from ${path.resolve(hostModulePath)}`
      : "host runner not configured in this standalone CLI build.",
  );
  console.log("Available globals:", Object.keys(session.globals).sort().join(", "));
  await runRepl(session);
}

void main();

async function runRepl(session: WorkbenchSession): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const line = await rl.question("workbench> ");
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed === ".exit") {
        break;
      }
      try {
        const result = await session.evaluator.evaluate(line);
        printResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(message);
      }
    }
  } finally {
    rl.close();
  }
}

function printResult(result: unknown): void {
  if (typeof result === "undefined") {
    return;
  }
  if (typeof result === "string") {
    console.log(result);
    return;
  }
  console.dir(result, { depth: 6, colors: true });
}

function parseArgs(args: string[]): {
  repoPath?: string;
  evalInput?: string;
  hostModulePath?: string;
  proofOptions?: {
    repoPath: string;
    outputPath?: string;
    searchPattern?: string;
  };
} {
  let repoPath: string | undefined;
  let evalInput: string | undefined;
  let hostModulePath: string | undefined;
  let proofOptions: { repoPath: string; outputPath?: string; searchPattern?: string } | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      repoPath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--host") {
      hostModulePath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "proof") {
      const nextProofOptions: { repoPath?: string; outputPath?: string; searchPattern?: string } = {};
      for (let proofIndex = index + 1; proofIndex < args.length; proofIndex += 1) {
        const proofArg = args[proofIndex];
        if (proofArg === "--repo") {
          nextProofOptions.repoPath = args[proofIndex + 1];
          proofIndex += 1;
          continue;
        }
        if (proofArg === "--output") {
          nextProofOptions.outputPath = args[proofIndex + 1];
          proofIndex += 1;
          continue;
        }
        if (proofArg === "--search") {
          nextProofOptions.searchPattern = args[proofIndex + 1];
          proofIndex += 1;
          continue;
        }
      }
      if (!nextProofOptions.repoPath) {
        throw new Error("proof requires --repo <path>");
      }
      proofOptions = {
        repoPath: nextProofOptions.repoPath,
        outputPath: nextProofOptions.outputPath,
        searchPattern: nextProofOptions.searchPattern,
      };
      break;
    }
    if (arg === "eval") {
      evalInput = args.slice(index + 1).join(" ");
      break;
    }
  }

  return { repoPath, evalInput, hostModulePath, proofOptions };
}
