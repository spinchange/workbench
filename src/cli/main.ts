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
import { createShellConfirmationToken } from "../tools/shell-tool.js";
import { listRegisteredRepos, resolveRegisteredRepo, saveRegisteredRepo } from "../workspace/repo-registry.js";
import type { ToolAuditEntry, ToolError } from "../types/index.js";

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
    reposCommand,
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

  if (reposCommand) {
    if (reposCommand.action === "list") {
      printResult(await listRegisteredRepos());
      return;
    }
    if (reposCommand.action === "add") {
      const entry = await saveRegisteredRepo(reposCommand.name, reposCommand.path);
      printResult(entry);
      return;
    }
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
    try {
      const result = await session.evaluator.evaluate(evalInput);
      printResult(result);
    } catch (error) {
      const retry = await maybeConfirmAndRetryCommand(session, error);
      if (typeof retry !== "undefined") {
        printResult(retry);
      } else {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(message);
      }
    }
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
        const retry = await maybeConfirmAndRetryCommand(session, error);
        if (typeof retry !== "undefined") {
          printResult(retry);
          continue;
        }
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(message);
      }
    }
  } finally {
    rl.close();
  }
}

async function maybeConfirmAndRetryCommand(session: WorkbenchSession, error: unknown): Promise<unknown | undefined> {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const details = (error as Error & { details?: Record<string, unknown> }).details;
  if (!details || typeof details.expectedConfirmationToken !== "string") {
    return undefined;
  }

  const command = extractCommandFromConfirmationToken(details.expectedConfirmationToken);
  if (!command) {
    return undefined;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Confirm risky command? ${command} [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) {
      return {
        ok: false,
        action: "cancelled",
        command,
      };
    }
  } finally {
    rl.close();
  }

  return (session.globals.runConfirmed as (command: string) => Promise<string>)(command);
}

function extractCommandFromConfirmationToken(token: string): string | undefined {
  if (!token.startsWith("confirm:")) {
    return undefined;
  }
  const command = token.slice("confirm:".length).trim();
  return command || undefined;
}

async function handleSlashCommand(session: WorkbenchSession, inputLine: string): Promise<unknown | "exit"> {
  const [command, ...rest] = inputLine.slice(1).trim().split(/\s+/);
  switch (command) {
    case "help":
      return [
        "/help",
        "/globals",
        "/session",
        "/repos",
        "/repo <path-or-name>",
        "/save-repo <name> [path]",
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
    case "repos":
      return listRegisteredRepos();
    case "repo": {
      const repoInput = inputLine.slice(inputLine.indexOf(command) + command.length).trim();
      if (!repoInput) {
        throw new Error("/repo requires a path or registered name");
      }
      const resolved = await resolveRegisteredRepo(repoInput).catch(() => repoInput);
      return (session.globals.setRepo as (repoPath: string) => Promise<unknown>)(resolved);
    }
    case "save-repo": {
      const name = rest[0];
      const repoPath = rest.slice(1).join(" ").trim() || session.state.repo || session.state.cwd;
      if (!name) {
        throw new Error("/save-repo requires a name");
      }
      return saveRegisteredRepo(name, repoPath);
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
        const policy = entry.policyDecision ? ` policy:${entry.policyDecision}` : "";
        const confirmation = entry.policyDecision === "confirm"
          ? ` confirmed:${entry.confirmationSatisfied ? "yes" : "no"}`
          : "";
        return `${entry.at} ${entry.tool} ${status}${policy}${confirmation} ${formatAuditArgs(entry.args)}`.trim();
      })
      .join("\n");
  }

  if (isSessionActionResult(result)) {
    const pathText = typeof result.path === "string" ? ` -> ${result.path}` : "";
    return `${result.action} session '${result.name}'${pathText}\nrepo: ${result.repo ?? "(none)"}\nhistory: ${result.historyCount}`;
  }

  if (isRepoEntry(result)) {
    return `repo '${result.name}' -> ${result.path}`;
  }

  if (isCancelledAction(result)) {
    return `Cancelled risky command: ${result.command}`;
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

function isRepoEntry(value: unknown): value is { name: string; path: string } {
  return typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string" && typeof (value as { path?: unknown }).path === "string";
}

function isCancelledAction(value: unknown): value is { action: "cancelled"; command: string } {
  return typeof value === "object" && value !== null && (value as { action?: unknown }).action === "cancelled" && typeof (value as { command?: unknown }).command === "string";
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
  reposCommand?:
    | { action: "list" }
    | { action: "add"; name: string; path: string };
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
  let reposCommand: { action: "list" } | { action: "add"; name: string; path: string } | undefined;
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
    if (arg === "repos") {
      const action = args[index + 1];
      if (action === "list") {
        reposCommand = { action: "list" };
        break;
      }
      if (action === "add") {
        const name = args[index + 2];
        const repoTarget = args[index + 3];
        if (!name || !repoTarget) {
          throw new Error("repos add requires <name> <path>");
        }
        reposCommand = { action: "add", name, path: repoTarget };
        break;
      }
      throw new Error("repos requires 'list' or 'add <name> <path>'");
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

  return { repoPath, evalInput, hostModulePath, proofListRequested, proofListDir, sessionCommand, reposCommand, auditCommand, proofOptions };
}
