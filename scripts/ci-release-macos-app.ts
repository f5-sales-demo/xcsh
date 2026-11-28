#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	createMacOsProvenanceManifest, inspectMacOsSignature,
	type MacOsProvenanceManifest, verifyMacOsProvenance,
} from "./macos-release-provenance";

export function appInfoPlist(arch: "arm64" | "x64", version: string): string {
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid app version");
	if (arch !== "arm64" && arch !== "x64") throw new Error("Invalid app architecture");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.f5.xcsh</string>
<key>CFBundleName</key><string>xcsh</string>
<key>CFBundleDisplayName</key><string>xcsh</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>xcsh-darwin-${arch}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSUIElement</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
</dict></plist>
`;
}

export async function stageMacOsHomebrewApp(options: {
	arch: "arm64" | "x64"; version: string; binariesDir: string; rootDir: string;
}): Promise<{ appDir: string; binaryPath: string; nativeDir: string }> {
	const { arch, version, binariesDir, rootDir } = options;
	const plist = appInfoPlist(arch, version);
	const manifest = await Bun.file(path.join(binariesDir, `xcsh-darwin-${arch}.provenance.json`)).json() as MacOsProvenanceManifest;
	if (manifest.arch !== arch || manifest.version !== version) throw new Error("App source provenance does not match target");
	await verifyMacOsProvenance({ manifest, rootDir: binariesDir, layout: "release", inspectSignature: false });
	for (const file of manifest.files) {
		if (!(await fs.lstat(path.join(binariesDir, file.name))).isFile()) throw new Error("App source must be regular files");
	}
	await fs.mkdir(rootDir, { recursive: true });
	if ((await fs.readdir(rootDir)).length) throw new Error("App staging root must be empty");
	const appDir = path.join(rootDir, "xcsh.app");
	const binaryPath = path.join(appDir, "Contents/MacOS", `xcsh-darwin-${arch}`);
	const nativeDir = path.join(appDir, "Contents/libexec");
	await fs.mkdir(path.dirname(binaryPath), { recursive: true });
	await fs.mkdir(nativeDir, { recursive: true });
	await fs.writeFile(path.join(appDir, "Contents/Info.plist"), plist);
	for (const file of manifest.files) {
		const target = file.role === "cli" ? binaryPath : path.join(nativeDir, file.name);
		await fs.copyFile(path.join(binariesDir, file.name), target);
		await fs.chmod(target, 0o755);
	}
	return { appDir, binaryPath, nativeDir };
}

function arg(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function main(): Promise<void> {
	if (process.platform !== "darwin") throw new Error("Apple distribution operations require macOS CI");
	const arch = arg("--arch");
	if (arch !== "arm64" && arch !== "x64") throw new Error("Invalid architecture");
	const version = arg("--version");
	const rootDir = arg("--root");
	const binariesDir = arg("--binaries-dir");
	if (process.argv[2] === "stage") {
		const manifest = await Bun.file(path.join(binariesDir, `xcsh-darwin-${arch}.provenance.json`)).json() as MacOsProvenanceManifest;
		await verifyMacOsProvenance({ manifest, rootDir: binariesDir, layout: "release" });
		await stageMacOsHomebrewApp({ arch, version, binariesDir, rootDir });
		return;
	}
	if (process.argv[2] === "manifest") {
		const appDir = path.join(rootDir, "xcsh.app");
		if (await Bun.file(path.join(appDir, "Contents/Info.plist")).text() !== appInfoPlist(arch, version)) {
			throw new Error("Signed app identity/version differs from the release");
		}
		const manifest = await createMacOsProvenanceManifest({
			arch, version, binaryPath: path.join(appDir, "Contents/MacOS", `xcsh-darwin-${arch}`),
			nativeDir: path.join(appDir, "Contents/libexec"),
			inspectSignature: file => inspectMacOsSignature(file, appDir),
		});
		const text = JSON.stringify(manifest, null, 2) + "\n";
		await fs.mkdir(path.join(rootDir, "provenance"));
		await fs.writeFile(path.join(rootDir, "provenance/manifest.json"), text);
		await verifyMacOsProvenance({ manifest, rootDir, layout: "app", rejectUnexpected: true });
		await fs.writeFile(path.join(binariesDir, `xcsh-darwin-${arch}.homebrew.provenance.json`), text);
		return;
	}
	throw new Error("usage: ci-release-macos-app.ts <stage|manifest> --arch --version --binaries-dir --root");
}
if (import.meta.main) await main();
