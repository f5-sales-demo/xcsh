#!/usr/bin/env bun
// Native document conversion runs without loading the main CLI's native addon.
if (process.argv[2] === "--xcsh-native-markit-worker") {
	await import("./utils/markit-worker");
} else {
	await import("./cli");
}

export {};
