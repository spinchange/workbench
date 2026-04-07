import argparse
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("WORKBENCH_HOST_BIND", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("WORKBENCH_HOST_PORT", "8777")))
    parser.add_argument("--token", default=os.environ.get("WORKBENCH_HOST_TOKEN", ""))
    return parser.parse_args()


ARGS = parse_args()
HOST = ARGS.host
PORT = ARGS.port
TOKEN = ARGS.token

if not TOKEN:
    raise SystemExit("A token is required. Pass --token or set WORKBENCH_HOST_TOKEN.")


class Handler(BaseHTTPRequestHandler):
    server_version = "WorkbenchShellHost/0.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _unauthorized(self) -> None:
        self._send_json(401, {"error": "unauthorized"})

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length) if length else b"{}"
        return json.loads(data.decode("utf-8"))

    def _authorized(self) -> bool:
        return self.headers.get("x-workbench-token") == TOKEN

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            self._unauthorized()
            return

        if self.path == "/health":
            self._send_json(200, {"ok": True, "pid": os.getpid(), "port": PORT})
            return

        self._send_json(404, {"error": "not_found", "path": self.path})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            self._unauthorized()
            return

        if self.path == "/shutdown":
            self._send_json(200, {"ok": True, "shuttingDown": True})
            raise KeyboardInterrupt

        if self.path != "/run":
            self._send_json(404, {"error": "not_found", "path": self.path})
            return

        payload = self._read_json()
        command = payload.get("command", "")
        cwd = payload.get("cwd") or None
        timeout_ms = int(payload.get("timeoutMs") or 20000)

        completed = subprocess.run(
            ["pwsh", "-NoProfile", "-Command", command],
            cwd=cwd,
            timeout=timeout_ms / 1000,
            capture_output=True,
            text=True,
            shell=False,
        )

        stdout = completed.stdout.rstrip()
        stderr = completed.stderr.rstrip()
        combined = "\n".join(part for part in (stdout, stderr) if part)

        self._send_json(
            200,
            {
              "exitCode": completed.returncode,
              "stdout": stdout,
              "stderr": stderr,
              "combined": combined,
            },
        )


def main() -> int:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
