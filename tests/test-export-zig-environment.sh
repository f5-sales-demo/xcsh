#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
python3 - "$REPO_ROOT/scripts/export-zig-environment.cjs" <<'PY'
import os
import json
import subprocess
import sys
import tempfile
from pathlib import Path

script = sys.argv[1]
with tempfile.TemporaryDirectory(prefix="zig-export-test-") as folder:
    root = Path(folder)
    path_file, env_file = root / "path", root / "env"
    base = os.environ.copy()
    base.update(GITHUB_PATH=str(path_file), GITHUB_ENV=str(env_file))
    cases = [("/tmp/zig path", "/workspace/cache"), (r"C:\tools\zig path", r"C:\workspace\cache"), ("/tmp/zig`literal`", "/tmp/cache$(literal)")]
    for tool_path, cache_path in cases:
        path_file.write_text("before\n")
        env_file.write_text("before\n")
        env = {**base, "ZIG_PATH_TO_EXPORT": tool_path, "ZIG_CACHE_TO_EXPORT": cache_path}
        subprocess.run(["node", script], env=env, check=True, capture_output=True)
        assert path_file.read_text() == "before\n" + tool_path + "\n"
        assert env_file.read_text() == "before\nZIG_GLOBAL_CACHE_DIR=" + cache_path + "\nZIG_LOCAL_CACHE_DIR=" + cache_path + "\n"
    for name in ["ZIG_PATH_TO_EXPORT", "ZIG_CACHE_TO_EXPORT"]:
        for invalid in ["/tmp/value\nINJECTED=1", "/tmp/value\rINJECTED=1", "/tmp/value\0INJECTED=1", ""]:
            path_file.write_text("unchanged\n")
            env_file.write_text("unchanged\n")
            env = {**base, "ZIG_PATH_TO_EXPORT": "/tmp/zig", "ZIG_CACHE_TO_EXPORT": "/tmp/cache", name: invalid}
            inputs = {key: env[key] for key in ["GITHUB_PATH", "GITHUB_ENV", "ZIG_PATH_TO_EXPORT", "ZIG_CACHE_TO_EXPORT"]}
            program = 'const fs=require("node:fs");require(process.argv[1]).exportZigEnvironment(JSON.parse(fs.readFileSync(0,"utf8")));'
            result = subprocess.run(["node", "-e", program, script], input=json.dumps(inputs).encode(), capture_output=True)
            assert result.returncode != 0
            assert path_file.read_text() == "unchanged\n"
            assert env_file.read_text() == "unchanged\n"
print("PASS: literal Unix/Windows paths and rejection before either environment file changes")
PY
