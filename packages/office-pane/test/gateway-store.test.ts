import { describe, expect, test } from "bun:test";
import { normalizeGatewayConfig } from "../src/core";
import { createLocalStorageGatewayStore, GATEWAY_STORE_KEY } from "../src/office/gateway-store";

/** Minimal in-memory Storage double (avoids depending on a DOM localStorage). */
class FakeStorage implements Storage {
	private map = new Map<string, string>();
	get length(): number {
		return this.map.size;
	}
	clear(): void {
		this.map.clear();
	}
	getItem(key: string): string | null {
		return this.map.has(key) ? (this.map.get(key) as string) : null;
	}
	key(index: number): string | null {
		return Array.from(this.map.keys())[index] ?? null;
	}
	removeItem(key: string): void {
		this.map.delete(key);
	}
	setItem(key: string, value: string): void {
		this.map.set(key, value);
	}
}

const CONFIG = normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic", token: "sk-1" });

describe("createLocalStorageGatewayStore", () => {
	test("load returns null when nothing is stored", () => {
		const store = createLocalStorageGatewayStore(new FakeStorage());
		expect(store.load()).toBeNull();
	});

	test("save then load round-trips the config", () => {
		const store = createLocalStorageGatewayStore(new FakeStorage());
		store.save(CONFIG);
		expect(store.load()).toEqual(CONFIG);
	});

	test("clear removes the stored config", () => {
		const backing = new FakeStorage();
		const store = createLocalStorageGatewayStore(backing);
		store.save(CONFIG);
		store.clear();
		expect(store.load()).toBeNull();
		expect(backing.getItem(GATEWAY_STORE_KEY)).toBeNull();
	});

	test("persists under the documented key", () => {
		const backing = new FakeStorage();
		createLocalStorageGatewayStore(backing).save(CONFIG);
		expect(backing.getItem(GATEWAY_STORE_KEY)).toBeTruthy();
	});

	test("corrupt stored JSON is treated as no config (does not throw)", () => {
		const backing = new FakeStorage();
		backing.setItem(GATEWAY_STORE_KEY, "{not json");
		expect(createLocalStorageGatewayStore(backing).load()).toBeNull();
	});

	test("a stored value missing required fields is treated as no config", () => {
		const backing = new FakeStorage();
		backing.setItem(GATEWAY_STORE_KEY, JSON.stringify({ baseUrl: "https://gw.example" })); // no token
		expect(createLocalStorageGatewayStore(backing).load()).toBeNull();
	});

	test("a stored value is re-normalized on load (defends against tampering)", () => {
		const backing = new FakeStorage();
		// A valid-but-unnormalized baseUrl proves re-normalization runs (trailing slash stripped).
		backing.setItem(GATEWAY_STORE_KEY, JSON.stringify({ baseUrl: "https://gw.example/anthropic/", token: "t" }));
		expect(createLocalStorageGatewayStore(backing).load()?.baseUrl).toBe("https://gw.example/anthropic");
	});

	test("a null storage (blocked/partitioned WebKit) degrades gracefully — no throws", () => {
		const store = createLocalStorageGatewayStore(null);
		expect(store.load()).toBeNull();
		// save/clear are best-effort no-ops, must not throw.
		expect(() => store.save(CONFIG)).not.toThrow();
		expect(() => store.clear()).not.toThrow();
	});

	test("a storage whose accessors throw SecurityError degrades gracefully — no throws", () => {
		const throwing: Storage = {
			length: 0,
			clear() {
				throw new Error("SecurityError");
			},
			getItem() {
				throw new Error("SecurityError");
			},
			key() {
				return null;
			},
			removeItem() {
				throw new Error("SecurityError");
			},
			setItem() {
				throw new Error("SecurityError");
			},
		};
		const store = createLocalStorageGatewayStore(throwing);
		expect(store.load()).toBeNull(); // getItem throws → caught → null
		expect(() => store.save(CONFIG)).not.toThrow();
		expect(() => store.clear()).not.toThrow();
	});
});
