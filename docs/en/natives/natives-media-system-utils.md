---
title: Natives Media and System Utilities
description: Native media processing utilities for screenshots, image handling, and system information.
sidebar:
  order: 7
  label: Media & system utils
---

# Natives media and system utilities

This document describes the native media processing, HTML conversion, clipboard access, and performance profiling utilities implemented in `@f5-sales-demo/pi-natives`.

## Implementation files

- `crates/pi-natives/src/image.rs`: High-performance image decoding, resizing, and encoding.
- `crates/pi-natives/src/html.rs`: Fast HTML-to-Markdown document converter.
- `crates/pi-natives/src/clipboard.rs`: Cross-platform clipboard text and image access.
- `crates/pi-natives/src/prof.rs`: In-memory execution profiling and flamegraph generator.
- `crates/pi-natives/src/task.rs`: Task runtime profiling instrumentation.
- `packages/natives/src/image/index.ts`: TypeScript image API wrapper.
- `packages/natives/src/html/index.ts`: TypeScript HTML-to-Markdown wrapper.
- `packages/natives/src/clipboard/index.ts`: TypeScript clipboard manager with terminal OSC 52 fallback.
- `packages/natives/src/work/index.ts`: TypeScript profiling data consumer.

## Functional capabilities and API mapping

| TypeScript API | Native Node-API export | Rust module | Description |
|---|---|---|---|
| `PhotonImage.parse(bytes)` | `PhotonImage::parse` | `image.rs` | Decodes raw byte buffers into in-memory image handles. |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize` | `image.rs` | Resizes images using high-performance filtering algorithms. |
| `PhotonImage#encode(format, quality)` | `PhotonImage::encode` | `image.rs` | Encodes image handles to PNG, JPEG, WebP, or GIF byte buffers. |
| `htmlToMarkdown(html, options)` | `html_to_markdown` | `html.rs` | Converts HTML documents to clean Markdown. |
| `copyToClipboard(text)` | `copy_to_clipboard` | `clipboard.rs` | Writes text to the system clipboard with OSC 52 terminal fallback. |
| `readImageFromClipboard()` | `read_image_from_clipboard` | `clipboard.rs` | Reads image data from the system clipboard as PNG byte buffers. |
| `getWorkProfile(lastSeconds)` | `get_work_profile` | `prof.rs` | Returns CPU profiles and execution flamegraphs. |

## Data formats and conversions

### Image processing (`image`)

- **Input**: `Uint8Array` binary buffer containing encoded image data.
- **Decoding**: Automatically infers format (PNG, JPEG, WebP, GIF) and decodes into an `Arc<DynamicImage>`.
- **Encoding**: Produces a `Uint8Array` in the requested format:
  - `0`: PNG
  - `1`: JPEG (supports optional `quality` parameter between 1 and 100)
  - `2`: WebP
  - `3`: GIF

### HTML conversion (`html`)

- **Input**: HTML string with optional configuration flags:
  - `cleanContent`: Enables aggressive cleanup presets, removing navigation, footer, and form boilerplate.
  - `skipImages`: Strips embedded image tags from the output.
- **Output**: Clean Markdown string.

### Clipboard operations (`clipboard`)

- **Text copying**: Emits terminal OSC 52 escape sequences (`\x1b]52;c;<BASE64>\x07`) on active TTYs, followed by system clipboard API invocation.
- **Image reading**: Reads raw bitmap data via `arboard`, encodes it to PNG format, and returns `{ data: Uint8Array, mimeType: "image/png" }`. Returns `null` on headless environments without an active display server.

### Performance profiling (`work`)

- **Telemetry collection**: Instrumented asynchronous tasks record execution durations in a ring buffer (`MAX_SAMPLES = 10_000`).
- **Telemetry export**: `getWorkProfile(lastSeconds)` generates folded stack traces, markdown tables, and optional SVG flamegraphs.

