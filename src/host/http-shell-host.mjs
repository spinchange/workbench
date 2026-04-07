export function createShellRunner() {
  const baseUrl = process.env.WORKBENCH_HOST_URL ?? "http://127.0.0.1:8777";
  const token = process.env.WORKBENCH_HOST_TOKEN;

  if (!token) {
    throw new Error("WORKBENCH_HOST_TOKEN is required for the HTTP shell host adapter.");
  }

  return async ({ command, cwd, timeoutMs }) => {
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workbench-token": token,
      },
      body: JSON.stringify({
        command,
        cwd,
        timeoutMs,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP shell host failed: ${response.status} ${response.statusText} ${body}`.trim());
    }

    return response.json();
  };
}
