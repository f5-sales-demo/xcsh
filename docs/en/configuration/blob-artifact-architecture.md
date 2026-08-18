---
title: Blob and Artifact Storage Architecture
description: Content-addressable blob store and artifact registry for session media, screenshots, and tool outputs.
sidebar:
  order: 7
  label: Blob & artifact storage
---

This document describes how the coding agent stores large and binary payloads outside session JSONL files, how truncated tool output persists, and how internal URLs (`artifact://`, `agent://`) resolve back to stored data.

## Why two storage systems exist

The runtime uses two distinct persistence mechanisms for different data structures:

- **Content-addressed blobs** (`blob:sha256:<hash>`): global, binary-oriented storage used to externalize large image base64 payloads from persisted session entries.
- **Session-scoped artifacts** (files under `<sessionFile-without-.jsonl>/`): per-session text files used for full tool outputs and subagent outputs.

The two mechanisms serve distinct optimization goals:

- Blob storage optimizes deduplication and stable references by content hash.
- Artifact storage optimizes append-only session tooling and fast retrieval by local identifiers.

## Storage boundaries and on-disk layout

### Blob store boundary (global)

`SessionManager` constructs `BlobStore(getBlobsDir())`, which places blob files in a shared global blob directory rather than in an individual session directory.

Blob file naming:

- File path: `<blobsDir>/<sha256-hex>`
- Extension: None
- Reference string stored in entries: `blob:sha256:<sha256-hex>`

Key characteristics:

- Identical binary content across sessions resolves to the same hash and path.
- Writes are idempotent at the content level.
- Blobs outlive any individual session file.

### Artifact boundary (session-local)

`ArtifactManager` derives the artifact directory directly from the session file path:

- Session file: `.../<timestamp>_<sessionId>.jsonl`
- Artifacts directory: `.../<timestamp>_<sessionId>/` (with the `.jsonl` extension removed)

Artifact types stored in this directory include:

- Truncated tool output files: `<numericId>.<toolType>.log` (resolved by `artifact://`)
- Subagent output files: `<outputId>.md` (resolved by `agent://`)

## Identifier and name allocation schemes

### Blob identifiers: content hash

`BlobStore.put()` computes a SHA-256 digest over the raw binary bytes and returns:

- `hash`: Hex digest
- `path`: `<blobsDir>/<hash>`
- `ref`: `blob:sha256:<hash>`

The blob store does not use session-local counters.

### Artifact identifiers: session-local monotonic integer

`ArtifactManager` scans existing `*.log` artifact files on first use to determine the maximum existing numeric identifier, then sets `nextId = max + 1`.

Allocation behavior:

- File format: `{id}.{toolType}.log`
- Identifiers are sequential strings (`"0"`, `"1"`, and so on)
- Resuming a session does not overwrite existing artifacts because directory scanning completes before allocation.

If the artifact directory is missing, scanning yields an empty list and allocation begins at `0`.

### Agent output identifiers (`agent://`)

`AgentOutputManager` allocates identifiers for subagent outputs in the format `<index>-<requestedId>` (or nested under a parent prefix, such as `0-Parent.1-Child`). It scans existing `.md` files during initialization to continue from the next index upon resume.

## Persistence dataflow

### 1. Session entry persistence rewrite path

Before session entries are written (`#rewriteFile` or incremental persistence), `SessionManager` calls `prepareEntryForPersistence()` through `truncateForPersistence`.

Key behaviors:

1. **Large string truncation**: Oversized strings are trimmed and appended with `"[Session persistence truncated large content]"`.
2. **Transient field stripping**: `partialJson` and `jsonlEvents` are removed from persisted entries.
3. **Image externalization to blobs**:
   - Applies only to image blocks in `content` arrays.
   - Executes only when `data` is not already a blob reference.
   - Triggers only when the base64 string length reaches or exceeds the threshold (`BLOB_EXTERNALIZE_THRESHOLD = 1024`).
   - Replaces inline base64 content with `blob:sha256:<hash>`.

This process maintains compact session JSONL files while preserving full data recoverability.

### 2. Session load rehydration path

When opening a session (`setSessionFile`), `SessionManager` runs `resolveBlobRefsInEntries()` after migrations complete.

For each message or custom-message image block containing `blob:sha256:<hash>`:

- Reads blob bytes from the blob store.
- Converts the bytes back to base64.
- Mutates the in-memory entry to inline base64 for runtime consumers.

If a blob is missing:

- `resolveImageData()` logs a warning.
- The reference string remains unchanged.
- Session loading continues without throwing a fatal exception.

### 3. Tool output spill and truncation path

`OutputSink` manages streaming output across bash, python, SSH, and related executors.

Execution sequence:

1. The sink sanitizes each chunk and appends it to an in-memory tail buffer.
2. When in-memory bytes exceed the spill threshold (`DEFAULT_MAX_BYTES`, 50 KB), the sink marks output as truncated.
3. If an artifact path is available, the sink opens a file writer and writes:
   - The existing buffered content (once).
   - All subsequent stream chunks.
