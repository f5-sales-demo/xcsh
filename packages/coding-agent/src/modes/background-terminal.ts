import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync } from "node:fs";

const DUP2_SYMBOL = {
	dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
} as const;

function openSystemLibrary() {
	const muslArchitecture = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
	const candidates =
		process.platform === "darwin"
			? ["libSystem.B.dylib", "/usr/lib/libSystem.B.dylib"]
			: process.platform === "freebsd"
				? ["libc.so.7", "libc.so"]
				: ["libc.so.6", `/lib/ld-musl-${muslArchitecture}.so.1`, `/lib/libc.musl-${muslArchitecture}.so.1`];
	let lastError: unknown;
	for (const candidate of candidates) {
		try {
			return dlopen(candidate, DUP2_SYMBOL);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Could not load the system dup2 function");
}

/**
 * Replace the process's standard descriptors with /dev/null before a POSIX
 * shell resumes it as a background job. This is deliberately process-wide:
 * a backgrounded interactive runtime must not read from or perform terminal
 * restoration against the shell's controlling TTY after the handoff.
 */
export function detachStandardStreamsForBackground(): void {
	if (process.platform === "win32") return;

	const libc = openSystemLibrary();
	const nullFd = openSync("/dev/null", "r+");
	try {
		process.stdin.pause();
		for (const targetFd of [0, 1, 2]) {
			if (libc.symbols.dup2(nullFd, targetFd) === -1) {
				throw new Error(`Could not detach standard descriptor ${targetFd}`);
			}
		}
	} finally {
		closeSync(nullFd);
		libc.close();
	}
}
