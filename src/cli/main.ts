import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { ToolRegistry } from "../tools/registry.js";
import { FsTool } from "../tools/fs-tool.js";
import { ShellTool, unavailableShellRunner } from "../tools/shell-tool.js";
import { WorkbenchSession } from "../runtime/session.js";
import { loadBootstrap } from "../bootstrap/load-bootstrap.js";
import { loadHostShellRunner } from "../host/load-host-runner.js";
import { listProofRounds } from "../proof/list-proof-rounds.js";
import { runProofRound } from "../proof/run-proof-round.js";
import { loadSessionSnapshot, saveSessionSnapshot } from "../runtime/session-store.js";
import { createFileAuditLogger, readAuditLog } from "../tools/audit-log.js";
import type { ToolAuditEntry } from "../types/index.js";

async function main(): Promise<void> {
  const {
    repoPath,
    evalInput,
    hostModulePath,
    proofOptions,
    proofListRequested,
    proofListDir,
    sessionCommand,
    auditCommand,
  } = parseArgs(process.argv.slice(2));
  const registry = new ToolRegistry();
  registry.setAuditLogger(createFileAuditLogger());
  const shellRunner = hostModulePath
    ? await loadHostShellRunner(hostModulePath)
    : unavailableShellRunner(
      "No host shell runner is configured. This build can evaluate JavaScript, but repo helpers that require shell access need a host-provided runner.",
    );
  registry.register("fs", new FsTool());
  registry.register(
    "shell",
    new ShellTool(shellRunner),
  );

  const session = new WorkbenchSession(process.cwd(), registry);
  await session.initialize();
  if (repoPath) {
    await (session.globals.setRepo as (repoPath: string) => Promise<unknown>)(repoPath);
  }

  if (sessionCommand?.action === "load") {
    const snapshot = await loadSessionSnapshot(sessionCommand.name);
    session.applySnapshot(snapshot);
    if (snapshot.repo) {
      await (session.globals.setRepo as (repoPath: string) => Promise<unknown>)(snapshot.repo);
    }
    await loadBootstrap(session, session.state.repo);
    printResult({
      ok: true,
      action: "load",
      name: sessionCommand.name,
      cwd: session.state.cwd,
      repo: session.state.repo ?? null,
      historyCount: session.state.history.length,
    });
    return;
  }

  await loadBootstrap(session, session.state.repo);

  if (sessionCommand?.action === "save") {
    const snapshot = session.createSnapshot();
    const filePath = await saveSessionSnapshot(sessionCommand.name, snapshot);
    printResult({
      ok: true,
      action: "save",
      name: sessionCommand.name,
      path: filePath,
      cwd: snapshot.cwd,
      repo: snapshot.repo ?? null,
      historyCount: snapshot.history.length,
    });
    return;
  }

  if (auditCommand) {
    printResult(await readAuditLog(auditCommand.limit));
    return;
  }

  if (proofListRequested) {
    const summaries = await listProofRounds(proofListDir);
    printResult(summaries);
    return;
  }

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
  console.log("Type JavaScript and press Enter. Use .exit or /exit to quit.");
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
      if (trimmed.startsWith("/")) {
        const commandResult = await handleSlashCommand(session, trimmed);
        if (commandResult === "exit") {
          break;
        }
        printResult(commandResult);
        continue;
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

async function handleSlashCommand(session: WorkbenchSession, inputLine: string): Promise<unknown | "exit"> {
  const [command, ...rest] = inputLine.slice(1).trim().split(/\s+/);
  switch (command) {
    case "help":
      return [
        "/help",
        "/globals",
        "/session",
        "/repo <path>",
        "/save <name>",
        "/load <name>",
        "/audit [limit]",
        "/exit",
      ].join("\n");
    case "globals":
      return Object.keys(session.globals).sort();
    case "session":
      return {
        cwd: session.state.cwd,
        repo: session.state.repo ?? null,
        historyCount: session.state.history.length,
        loadedBootstraps: [...session.state.loadedBootstraps],
      };
    case "repo": {
      const repoPath = inputLine.slice(inputLine.indexOf(command) + command.length).trim();
      if (!repoPath) {
        throw new Error("/repo requires a path");
      }
      return (session.globals.setRepo as (repoPath: string) => Promise<unknown>)(repoPath);
    }
    case "save": {
      const name = rest.join(" ").trim();
      if (!name) {
        throw new Error("/save requires a session name");
      }
      const snapshot = session.createSnapshot();
      const filePath = await saveSessionSnapshot(name, snapshot);
      return {
        ok: true,
        action: "save",
        name,
        path: filePath,
        cwd: snapshot.cwd,
        repo: snapshot.repo ?? null,
        historyCount: snapshot.history.length,
      };
    }
    case "load": {
      const name = rest.join(" ").trim();
      if (!name) {
        throw new Error("/load requires a session name");
      }
      const snapshot = await loadSessionSnapshot(name);
      session.applySnapshot(snapshot);
      if (snapshot.repo) {
        await (session.globals.setRepo as (repoPath: string) => Promise<unknown>)(snapshot.repo);
      }
      await loadBootstrap(session, session.state.repo);
      return {
        ok: true,
        action: "load",
        name,
        cwd: session.state.cwd,
        repo: session.state.repo ?? null,
        historyCount: session.state.history.length,
      };
    }
    case "audit": {
      const limit = Number.parseInt(rest[0] ?? "10", 10);
      return readAuditLog(Number.isNaN(limit) ? 10 : limit);
    }
    case "exit":
      return "exit";
    default:
      throw new Error(`Unknown slash command: /${command}`);
  }
}

function printResult(result: unknown): void {
  if (typeof result === "undefined") {
    return;
  }

  const rendered = renderResult(result);
  if (typeof rendered === "string") {
    console.log(rendered);
    return;
  }

  console.dir(result, { depth: 6, colors: true });
}

function renderResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result;
  }

  if (Array.isArray(result) && result.every((entry) => isAuditEntry(entry))) {
    const entries = result as ToolAuditEntry[];
    if (entries.length === 0) {
      return "No audit entries.";
    }
    return entries
      .map((entry) => {
        const status = entry.ok ? "ok" : `error:${entry.error?.code ?? "unknown"}`;
        return `${entry.at} ${entry.tool} ${status} ${formatAuditArgs(entry.args)}`.trim();
      })
      .join("\n");
  }

  if (isSessionActionResult(result)) {
    const pathText = typeof result.path === "string" ? ` -> ${result.path}` : "";
    return `${result.action} session '${result.name}'${pathText}\nrepo: ${result.repo ?? "(none)"}\nhistory: ${result.historyCount}`;
  }

  return undefined;
}

