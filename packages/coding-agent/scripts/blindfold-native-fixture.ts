import { createDecipheriv } from "node:crypto";

/** Independent fixture-only envelope recovery, also used by producer qualification. */
export function recoverBlindfoldFixture(location: string, key: { n?: string; p?: string; q?: string }): Buffer {
	if (!location.trim().startsWith("string:///")) throw new Error("Expected native Blindfold location");
	const raw = Buffer.from(location.trim().slice("string:///".length), "base64");
	let cursor = 0;
	const take = (size: number) => {
		if (size < 0 || cursor + size > raw.length) throw new Error("Truncated envelope");
		const value = raw.subarray(cursor, cursor + size);
		cursor += size;
		return value;
	};
	const lp = () => take(take(4).readUInt32BE());
	if (
		lp().toString() !== "example-tenant" ||
		take(4).readUInt32BE() !== 1 ||
		take(8).readBigUInt64BE() !== 101n ||
		take(1)[0] !== 2
	)
		throw new Error("Unexpected fixture envelope");
	const integer = (bytes: Buffer) => BigInt(`0x${bytes.toString("hex") || "0"}`);
	const exponent = integer(lp()),
		modulus = integer(lp()),
		wrapped = integer(lp());
	if (exponent !== 65537n || modulus !== integer(Buffer.from(key.n!, "base64url")))
		throw new Error("Fixture key mismatch");
	const p = integer(Buffer.from(key.p!, "base64url")),
		q = integer(Buffer.from(key.q!, "base64url"));
	const inverse = (input: bigint, mod: bigint) => {
		const original = mod;
		let x = 1n,
			y = 0n;
		while (mod) {
			const quotient = input / mod;
			[input, mod] = [mod, input % mod];
			[x, y] = [y, x - quotient * y];
		}
		if (input !== 1n) throw new Error("No inverse");
		return ((x % original) + original) % original;
	};
	let base = wrapped,
		power = inverse(exponent * (203n + (1n << 31n)), (p - 1n) * (q - 1n)),
		result = 1n;
	for (; power > 0n; power >>= 1n, base = (base * base) % modulus) if (power & 1n) result = (result * base) % modulus;
	const block = Buffer.from(result.toString(16).padStart(508, "0"), "hex");
	if (block.subarray(0, 4).toString("hex") !== "deadbeef") throw new Error("Invalid fixture marker");
	const aes = createDecipheriv("aes-256-gcm", block.subarray(16, 48), block.subarray(4, 16));
	aes.setAuthTag(raw.subarray(-16));
	return Buffer.concat([aes.update(raw.subarray(cursor, -16)), aes.final()]);
}
