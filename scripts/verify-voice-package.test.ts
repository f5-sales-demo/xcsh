import { expect, test } from "bun:test";
import { decodeHelperFrame, verifyNativeArchitecture } from "./verify-voice-package";

const frame = (payload: Uint8Array) => {
	const value = new Uint8Array(payload.length + 4);
	new DataView(value.buffer).setUint32(0, payload.length);
	value.set(payload, 4);
	return value;
};
test("helper decoder rejects partial, oversized and coalesced frames", () => {
	expect(() => decodeHelperFrame(new Uint8Array(3))).toThrow("Incomplete");
	const header = new Uint8Array(4);
	new DataView(header.buffer).setUint32(0, 128 * 1024 + 1);
	expect(() => decodeHelperFrame(header)).toThrow("Invalid");
	const valid = frame(new TextEncoder().encode('{"type":"ready"}'));
	expect(decodeHelperFrame(valid)).toEqual({ type: "ready" });
	expect(() => decodeHelperFrame(valid.subarray(0, valid.length - 1))).toThrow("Invalid");
	const doubled = new Uint8Array(valid.length * 2);
	doubled.set(valid);
	doubled.set(valid, valid.length);
	expect(() => decodeHelperFrame(doubled)).toThrow("Invalid");
});
test("malformed helper output is rejected without echoing private content", () => {
	for (const payload of [
		new TextEncoder().encode("private-input-not-json"),
		new Uint8Array([0xff]),
		new TextEncoder().encode("[]"),
	]) {
		expect(() => decodeHelperFrame(frame(payload))).toThrow("Malformed helper frame");
	}
});
test("native headers distinguish the declared target architectures", () => {
	const elf = new Uint8Array(64);
	elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
	new DataView(elf.buffer).setUint16(18, 62, true);
	expect(() => verifyNativeArchitecture(elf, "linux", "x64")).not.toThrow();
	expect(() => verifyNativeArchitecture(elf, "linux", "arm64")).toThrow("mismatch");
	const macho = new Uint8Array(64);
	const header = new DataView(macho.buffer);
	header.setUint32(0, 0xfeedfacf, true);
	header.setUint32(4, 0x0100000c, true);
	expect(() => verifyNativeArchitecture(macho, "darwin", "arm64")).not.toThrow();
	expect(() => verifyNativeArchitecture(macho, "darwin", "x64")).toThrow("mismatch");
	expect(() => verifyNativeArchitecture(elf, "darwin", "x64")).toThrow("mismatch");
	expect(() => verifyNativeArchitecture(new Uint8Array(4), "linux", "x64")).toThrow("Invalid");
});
