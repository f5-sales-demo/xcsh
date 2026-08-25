#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const nativeDir = path.join(repoRoot, "packages", "natives", "native");
const ALL_ADDONS = [
	"linux-x64-modern",
	"linux-x64-baseline",
	"linux-arm64",
	"darwin-x64-modern",
	"darwin-x64-baseline",
	"darwin-arm64",
	"win32-x64-modern",
	"win32-x64-baseline",
] as const;
const LINUX_GLIBC_FLOOR = "2.17";

function compareVersions(left: string, right: string): number {
	const leftParts = left.split(".").map(Number);
	const rightParts = right.split(".").map(Number);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index++) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

export function findGlibcRequirementsAbove(readelfOutput: string, maximum: string): string[] {
	const requirements = new Set<string>();
	for (const match of readelfOutput.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/g)) {
		if (compareVersions(match[1], maximum) > 0) requirements.add(match[1]);
	}
	return [...requirements].sort(compareVersions);
}

// CI passes PI_NATIVE_EXPECTED_ADDONS to limit verification to built variants
const expectedAddons: readonly string[] = Bun.env.PI_NATIVE_EXPECTED_ADDONS
	? Bun.env.PI_NATIVE_EXPECTED_ADDONS.split(" ").filter(Boolean)
	: ALL_ADDONS;

async function main(): Promise<void> {
	const entries = await fs.readdir(nativeDir);

	console.log("Native addons downloaded:");
	for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
		console.log(`  ${entry}`);
	}
	console.log();
	console.log(`Expected addons: ${expectedAddons.join(", ")}`);

	const missingAddons = expectedAddons.filter((platform) => !entries.includes(`pi_natives.${platform}.node`));
	if (missingAddons.length > 0) {
		for (const platform of missingAddons) {
			console.error(`MISSING pi_natives.${platform}.node`);
		}
		process.exit(1);
	}

	for (const platform of expectedAddons) {
		console.log(`OK pi_natives.${platform}.node`);
	}

	let abiErrors = 0;
	for (const platform of expectedAddons.filter((candidate) => candidate.startsWith("linux-"))) {
		const addonPath = path.join(nativeDir, `pi_natives.${platform}.node`);
		const readelfProc = Bun.spawn(["readelf", "--version-info", addonPath], { stdout: "pipe", stderr: "pipe" });
		const output = await new Response(readelfProc.stdout).text();
		const errorOutput = await new Response(readelfProc.stderr).text();
		const exitCode = await readelfProc.exited;
		if (exitCode !== 0) {
			console.error(`ABI ERROR pi_natives.${platform}.node: readelf failed: ${errorOutput.trim()}`);
			abiErrors++;
			continue;
		}

		const unsupported = findGlibcRequirementsAbove(output, LINUX_GLIBC_FLOOR);
		if (unsupported.length > 0) {
			console.error(
				`ABI ERROR pi_natives.${platform}.node: requires GLIBC_${unsupported.join(", GLIBC_")} above ${LINUX_GLIBC_FLOOR}`,
			);
			abiErrors++;
		} else {
			console.log(`ABI OK pi_natives.${platform}.node (GLIBC <= ${LINUX_GLIBC_FLOOR})`);
		}
	}

	if (abiErrors > 0) {
		console.error(`\n${abiErrors} Linux addon(s) exceed the supported glibc floor`);
		process.exit(1);
	}

	// Verify no undefined tree-sitter external scanner symbols in ELF/Mach-O addons.
	// Windows DLLs use a different linking model and are not affected by this class of bug.
	const nonWindowsAddons = expectedAddons.filter((p) => !p.startsWith("win32-"));
	let symbolErrors = 0;

	for (const platform of nonWindowsAddons) {
		const addonPath = path.join(nativeDir, `pi_natives.${platform}.node`);
		const nmProc = Bun.spawn(["nm", "-D", addonPath], { stdout: "pipe", stderr: "pipe" });
		const output = await new Response(nmProc.stdout).text();
		await nmProc.exited;

		const undefinedScannerSymbols = output
			.split("\n")
			.filter((line) => /\bU\b.*tree_sitter_\w+_external_scanner_/.test(line));

		if (undefinedScannerSymbols.length > 0) {
			console.error(`SYMBOL ERROR pi_natives.${platform}.node: ${undefinedScannerSymbols.length} undefined tree-sitter scanner symbol(s)`);
			for (const sym of undefinedScannerSymbols) {
				console.error(`  ${sym.trim()}`);
			}
			symbolErrors++;
		} else {
			console.log(`SYMBOLS OK pi_natives.${platform}.node`);
		}
	}

	if (symbolErrors > 0) {
		console.error(`\n${symbolErrors} addon(s) have undefined tree-sitter scanner symbols`);
		process.exit(1);
	}
}

/**
 * Detect AVX-512 markers in disassembly output lines.
 * Flags zmm/k-register usage or EVEX-prefixed (62h) instructions that have a
 * valid 4-byte EVEX prefix (byte-2 bit-2 set distinguishes EVEX from BOUND).
 */
export function hasAvx512Markers(line: string): boolean {
	// zmm or k-register references (e.g. %zmm0, %k1, kmovw)
	if (/\bzmm\d|%k[0-7]\b|\bk[a-z]+[bwdq]\b/.test(line)) return true;
	// EVEX prefix: starts with 62, at least 4 bytes, P1 bits 3:2 must be 00
	// (distinguishes from legacy BOUND which is also opcode 0x62)
	const hexMatch = line.match(/:\t((?:[0-9a-f]{2} )+)/);
	if (hexMatch) {
		const bytes = hexMatch[1].trim().split(" ");
		if (bytes[0] === "62" && bytes.length >= 4) {
			const p1 = parseInt(bytes[1], 16);
			// bits 3:2 of P1 must be 00 AND bit 6 (X inverted) must be 1 in valid 64-bit EVEX
			if ((p1 & 0x0c) === 0 && (p1 & 0x40) !== 0) return true;
		}
	}
	return false;
}

if (import.meta.main) {
	await main();
}
