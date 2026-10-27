import { posix } from "node:path";

export function inspectMachO(bytes: Uint8Array): { imports: string[]; rpaths: string[] } {
	if (bytes.length < 32) throw new Error("Invalid Mach-O header");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint32(16, true), size = view.getUint32(20, true);
	if (view.getUint32(0, true) !== 0xfeedfacf || count > 4096 || size > 1_048_576 || 32 + size > bytes.length)
		throw new Error("Invalid Mach-O load commands");
	const imports: string[] = [], rpaths: string[] = [];
	let at = 32;
	for (let index = 0; index < count; index++) {
		if (at + 8 > 32 + size) throw new Error("Truncated Mach-O load command");
		const kind = view.getUint32(at, true), length = view.getUint32(at + 4, true);
		if (length < 8 || at + length > 32 + size) throw new Error("Invalid Mach-O load command");
		if ([0x20, 0x80000023, 0x27].includes(kind)) throw new Error("Unsupported Mach-O loader command");
		if ([12, 0x80000018, 0x8000001f, 0x8000001c].includes(kind)) {
			const minimum = kind === 0x8000001c ? 12 : 24;
			if (length < minimum) throw new Error("Invalid Mach-O dependency command");
			const offset = view.getUint32(at + 8, true);
			if (offset < minimum || offset >= length) throw new Error("Invalid Mach-O dependency name");
			const tail = bytes.subarray(at + offset, at + length), end = tail.indexOf(0);
			if (end <= 0 || end > 4096) throw new Error("Invalid Mach-O dependency name");
			const name = new TextDecoder("utf-8", { fatal: true }).decode(tail.subarray(0, end));
			if (/[\x00-\x1f]/.test(name)) throw new Error("Invalid Mach-O dependency name");
			(kind === 0x8000001c ? rpaths : imports).push(name);
		}
		at += length;
	}
	if (at !== 32 + size) throw new Error("Incomplete Mach-O load commands");
	return { imports, rpaths };
}
function systemImport(name: string): boolean {
	return (name.startsWith("/usr/lib/") || name.startsWith("/System/Library/Frameworks/")) && posix.normalize(name) === name;
}
const voiceRoot = "codex-resources/voice/";
function resolveLoaderPath(name: string, binary: string): string | undefined {
	if (!name.startsWith("@loader_path/")) return;
	const value = posix.normalize(posix.join(posix.dirname(binary), name.slice("@loader_path/".length)));
	return value.startsWith(voiceRoot) ? value : undefined;
}
/** Read loader evidence directly; an existing CI build prefix must not mask a broken package. */
export function verifyMachOLinkage(bytes: Uint8Array, binary: string, files: ReadonlySet<string>): void {
	const { imports, rpaths } = inspectMachO(bytes);
	for (const path of rpaths)
		if (!resolveLoaderPath(path, binary)) throw new Error("External Mach-O runtime search path");
	for (const name of imports) {
		if (systemImport(name)) continue;
		const resolved = resolveLoaderPath(name, binary);
		if (resolved && files.has(resolved)) continue;
		if (name.startsWith("@rpath/") && rpaths.some(path => {
			const directory = resolveLoaderPath(path, binary);
			return directory && files.has(posix.normalize(posix.join(directory, name.slice("@rpath/".length))));
		})) continue;
		throw new Error("Unbundled Mach-O dependency");
	}
}
export function planMachORelocations(bytes: Uint8Array, runtimeFiles: ReadonlySet<string>): { from: string; to: string }[] {
	const changes: { from: string; to: string }[] = [];
	for (const name of inspectMachO(bytes).imports) {
		if (systemImport(name)) continue;
		const base = posix.basename(name);
		if (!/^[A-Za-z0-9_.+-]+\.dylib$/.test(base) || !runtimeFiles.has(`lib/${base}`))
			throw new Error("Helper dependency is absent from the verified runtime");
		const target = `@loader_path/../lib/${base}`;
		if (name !== target) changes.push({ from: name, to: target });
	}
	return changes;
}
/** Binary adaptation and signing belong exclusively to the approved macOS CI builder. */
export async function relocatePackagedMachO(helper: string, runtimeFiles: ReadonlySet<string>): Promise<void> {
	if (process.platform !== "darwin" || process.env.GITHUB_ACTIONS !== "true")
		throw new Error("Prepare Mac native packages on approved CI");
	const bytes = await Bun.file(helper).bytes();
	const changes = planMachORelocations(bytes, runtimeFiles);
	async function run(args: string[]): Promise<void> {
		const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
		const [code] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		if (code !== 0) throw new Error("Mac helper loader adaptation failed");
	}
	for (const change of changes) await run(["/usr/bin/install_name_tool", "-change", change.from, change.to, helper]);
	for (const path of inspectMachO(bytes).rpaths)
		if (path !== "@loader_path/../lib") await run(["/usr/bin/install_name_tool", "-delete_rpath", path, helper]);
	await run(["/usr/bin/codesign", "--force", "--sign", "-", "--timestamp=none", helper]);
	await run(["/usr/bin/codesign", "--verify", "--strict", helper]);
}
