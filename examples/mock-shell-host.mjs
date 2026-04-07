export function createShellRunner() {
  return async ({ command, cwd, timeoutMs }) => {
    const payload = {
      command,
      cwd: cwd ?? null,
      timeoutMs: timeoutMs ?? null,
      mocked: true,
    };

    const stdout = JSON.stringify(payload, null, 2);
    return {
      exitCode: 0,
      stdout,
      stderr: "",
      combined: stdout,
    };
  };
}
