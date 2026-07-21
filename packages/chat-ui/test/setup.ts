import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";

// happy-dom is registered by ./register-dom.ts (preloaded first), so `document`
// already exists before `@testing-library/*` is imported here.

// Required for React act() integration in test environments.
// Cast through unknown to avoid TS7017 (no index signature on typeof globalThis).
(globalThis as unknown as Record<string, boolean>).IS_REACT_ACT_ENVIRONMENT = true;

// Global test isolation: unmount every RTL-rendered tree after each test so no
// DOM leaks into the happy-dom document that all test FILES share in a single
// `bun test` process. cleanup() only tracks RTL `render()` trees.
afterEach(() => {
	cleanup();
});
