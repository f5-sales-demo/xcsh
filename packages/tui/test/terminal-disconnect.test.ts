import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { ProcessTerminal } from "@f5-sales-demo/pi-tui/terminal";

const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinSetRawMode = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");

function restore(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) Object.defineProperty(target, key, descriptor);
	else Reflect.deleteProperty(target, key);
}

describe("ProcessTerminal disconnect containment", () => {
	let signals: Array<string | number | undefined>;

	beforeEach(() => {
		signals = [];
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdin, "setRawMode", {
			value: vi.fn(() => process.stdin),
			configurable: true,
		});
		vi.spyOn(process, "kill").mockImplementation(((_pid: number, signal?: string | number) => {
			signals.push(signal);
			return true;
		}) as typeof process.kill);
		vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		restore(process.stdin, "isTTY", stdinIsTty);
		restore(process.stdout, "isTTY", stdoutIsTty);
		restore(process.stdin, "setRawMode", stdinSetRawMode);
	});

	it("routes stdin end, close, and error through one idempotent disconnect", () => {
		let disconnects = 0;
		for (const event of ["end", "close", "error"] as const) {
			const terminal = new ProcessTerminal();
			terminal.start(
				() => {},
				() => {},
				() => {
					disconnects++;
					terminal.stop();
				},
			);
			expect(() =>
				event === "error" ? process.stdin.emit(event, new Error("revoked stdin")) : process.stdin.emit(event),
			).not.toThrow();
		}
		expect(disconnects).toBe(3);
		expect(signals.filter(signal => signal === "SIGHUP")).toHaveLength(3);
	});

	it("routes stdout errors through disconnect", () => {
		const terminal = new ProcessTerminal();
		let disconnects = 0;
		terminal.start(
			() => {},
			() => {},
			() => {
				disconnects++;
				terminal.stop();
			},
		);

		expect(() => process.stdout.emit("error", new Error("revoked stdout"))).not.toThrow();
		expect(disconnects).toBe(1);
		expect(signals).toContain("SIGHUP");
	});

	it("still signals when dead-terminal raw-mode restoration throws", () => {
		let started = false;
		Object.defineProperty(process.stdin, "setRawMode", {
			value: () => {
				if (started) throw new Error("setRawMode failed with errno: 2");
				started = true;
				return process.stdin;
			},
			configurable: true,
		});
		const terminal = new ProcessTerminal();
		terminal.start(
			() => {},
			() => {},
			() => terminal.stop(),
		);

		expect(() => process.stdin.emit("end")).not.toThrow();
		expect(signals).toContain("SIGHUP");
	});

	it("still signals when the disconnect handler throws", () => {
		const terminal = new ProcessTerminal();
		terminal.start(
			() => {},
			() => {},
			() => {
				throw new Error("teardown failed");
			},
		);

		expect(() => process.stdin.emit("end")).not.toThrow();
		expect(signals).toContain("SIGHUP");
		terminal.stop();
	});

	it("continues to surface raw-mode restoration failures on a live terminal", () => {
		let started = false;
		Object.defineProperty(process.stdin, "setRawMode", {
			value: () => {
				if (started) throw new Error("live raw-mode failure");
				started = true;
				return process.stdin;
			},
			configurable: true,
		});
		const terminal = new ProcessTerminal();
		terminal.start(
			() => {},
			() => {},
		);

		expect(() => terminal.stop()).toThrow("live raw-mode failure");
	});
});
