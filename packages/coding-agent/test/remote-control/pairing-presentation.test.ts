import { expect, test } from "bun:test";
import jsQR from "jsqr";
import { PairingDisplay, pairingUrl, presentRemoteResult } from "../../src/remote-control/pairing-presentation";

const pairing = {
	pairing_code: "synthetic-opaque+/=&?challenge",
	manual_pairing_code: "ABCD-EFGH",
	server_id: "fixture-server",
	environment_id: "fixture-environment",
	expires_at: "2099-01-01T00:00:00Z",
};
test("QR uses the first-party URL with the opaque challenge, independently of manual fallback", () => {
	expect(pairingUrl(pairing)).toBe(
		"https://chatgpt.com/codex/pair?pairing_code=synthetic-opaque%2B%2F%3D%26%3Fchallenge",
	);
	expect(pairingUrl({ ...pairing, manual_pairing_code: null })).toBe(pairingUrl(pairing));
});
test.each([
	{ pairing_code: "" },
	{ pairing_code: "x".repeat(4097) },
	{ expires_at: "2000-01-01T00:00:00Z" },
	{ manual_pairing_code: "unsafe\x1b[2J" },
])("invalid or expired challenges cannot be displayed %#", invalid => {
	expect(() => pairingUrl({ ...pairing, ...invalid })).toThrow("Invalid pairing response");
});
test("independent decoder reads the complete URL from terminal half-block QR with four-module quiet zone", () => {
	const display = new PairingDisplay(
		pairing,
		() => {},
		() => 80,
	);
	const lines = display.render(120);
	const qr = lines.filter(line => line.startsWith("\x1b[30;47m"));
	const plain = qr.map(line => Bun.stripANSI(line));
	expect(plain.length).toBeGreaterThan(0);
	expect(plain[0].trim()).toBe("");
	expect(plain[1].trim()).toBe("");
	const width = plain[0].length;
	const height = plain.length * 2;
	const scale = 5;
	const pixels = new Uint8ClampedArray(width * height * scale * scale * 4).fill(255);
	for (let row = 0; row < plain.length; row++) {
		for (let column = 0; column < width; column++) {
			const char = plain[row][column];
			for (let half = 0; half < 2; half++) {
				const black = char === "█" || (half === 0 ? char === "▀" : char === "▄");
				if (!black) continue;
				for (let y = 0; y < scale; y++)
					for (let x = 0; x < scale; x++) {
						const offset = (((row * 2 + half) * scale + y) * width * scale + column * scale + x) * 4;
						pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
					}
			}
		}
	}
	expect(jsQR(pixels, width * scale, height * scale)?.data).toBe(pairingUrl(pairing));
	expect(lines.join("\n")).toContain("Manual code: ABCD-EFGH");
	expect(lines.join("\n")).not.toContain(pairing.pairing_code);
	display.dispose();
});
test("small or expired displays remove QR rather than clipping it into a false scan target", () => {
	let now = Date.now();
	const display = new PairingDisplay(
		{ ...pairing, expires_at: new Date(now + 1000).toISOString() },
		() => {},
		() => 80,
		() => now,
	);
	expect(display.render(20).join("\n")).toContain("Enlarge");
	expect(display.render(120).some(line => line.startsWith("\x1b[30;47m"))).toBe(true);
	now += 1001;
	expect(display.render(120).join("\n")).toContain("expired");
	expect(display.render(120).some(line => line.startsWith("\x1b[30;47m"))).toBe(false);
	display.dispose();
});
test("dismissal releases the challenge and never claims pairing success", () => {
	let dismissed = false;
	const display = new PairingDisplay(
		pairing,
		() => {
			dismissed = true;
		},
		() => 80,
	);
	display.handleInput("\r");
	expect(dismissed).toBe(true);
	expect(display.render(120).join("\n")).not.toContain("ABCD-EFGH");
});
test("JSON compatibility and human pairing are separate output paths", async () => {
	const written: string[] = [];
	const shown: unknown[] = [];
	const io = {
		write: (value: string) => written.push(value),
		show: async (value: unknown) => {
			shown.push(value);
		},
	};
	await presentRemoteResult("pair", pairing, true, io);
	expect(written).toEqual([`${JSON.stringify(pairing)}\n`]);
	expect(shown).toEqual([]);
	written.length = 0;
	await presentRemoteResult("pair", pairing, false, io);
	expect(written).toEqual([]);
	expect(shown).toEqual([pairing]);
	await presentRemoteResult("status", { enabled: false }, false, io);
	expect(written).toEqual(['{"enabled":false}\n']);
});
