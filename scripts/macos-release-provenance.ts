#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

export const APPLE_TEAM_ID = "97ZYL78T5F";
export const BUN_ENTITLEMENTS = [
	"com.apple.security.cs.allow-jit",
	"com.apple.security.cs.allow-unsigned-executable-memory",
] as const;

export interface MacOsSignature {
	authority: "Developer ID Application" | string;
	teamIdentifier: string;
	hardenedRuntime: boolean;
	trustedTimestamp: boolean;
	notarized: boolean;
	entitlements: string[];
	architectures: string[];
}

export interface MacOsProvenanceFile {
	role: "cli" | "native-addon";
	name: string;
	sha256: string;
	size: number;
	signature: MacOsSignature;
}

export interface MacOsProvenanceManifest {
	schemaVersion: 1;
	arch: "arm64" | "x64";
	version: string;
	teamIdentifier: typeof APPLE_TEAM_ID;
	files: MacOsProvenanceFile[];
}

type InspectSignature = (file: string) => Promise<MacOsSignature>;

function sha256(bytes: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function expectedNativeNames(arch: "arm64" | "x64"): string[] {
	return arch === "arm64"
		? ["pi_natives.darwin-arm64.node"]
		: ["pi_natives.darwin-x64-baseline.node", "pi_natives.darwin-x64-modern.node"];
}

function signaturePolicyFailures(signature: MacOsSignature, role: MacOsProvenanceFile["role"]): string[] {
	const failures: string[] = [];
	if (signature.authority !== "Developer ID Application") failures.push("not Developer ID Application signed");
	if (signature.teamIdentifier !== APPLE_TEAM_ID) failures.push(`wrong team identifier: ${signature.teamIdentifier}`);
	if (!signature.hardenedRuntime) failures.push("hardened runtime is missing");
	if (!signature.trustedTimestamp) failures.push("trusted timestamp is missing");
	if (!signature.notarized) failures.push("notarization is missing");
	const expected = role === "cli" ? [...BUN_ENTITLEMENTS] : [];
	const actual = [...signature.entitlements].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) {
		failures.push(`entitlements differ: expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
	}
	return failures;
}

export function assertMacOsSignaturePolicy(signature: MacOsSignature, role: MacOsProvenanceFile["role"]): void {
	const failures = signaturePolicyFailures(signature, role);
	if (failures.length > 0) throw new Error(failures.join("; "));
}

export async function inspectMacOsSignature(file: string): Promise<MacOsSignature> {
	const verify = await $`codesign --verify --deep --strict --verbose=2 ${file}`.quiet().nothrow();
	if (verify.exitCode !== 0) throw new Error(`codesign strict verification failed: ${verify.stderr.toString().trim()}`);
	const display = await $`codesign --display --verbose=4 ${file}`.quiet().nothrow();
	if (display.exitCode !== 0) throw new Error(`codesign inspection failed: ${display.stderr.toString().trim()}`);
	const details = `${display.stdout}${display.stderr}`;
	const entitlementResult = await $`codesign --display --entitlements :- ${file}`.quiet().nothrow();
	if (entitlementResult.exitCode !== 0) {
		throw new Error(`codesign entitlement inspection failed: ${entitlementResult.stderr.toString().trim()}`);
	}
	const entitlementText = `${entitlementResult.stdout}${entitlementResult.stderr}`;
	const entitlements = [...entitlementText.matchAll(/<key>([^<]+)<\/key>/gu)].map(match => match[1] ?? "").sort();
	const lipo = await $`lipo -archs ${file}`.quiet().nothrow();
	if (lipo.exitCode !== 0) throw new Error(`Mach-O architecture inspection failed: ${lipo.stderr.toString().trim()}`);
	let notarized = false;
	for (let attempt = 1; attempt <= 8; attempt += 1) {
		const assessment = await $`spctl --assess --verbose=4 --type install ${file}`.quiet().nothrow();
		const assessmentText = `${assessment.stdout}${assessment.stderr}`;
		notarized = assessment.exitCode === 0 && /source=Notarized Developer ID/u.test(assessmentText);
		if (notarized || attempt === 8) break;
		await Bun.sleep(15_000);
	}
	return {
		authority: /^Authority=Developer ID Application:/m.test(details) ? "Developer ID Application" : "unknown",
		teamIdentifier: details.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? "missing",
		hardenedRuntime: /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/iu.test(details),
		trustedTimestamp: /^Timestamp=(?!none\s*$).+/mi.test(details),
		notarized,
		entitlements,
		architectures: lipo.stdout.toString().trim().split(/\s+/u).filter(Boolean).sort(),
	};
}

async function describeFile(
	file: string,
	role: MacOsProvenanceFile["role"],
	inspectSignature: InspectSignature,
): Promise<MacOsProvenanceFile> {
	const [bytes, signature] = await Promise.all([fs.readFile(file), inspectSignature(file)]);
	const failures = signaturePolicyFailures(signature, role);
	if (failures.length > 0) throw new Error(`${path.basename(file)}: ${failures.join("; ")}`);
	return { role, name: path.basename(file), sha256: sha256(bytes), size: bytes.byteLength, signature };
}

export async function createMacOsProvenanceManifest(options: {
	arch: "arm64" | "x64";
	version: string;
	binaryPath: string;
	nativeDir: string;
	inspectSignature?: InspectSignature;
}): Promise<MacOsProvenanceManifest> {
	if (!/^\d+\.\d+\.\d+$/u.test(options.version)) throw new Error(`invalid release version: ${options.version}`);
	if (path.basename(options.binaryPath) !== `xcsh-darwin-${options.arch}`) {
		throw new Error(`binary name does not match architecture ${options.arch}`);
	}
	const allDarwinAddons = (await fs.readdir(options.nativeDir)).filter(name =>
		/^pi_natives\.darwin-.+\.node$/u.test(name),
	);
	const expected = expectedNativeNames(options.arch);
	const unexpected = allDarwinAddons.filter(name => !expected.includes(name));
	const missing = expected.filter(name => !allDarwinAddons.includes(name));
	if (unexpected.length > 0) throw new Error(`unexpected native addon(s): ${unexpected.join(", ")}`);
	if (missing.length > 0) throw new Error(`missing native addon(s): ${missing.join(", ")}`);
	const inspect = options.inspectSignature ?? inspectMacOsSignature;
	const files = [
		await describeFile(options.binaryPath, "cli", inspect),
		...(await Promise.all(expected.map(name => describeFile(path.join(options.nativeDir, name), "native-addon", inspect)))),
	];
	const manifest: MacOsProvenanceManifest = {
		schemaVersion: 1,
		arch: options.arch,
		version: options.version,
		teamIdentifier: APPLE_TEAM_ID,
		files,
	};
	const failures = validateManifest(manifest);
	if (failures.length > 0) throw new Error(failures.join("\n"));
	return manifest;
}

function manifestPath(file: MacOsProvenanceFile, manifest: MacOsProvenanceManifest, layout: string): string {
	if (layout === "release") return file.name;
	if (layout === "homebrew") return file.role === "cli" ? "bin/xcsh" : `libexec/${file.name}`;
	if (layout === "pkg") {
		return file.role === "cli"
			? "usr/local/bin/xcsh"
			: `Library/Application Support/xcsh/natives/${manifest.version}/${file.name}`;
	}
	throw new Error(`unsupported provenance layout: ${layout}`);
}

function inventoryRoots(manifest: MacOsProvenanceManifest, layout: "release" | "homebrew" | "pkg"): string[] {
	const roots = new Set<string>();
	for (const file of manifest.files) roots.add(path.posix.dirname(manifestPath(file, manifest, layout)));
	if (layout === "homebrew") roots.add("provenance");
	return [...roots].sort();
}

function auxiliaryInventoryPaths(manifest: MacOsProvenanceManifest, layout: "release" | "homebrew" | "pkg"): string[] {
	// The signed release staging directory retains the per-architecture manifest
	// that is being verified. It is subsequently copied into the ZIP and PKG
	// layouts under their respective canonical names. Permit only that exact
	// architecture-bound staging file; every other root file remains unexpected.
	if (layout === "release") return [`xcsh-darwin-${manifest.arch}.provenance.json`];
	if (layout === "homebrew") return ["provenance/manifest.json"];
	if (layout === "pkg") {
		return [`Library/Application Support/xcsh/natives/${manifest.version}/provenance.json`];
	}
	return [];
}

function validateManifest(manifest: MacOsProvenanceManifest): string[] {
	const failures: string[] = [];
	if (manifest.schemaVersion !== 1) failures.push("unsupported schema version");
	if (manifest.teamIdentifier !== APPLE_TEAM_ID) failures.push("invalid manifest team identifier");
	if (manifest.arch !== "arm64" && manifest.arch !== "x64") failures.push("invalid manifest architecture");
	if (!/^\d+\.\d+\.\d+$/u.test(manifest.version)) failures.push("invalid manifest version");
	const expectedNames = [`xcsh-darwin-${manifest.arch}`, ...expectedNativeNames(manifest.arch)];
	const actualNames = manifest.files.map(file => file.name);
	if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) failures.push("unexpected manifest file inventory");
	for (const file of manifest.files) {
		if (path.basename(file.name) !== file.name) failures.push(`${file.name}: unsafe file name`);
		const expectedRole = file.name.startsWith("xcsh-darwin-") ? "cli" : "native-addon";
		if (file.role !== expectedRole) failures.push(`${file.name}: invalid role`);
		if (!/^[a-f0-9]{64}$/u.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1) {
			failures.push(`${file.name}: invalid digest metadata`);
		}
		for (const failure of signaturePolicyFailures(file.signature, file.role)) failures.push(`${file.name}: ${failure}`);
		const expectedArchitecture = manifest.arch === "arm64" ? "arm64" : "x86_64";
		if (JSON.stringify(file.signature.architectures) !== JSON.stringify([expectedArchitecture])) {
			failures.push(`${file.name}: wrong architecture: ${file.signature.architectures.join(", ")}`);
		}
	}
	return failures;
}

export async function verifyMacOsProvenance(options: {
	manifest: MacOsProvenanceManifest;
	rootDir: string;
	layout: "release" | "homebrew" | "pkg";
	inspectSignature?: InspectSignature | false;
	rejectUnexpected?: boolean;
}): Promise<void> {
	const { manifest } = options;
	const failures = validateManifest(manifest);
	const allowed = new Set<string>();
	for (const entry of manifest.files) {
		const relative = manifestPath(entry, manifest, options.layout);
		allowed.add(relative);
		const file = path.join(options.rootDir, relative);
		try {
			const bytes = await fs.readFile(file);
			if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) failures.push(`${relative}: hash mismatch`);
		} catch (error) {
			failures.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (options.inspectSignature !== false) {
			try {
				const actual = await (options.inspectSignature ?? inspectMacOsSignature)(file);
				const policy = signaturePolicyFailures(actual, entry.role);
				if (policy.length > 0) failures.push(`${relative}: ${policy.join("; ")}`);
				if (JSON.stringify(actual) !== JSON.stringify(entry.signature)) failures.push(`${relative}: signature changed`);
			} catch (error) {
				failures.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	for (const relative of auxiliaryInventoryPaths(manifest, options.layout)) allowed.add(relative);
	if (options.rejectUnexpected) {
		const walk = async (directory: string, prefix: string): Promise<void> => {
			for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
				const relative = path.posix.join(prefix, entry.name);
				if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
				else if (!allowed.has(relative)) failures.push(`${relative}: unexpected file`);
			}
		};
		for (const root of inventoryRoots(manifest, options.layout)) {
			await walk(path.join(options.rootDir, root), root === "." ? "" : root);
		}
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
}

function arg(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function main(): Promise<void> {
	const command = process.argv[2];
	if (command === "create") {
		const arch = arg("--arch");
		if (arch !== "arm64" && arch !== "x64") throw new Error(`unsupported architecture: ${arch}`);
		const manifest = await createMacOsProvenanceManifest({
			arch,
			version: arg("--version"),
			binaryPath: arg("--binary"),
			nativeDir: arg("--native-dir"),
		});
		await Bun.write(arg("--output"), `${JSON.stringify(manifest, null, 2)}\n`);
		return;
	}
	if (command === "verify") {
		const manifest = (await Bun.file(arg("--manifest")).json()) as MacOsProvenanceManifest;
		const layout = arg("--layout");
		if (layout !== "release" && layout !== "homebrew" && layout !== "pkg") throw new Error("invalid --layout");
		const installedSystemRoot = process.argv.includes("--installed-system-root");
		if (installedSystemRoot && layout !== "pkg") {
			throw new Error("--installed-system-root is valid only for pkg verification");
		}
		await verifyMacOsProvenance({
			manifest,
			rootDir: arg("--root"),
			layout,
			// Expanded package payloads are closed inventories. A live system root is
			// not: hosted runners legitimately contain unrelated /usr/local/bin tools.
			// Hashes and strict signatures for every manifest-owned file remain required.
			rejectUnexpected: !installedSystemRoot,
		});
		return;
	}
	throw new Error("usage: macos-release-provenance.ts <create|verify> ...");
}

if (import.meta.main) await main();
