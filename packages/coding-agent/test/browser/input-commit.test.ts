import { describe, expect, it } from "bun:test";
import { commitInputValue } from "@f5xc-salesdemos/xcsh/browser/input-commit";

// Minimal fake Event capturing type + bubbles.
class FakeEvent {
	type: string;
	bubbles: boolean;
	constructor(type: string, opts?: { bubbles?: boolean }) {
		this.type = type;
		this.bubbles = !!opts?.bubbles;
	}
}

describe("commitInputValue", () => {
	it("sets value and dispatches bubbling input then change", () => {
		const events: { type: string; bubbles: boolean }[] = [];
		let stored = "";
		const el = {
			get value() {
				return stored;
			},
			set value(v: string) {
				stored = v;
			},
			ownerDocument: { defaultView: { Event: FakeEvent } },
			dispatchEvent(e: FakeEvent) {
				events.push({ type: e.type, bubbles: e.bubbles });
				return true;
			},
		};
		commitInputValue(el as never, "app.example.com");
		expect(stored).toBe("app.example.com");
		expect(events.map(e => e.type)).toEqual(["input", "change", "blur", "focusout"]);
	});

	it("uses the prototype value setter, bypassing an instance-patched descriptor", () => {
		// Simulate a framework (e.g. vsui-input) that patched the element's OWN
		// `value` descriptor so plain assignment never reaches the real model.
		let nativeStored = "";
		const proto = {};
		Object.defineProperty(proto, "value", {
			configurable: true,
			get() {
				return nativeStored;
			},
			set(v: string) {
				nativeStored = v;
			},
		});
		const el: Record<string, unknown> = Object.create(proto);
		let patchedCalled = false;
		Object.defineProperty(el, "value", {
			configurable: true,
			get() {
				return nativeStored;
			},
			set() {
				patchedCalled = true; // framework patch swallows the write
			},
		});
		const events: string[] = [];
		el.ownerDocument = { defaultView: { Event: FakeEvent } };
		el.dispatchEvent = (e: FakeEvent) => {
			events.push(e.type);
			return true;
		};
		commitInputValue(el as never, "x.example.com");
		expect(nativeStored).toBe("x.example.com"); // prototype (native) setter used
		expect(patchedCalled).toBe(false); // instance patch bypassed
		expect(events).toEqual(["input", "change", "blur", "focusout"]);
	});
});
