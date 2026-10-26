import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Project the existing trusted OS runtime for alsa-sys's pre-generated FFI. */
export async function projectSystemAlsa(cache: string): Promise<string> {
	const machine = process.arch === "arm64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu";
	let library: string | undefined;
	for (const candidate of [`/usr/lib/${machine}/libasound.so.2`, `/lib/${machine}/libasound.so.2`]) {
		try {
			library = await realpath(candidate);
			break;
		} catch {}
	}
	if (!library || !["x64", "arm64"].includes(process.arch))
		throw new Error("A supported system ALSA runtime is required");
	const bytes = await readFile(library);
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		bytes.length < 64 ||
		bytes[0] !== 127 ||
		bytes[1] !== 69 ||
		bytes[2] !== 76 ||
		bytes[3] !== 70 ||
		bytes[4] !== 2 ||
		bytes[5] !== 1 ||
		header.getUint16(18, true) !== (process.arch === "arm64" ? 183 : 62)
	)
		throw new Error("System ALSA architecture mismatch");
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const root = join(cache, "system-alsa", sha256);
	await mkdir(join(root, "lib/pkgconfig"), { recursive: true });
	await writeFile(join(root, "lib/libasound.so"), bytes);
	const copied = await readFile(join(root, "lib/libasound.so"));
	if (createHash("sha256").update(copied).digest("hex") !== sha256) throw new Error("ALSA SDK projection changed");
	const probe = Bun.spawn(
		[
			"python3",
			"-c",
			"import ctypes,sys; lib=ctypes.CDLL(sys.argv[1]); lib.snd_asoundlib_version.restype=ctypes.c_char_p; print(lib.snd_asoundlib_version().decode())",
			library,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const version = (await new Response(probe.stdout).text()).trim();
	if ((await probe.exited) !== 0 || !/^\d+(?:\.\d+)+$/.test(version))
		throw new Error("System ALSA version could not be verified");
	await writeFile(
		join(root, "lib/pkgconfig/alsa.pc"),
		`prefix=${root}\nlibdir=\${prefix}/lib\nName: alsa\nDescription: Verified host ALSA runtime projection for pre-generated Rust FFI\nVersion: ${version}\nLibs: -L\${libdir} -lasound\nCflags:\n`,
	);
	await writeFile(
		join(root, "projection.private.json"),
		JSON.stringify(
			{ origin: "operating-system", library, sha256, version, architecture: process.arch, microphoneOpened: false },
			null,
			2,
		),
	);
	return join(root, "lib/pkgconfig");
}