4. The in-memory buffer is trimmed to the tail display window.
5. `dump()` returns a summary containing `artifactId` only when the file sink was created successfully.

Resulting behavior:

- The UI and tool return values display the truncated tail.
- Full output is preserved in the artifact file and accessible via `artifact://<id>`.

If file sink creation fails (due to an I/O error or missing path), the sink falls back to in-memory truncation, and the full output is not persisted.

## URL access model

### `blob:` references

The `blob:sha256:<hash>` format is an internal persistence reference within session payloads rather than a routing protocol scheme. `SessionManager` resolves these references during session load.

### `artifact://<id>`

`ArtifactProtocolHandler` processes `artifact://<id>` URLs:

- Requires an active session artifact directory.
- Requires a numeric identifier.
- Resolves by matching the filename prefix `<id>.`.
- Returns raw text (`text/plain`) from the matched `.log` file.
- If not found, returns an error listing the available artifact identifiers.

If the artifacts directory does not exist, the handler throws `No artifacts directory found`.

### `agent://<id>`

`AgentProtocolHandler` resolves paths in `<artifactsDir>/<id>.md`:

- Standard form returns raw Markdown text.
- Subpath (`/path`) or query (`?q=`) forms perform JSON extraction.
- Path and query extraction modes cannot be combined.
- When extraction is requested, the file content must be valid JSON.

If the artifacts directory does not exist, the handler throws `No artifacts directory found`. If the output identifier is missing, it throws `Not found: <id>` along with a list of available identifiers.

Read tool integration:

- `read` supports offset and limit pagination for standard internal URL reads.
- `read` rejects `offset` and `limit` arguments when using `agent://` JSON extraction.

## Resume, fork, and move semantics

### Resume

- `ArtifactManager` scans existing `{id}.*.log` files on first allocation and continues numeric sequence.
- `AgentOutputManager` scans existing `.md` output files and continues index numbering.
- `SessionManager` rehydrates blob references back to base64 upon session load.

### Fork

`SessionManager.fork()` creates a new session file with a unique session ID and a `parentSession` link, returning the old and new file paths. `AgentSession.fork()` coordinates artifact directory copying:

- Performs a recursive copy of the previous artifact directory to the new directory.
- Tolerates a missing source directory without failing.
- Logs non-ENOENT copy errors as warnings while allowing the fork operation to complete.

Identifier allocation after fork:

- If directory copy succeeds, new artifact counters continue from the maximum copied identifier.
- If copy fails or is skipped, artifact identifiers restart from `0`.

Blob handling after fork:

- Blobs remain globally content-addressed, requiring no copying between session directories.

### Move to a new working directory

`SessionManager.moveTo()` moves both the session file and the artifact directory to the new target location, with automated rollback if a step fails. This preserves artifact identities while updating the session working directory.

## Failure handling and fallback paths

| Condition | Behavior |
| --- | --- |
| Blob file missing during rehydration | Logs warning and retains the in-memory `blob:sha256:` reference string |
| Blob read ENOENT via `BlobStore.get` | Returns `null` |
| Artifact directory missing (`ArtifactManager.listFiles`) | Returns empty list; allocation starts from `0` |
| Artifact directory missing (`artifact://` or `agent://`) | Throws explicit `No artifacts directory found` error |
| Artifact ID not found | Throws error listing available artifact IDs |
| OutputSink artifact writer initialization fails | Continues with tail-only truncation without full-output persistence |
| No session file (subagent execution paths) | Task tool falls back to a temporary artifact directory for subagent output |

## Binary blob externalization compared to text artifacts

- **Blob externalization** handles binary image payloads within persisted session entries, replacing inline base64 data in JSONL files with stable content references.
- **Artifacts** are plain text files that capture tool and subagent output, addressable by session-local identifiers through internal URLs.

Both mechanisms reduce session JSONL file size while maintaining distinct storage lifecycles and retrieval paths.

## Implementation files

- [`src/session/blob-store.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/blob-store.ts) — Blob reference format, hashing, put and get operations, externalize and resolve helpers.
- [`src/session/artifacts.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/artifacts.ts) — Session artifact directory management and numeric identifier allocation.
- [`src/session/streaming-output.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` stream truncation, file spillover, and summary metadata.
- [`src/session/session-manager.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/session-manager.ts) — Persistence transformations, blob rehydration, session fork, and session relocation.
- [`src/session/agent-session.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/agent-session.ts) — Artifact directory duplication during interactive session fork.
- [`src/tools/output-utils.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/tools/output-utils.ts) — Tool artifact manager initialization and artifact path allocation.
- [`src/internal-urls/artifact-protocol.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` URL protocol handler.
- [`src/internal-urls/agent-protocol.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` URL protocol handler and JSON extractor.
- [`src/sdk.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/sdk.ts) — Internal URL router configuration and artifact directory resolution.
- [`src/task/output-manager.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/task/output-manager.ts) — Agent output identifier allocation for `agent://`.
- [`src/task/executor.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/task/executor.ts) — Subagent output persistence (`<id>.md`) and temporary directory fallback.
