import { expect, test } from "bun:test";

const root = new URL("../../../", import.meta.url);
type Manifest = {
	dependencies?: Record<string, { version?: string }>;
	target?: Record<string, { dependencies?: Record<string, { version?: string }> }>;
};
const manifest = async (name: string) => Bun.TOML.parse(await Bun.file(new URL(name, root)).text()) as Manifest;

test("Native Unix dependency owners use the qualified current nix API", async () => {
	const pty = await manifest("crates/portable-pty-vendored/Cargo.toml");
	expect(pty.dependencies?.nix?.version).toBe("0.32.0");
	for (const name of ["brush-core", "brush-builtins"]) {
		const brush = await manifest(`crates/${name}-vendored/Cargo.toml`);
		expect(brush.target?.["cfg(unix)"]?.dependencies?.nix?.version).toBe("0.32.0");
	}
});

test("Native utility dependency uses the qualified current uucore release", async () => {
	const brush = await manifest("crates/brush-builtins-vendored/Cargo.toml");
	expect(brush.target?.["cfg(any(unix, windows))"]?.dependencies?.uucore?.version).toBe("0.13.0");
});

test("Native lock removes the retired nix branch and warning-producing build macros", async () => {
	const lock = Bun.TOML.parse(await Bun.file(new URL("Cargo.lock", root)).text()) as {
		package: { name: string; version: string }[];
	};
	expect(lock.package.filter(p => p.name === "cfg_aliases").map(p => p.version)).toEqual(["0.2.2"]);
	expect(lock.package.some(p => p.name === "nix" && p.version === "0.28.0")).toBe(false);
	expect(lock.package.some(p => p.name === "nix" && p.version === "0.32.0")).toBe(true);
});
