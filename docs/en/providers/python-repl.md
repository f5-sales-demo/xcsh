---
title: Python Tool and IPython Runtime
description: Python REPL tool runtime with IPython kernel management, execution, and output capture.
sidebar:
  order: 3
  label: Python & IPython
---

This document describes the Python execution architecture in `packages/coding-agent`, covering tool parameters, Jupyter Kernel Gateway lifecycles, environment isolation, execution semantics, and troubleshooting procedures.

## Architecture overview

Python execution is managed across several core modules:

- `src/tools/python.ts`: Tool interface definition and interactive cell renderers.
- `src/ipy/executor.ts`: Session-level kernel orchestration and execution scheduling.
- `src/ipy/kernel.ts`: Kernel lifecycle management and WebSocket communication protocol.
- `src/ipy/gateway-coordinator.ts`: Shared local Jupyter Kernel Gateway process coordinator.
- `src/ipy/runtime.ts`: Python environment discovery, virtualenv resolution, and environment variable filtering.

## Tool parameter schema

```typescript
interface PythonToolParams {
  cells: Array<{
    code: string;
    title?: string;
  }>;
  timeout?: number; // Execution timeout in seconds (1–600, default: 30)
  cwd?: string; // Working directory for execution
  reset?: boolean; // Reset kernel state prior to executing first cell
}
```

The tool executes with `concurrency: "exclusive"`, ensuring sequential execution per session.

## Gateway lifecycle management

### Gateway operational modes

1. **Local shared gateway (default)**:
   - Coordinates a single shared process under `~/.xcsh/agent/python-gateway/`.
   - Synchronizes access via `gateway.lock` and tracks state in `gateway.json`.
   - Starts `python -m kernel_gateway` bound to an ephemeral port on `127.0.0.1`.
2. **External gateway**:
   - Configured via `PI_PYTHON_GATEWAY_URL`.
   - Authenticates requests with `PI_PYTHON_GATEWAY_TOKEN` when required.
   - Bypasses local process management.

### Kernel lifecycle

1. **Creation**: Allocates a new kernel session via `POST /api/kernels`.
2. **Connection**: Establishes a WebSocket channel (`/api/kernels/:id/channels`).
3. **Initialization**: Configures `cwd`, applies sanitized environment variables, and executes runtime preludes.
4. **Module loading**: Imports custom modules from `~/.xcsh/agent/modules/*.py` and project-specific `<CWD>/.xcsh/modules/*.py`.
5. **Termination**: Issues `DELETE /api/kernels/:id` and closes WebSocket connections upon session cleanup.

## Environment isolation and security

Before launching Python runtimes, xcsh filters environment variables:

- **Retained variables**: Core system variables (`PATH`, `HOME`, `VIRTUAL_ENV`, `PYTHONPATH`) and whitelisted prefixes (`LC_*`, `XDG_*`, `PI_*`).
- **Sanitized variables**: Strips sensitive LLM API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) to prevent accidental leaks.

### Python environment resolution order

1. Active virtual environment (`VIRTUAL_ENV` or `<CWD>/.venv`)
2. Managed xcsh virtual environment (`~/.xcsh/python-env`)
3. System `python3` or `python` on `PATH`

## Output capture and MIME rendering

The runtime captures structured output across multiple MIME types:

- `text/markdown`: Rendered directly in interactive output panes.
- `text/plain`: Standard console output and tracebacks.
- `application/json`: Formatted JSON inspector trees.
- `image/png`: Inline image payloads.
- `application/x-xcsh-status`: Structured progress and execution status events.

## Troubleshooting

### Python tool unavailable

- Verify that `jupyter_kernel_gateway` and `ipykernel` are installed in the resolved Python environment:

  ```bash
  python -m pip install jupyter_kernel_gateway ipykernel
  ```

- Verify that `python.toolMode` or `PI_PY` is not set to `bash-only`.

### Execution timeouts or hangs

- Python does not support interactive standard input (`input()`). Avoid invoking interactive prompts.
- To handle long-running workloads, increase the `timeout` parameter (up to 600 seconds).