function formatAuditArgs(args: unknown): string {
  if (typeof args === "string") {
    return args;
  }
  if (typeof args === "object" && args !== null) {
    return JSON.stringify(args);
  }
  return String(args);
}

function isAuditEntry(value: unknown): value is ToolAuditEntry {
  return typeof value === "object" && value !== null && typeof (value as { tool?: unknown }).tool === "string" && typeof (value as { at?: unknown }).at === "string";
}

function isSessionActionResult(value: unknown): value is {
  action: "save" | "load";
  name: string;
  path?: string;
  repo: string | null;
  historyCount: number;
} {
  return typeof value === "object"
    && value !== null
    && ((value as { action?: unknown }).action === "save" || (value as { action?: unknown }).action === "load")
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { historyCount?: unknown }).historyCount === "number";
}

function parseArgs(args: string[]): {
  repoPath?: string;
  evalInput?: string;
  hostModulePath?: string;
  proofListRequested?: boolean;
  proofListDir?: string;
  sessionCommand?: {
    action: "save" | "load";
    name: string;
  };
  auditCommand?: {
    limit: number;
  };
  proofOptions?: {
    repoPath: string;
    outputPath?: string;
    searchPattern?: string;
  };
} {
  let repoPath: string | undefined;
  let evalInput: string | undefined;
  let hostModulePath: string | undefined;
  let proofListRequested = false;
  let proofListDir: string | undefined;
  let sessionCommand: { action: "save" | "load"; name: string } | undefined;
  let auditCommand: { limit: number } | undefined;
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
    if (arg === "sessions") {
      const action = args[index + 1];
      const name = args[index + 2];
      if ((action === "save" || action === "load") && name) {
        sessionCommand = { action, name };
        break;
      }
      throw new Error("sessions requires 'save <name>' or 'load <name>'");
    }
    if (arg === "audit") {
      let limit = 10;
      for (let auditIndex = index + 1; auditIndex < args.length; auditIndex += 1) {
        if (args[auditIndex] === "--limit") {
          limit = Number.parseInt(args[auditIndex + 1] ?? "10", 10);
          auditIndex += 1;
        }
      }
      auditCommand = { limit: Number.isNaN(limit) ? 10 : limit };
      break;
    }
    if (arg === "proof") {
      if (args[index + 1] === "list") {
        proofListRequested = true;
        for (let proofIndex = index + 2; proofIndex < args.length; proofIndex += 1) {
          const proofArg = args[proofIndex];
          if (proofArg === "--dir") {
            proofListDir = args[proofIndex + 1];
            proofIndex += 1;
          }
        }
        break;
      }
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

  return { repoPath, evalInput, hostModulePath, proofListRequested, proofListDir, sessionCommand, auditCommand, proofOptions };
}
