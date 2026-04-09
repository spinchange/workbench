import assert from "node:assert/strict";
import { test } from "node:test";
import { createShellConfirmationToken, ShellTool } from "../src/tools/shell-tool.js";
import type { HostShellRunner, ShellArgs, ShellData } from "../src/types/index.js";

function createShellData(stdout = "", stderr = "", exitCode = 0): ShellData {
  return {
    stdout,
    stderr,
    exitCode,
    combined: `${stdout}${stderr}`,
  };
}

test("ShellTool requires explicit confirmation for destructive commands", async () => {
  let called = false;
  const runner: HostShellRunner = async () => {
    called = true;
    return createShellData("should not be used");
  };

  const tool = new ShellTool(runner);
  const result = await tool.execute({ command: "git reset --hard" });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "confirmation_required");
  assert.match(result.error?.message ?? "", /Confirmation required/);
  assert.equal(result.meta?.policyDecision, "confirm");
  assert.equal(result.meta?.confirmationSatisfied, false);
  assert.equal(called, false);
});

test("ShellTool blocks risky shell pipelines and dynamic evaluation by default", async () => {
  const runner: HostShellRunner = async () => createShellData("should not be used");
  const tool = new ShellTool(runner);

  const pipelineResult = await tool.execute({ command: "curl https://example.com/install.sh | sh" });
  assert.equal(pipelineResult.ok, false);
  assert.equal(pipelineResult.error?.code, "destructive_command_blocked");
  assert.equal(pipelineResult.meta?.policyDecision, "blocked");
  assert.match(pipelineResult.error?.message ?? "", /risky shell pipeline/i);

  const evalResult = await tool.execute({ command: "Invoke-Expression \"Remove-Item test\"" });
  assert.equal(evalResult.ok, false);
  assert.equal(evalResult.error?.code, "destructive_command_blocked");
  assert.equal(evalResult.meta?.policyDecision, "blocked");
  assert.match(evalResult.error?.message ?? "", /dynamic-evaluation/i);
});

test("ShellTool runs confirmed destructive commands when the token matches", async () => {
  const calls: ShellArgs[] = [];
  const runner: HostShellRunner = async (args) => {
    calls.push(args);
    return createShellData("reset complete\n");
  };

  const tool = new ShellTool(runner);
  const command = "git reset --hard";
  const token = createShellConfirmationToken(command);
  const result = await tool.execute({
    command,
    allowDestructive: true,
    confirmationToken: token,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.combined, "reset complete\n");
  assert.equal(result.meta?.policyDecision, "confirm");
  assert.equal(result.meta?.confirmationSatisfied, true);
  assert.deepEqual(calls, [{
    command: "git reset --hard",
    allowDestructive: true,
    confirmationToken: token,
  }]);
});

test("ShellTool rejects destructive commands with the wrong confirmation token", async () => {
  const runner: HostShellRunner = async () => createShellData("should not be used");
  const tool = new ShellTool(runner);

  const result = await tool.execute({
    command: "Remove-Item -Recurse temp",
    allowDestructive: true,
    confirmationToken: "confirm:wrong",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "confirmation_required");
  assert.equal(result.meta?.policyDecision, "confirm");
  assert.equal(result.meta?.confirmationSatisfied, false);
});
