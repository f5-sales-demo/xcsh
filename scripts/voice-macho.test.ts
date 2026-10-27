import { expect, test } from "bun:test";
import { inspectMachO, planMachORelocations, verifyMachOLinkage } from "./voice-macho";

const helper = "codex-resources/voice/bin/codex-voice-host";
const library = "codex-resources/voice/lib/libgstapp-1.0.0.dylib";
function binary(imports: string[], rpaths: string[] = []): Uint8Array {
	const commands = [...imports.map(name => [12, name] as const), ...rpaths.map(name => [0x8000001c, name] as const)].map(([type, name]) => {
		const offset = type === 12 ? 24 : 12;
		const value = new TextEncoder().encode(name);
		const bytes = new Uint8Array(Math.ceil((offset + value.length + 1) / 8) * 8);
		const view = new DataView(bytes.buffer);
		view.setUint32(0, type, true); view.setUint32(4, bytes.length, true); view.setUint32(8, offset, true);
		bytes.set(value, offset);
		return bytes;
	});
	const total = commands.reduce((sum, bytes) => sum + bytes.length, 0);
	const result = new Uint8Array(32 + total);
	const header = new DataView(result.buffer);
	header.setUint32(0, 0xfeedfacf, true); header.setUint32(4, 0x0100000c, true);
	header.setUint32(12, 2, true); header.setUint32(16, commands.length, true); header.setUint32(20, total, true);
	let at = 32;
	for (const bytes of commands) { result.set(bytes, at); at += bytes.length; }
	return result;
}

test("a helper with a CI-prefix dependency cannot qualify even when its library is inventoried", () => {
	const bytes = binary(["/fixture/build/prefix/lib/libgstapp-1.0.0.dylib"], ["@loader_path/../lib"]);
	expect(() => verifyMachOLinkage(bytes, helper, new Set([library]))).toThrow("Unbundled Mach-O dependency");
	expect(planMachORelocations(bytes, new Set(["lib/libgstapp-1.0.0.dylib"]))).toEqual([
		{ from: "/fixture/build/prefix/lib/libgstapp-1.0.0.dylib", to: "@loader_path/../lib/libgstapp-1.0.0.dylib" },
	]);
});
test("relative helper imports resolve only to inventoried runtime bytes while system imports remain intact", () => {
	const bytes = binary(["@loader_path/../lib/libgstapp-1.0.0.dylib", "/usr/lib/libSystem.B.dylib"], ["@loader_path/../lib"]);
	expect(() => verifyMachOLinkage(bytes, helper, new Set([library]))).not.toThrow();
	expect(inspectMachO(bytes).imports).toHaveLength(2);
	expect(() => verifyMachOLinkage(bytes, helper, new Set())).toThrow();
});
test("escaped loader paths, undeclared libraries and external rpaths are rejected", () => {
	for (const bytes of [binary(["@loader_path/../../../escape.dylib"]), binary(["/fixture/undeclared.dylib"]),
		binary(["@rpath/libgstapp-1.0.0.dylib"], ["/fixture/build/lib"])])
		expect(() => verifyMachOLinkage(bytes, helper, new Set([library]))).toThrow();
	expect(() => planMachORelocations(binary(["/fixture/undeclared.dylib"]), new Set(["lib/libgstapp-1.0.0.dylib"]))).toThrow();
});
test("truncated load commands cannot supply loader evidence", () => {
	const bytes = binary(["@loader_path/../lib/libgstapp-1.0.0.dylib"]);
	expect(() => inspectMachO(bytes.subarray(0, bytes.length - 1))).toThrow();
	new DataView(bytes.buffer).setUint32(36, 0xffffffff, true);
	expect(() => inspectMachO(bytes)).toThrow();
});
