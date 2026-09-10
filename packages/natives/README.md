# @f5-sales-demo/pi-natives

Native Rust functionality via N-API.

## What's Inside

- **Grep**: Regex-based search powered by ripgrep's engine with native file walking and matching
- **Find**: Glob-based file/directory discovery with gitignore support (pure TypeScript via `globPaths`)
- **Image**: Image processing via photon-rs (resize, format conversion) exposed through N-API

## Usage

```typescript
import { grep, find } from "@f5-sales-demo/pi-natives";

// Grep for a pattern
const results = await grep({
 pattern: "TODO",
 path: "/path/to/project",
 glob: "*.ts",
 context: 2,
});

// Find files
const files = await find({
 pattern: "*.rs",
 path: "/path/to/project",
 fileType: "file",
});

// Image processing
const pngBytes = await new Bun.Image(bytes).resize(800, 600).png().bytes();
```

## Building

```bash
# Build native addon from workspace root (requires Rust)
bun run build

# Type check
bun run check
```

## Architecture

```text
crates/pi-natives/       # Rust source (workspace member)
  src/lib.rs             # N-API exports
  src/image.rs           # SIXEL image decoding and encoding
  Cargo.toml             # Rust dependencies
native/                  # Native addon binaries
  pi_natives.<platform>-<arch>-modern.node   # x64 modern ISA (AVX2)
  pi_natives.<platform>-<arch>-baseline.node # x64 baseline ISA
  pi_natives.<platform>-<arch>.node          # non-x64 build artifact
src/                     # TypeScript wrappers
  native.ts              # Native addon loader
  index.ts               # Public API
```
