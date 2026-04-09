import test from "node:test";
import assert from "node:assert/strict";
import { REPL_HELP_TEXT, renderResult } from "../src/cli/render.js";

test("REPL help text documents the current slash-command surface", () => {
  assert.equal(
    REPL_HELP_TEXT,
    [
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
    ].join("\n"),
  );
});

test("renderResult formats audit entries as stable terminal lines", () => {
  const rendered = renderResult([
    {
      at: "2026-04-09T08:14:27.476Z",
      tool: "shell",
      args: { command: "git reset --hard", cwd: "C:\\dev\\repos\\workbench", timeoutMs: 20000 },
      ok: false,
      error: { code: "confirmation_required", message: "Confirmation required" },
      policyDecision: "confirm",
      confirmationSatisfied: false,
    },
    {
      at: "2026-04-09T08:15:01.000Z",
      tool: "shell",
      args: { command: "git status --short", cwd: "C:\\dev\\repos\\workbench" },
      ok: true,
      policyDecision: "safe",
    },
  ]);

  assert.equal(
    rendered,
    '2026-04-09T08:14:27.476Z shell error:confirmation_required policy:confirm confirmed:no {"command":"git reset --hard","cwd":"C:\\\\dev\\\\repos\\\\workbench","timeoutMs":20000}\n'
      + '2026-04-09T08:15:01.000Z shell ok policy:safe {"command":"git status --short","cwd":"C:\\\\dev\\\\repos\\\\workbench"}',
  );
});

test("renderResult formats session actions, repo entries, and cancelled confirmations", () => {
  assert.equal(
    renderResult({
      action: "save",
      name: "daily",
      path: "C:\\Users\\chris\\.workbench\\sessions\\daily.json",
      repo: "C:\\dev\\repos\\workbench",
      historyCount: 12,
    }),
    "save session 'daily' -> C:\\Users\\chris\\.workbench\\sessions\\daily.json\nrepo: C:\\dev\\repos\\workbench\nhistory: 12",
  );

  assert.equal(
    renderResult({ name: "demo", path: "C:\\dev\\repos\\workbench\\examples\\fixture-repos\\clean-node-repo" }),
    "repo 'demo' -> C:\\dev\\repos\\workbench\\examples\\fixture-repos\\clean-node-repo",
  );

  assert.equal(
    renderResult({ ok: false, action: "cancelled", command: "git reset --hard" }),
    "Cancelled risky command: git reset --hard",
  );
});
