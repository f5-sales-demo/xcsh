import { describe, expect, it } from "bun:test";
import { TypedEventEmitter } from "@f5-sales-demo/pi-tui/events";

type Events = {
	todoPhasesChanged: { count: number };
	reminderFired: { id: string };
};

describe("TypedEventEmitter — on / emit", () => {
	it("fires the handler with the typed payload on emit", () => {
		const bus = new TypedEventEmitter<Events>();
		const received: Array<{ count: number }> = [];
		bus.on("todoPhasesChanged", p => received.push(p));
		bus.emit("todoPhasesChanged", { count: 3 });
		expect(received).toEqual([{ count: 3 }]);
	});

	it("delivers independent event types without crosstalk", () => {
		const bus = new TypedEventEmitter<Events>();
		const todos: Array<{ count: number }> = [];
		const reminders: Array<{ id: string }> = [];
		bus.on("todoPhasesChanged", p => todos.push(p));
		bus.on("reminderFired", p => reminders.push(p));
		bus.emit("todoPhasesChanged", { count: 1 });
		bus.emit("reminderFired", { id: "r1" });
		expect(todos).toEqual([{ count: 1 }]);
		expect(reminders).toEqual([{ id: "r1" }]);
	});
});

describe("TypedEventEmitter — unsubscribe", () => {
	it("returns a closure from on() that removes the handler", () => {
		const bus = new TypedEventEmitter<Events>();
		const received: Array<{ count: number }> = [];
		const unsubscribe = bus.on("todoPhasesChanged", p => received.push(p));
		bus.emit("todoPhasesChanged", { count: 1 });
		unsubscribe();
		bus.emit("todoPhasesChanged", { count: 2 });
		expect(received).toEqual([{ count: 1 }]);
	});

	it("unsubscribing one handler does not affect peers on the same event", () => {
		const bus = new TypedEventEmitter<Events>();
		const a: Array<{ count: number }> = [];
		const b: Array<{ count: number }> = [];
		const unsubA = bus.on("todoPhasesChanged", p => a.push(p));
		bus.on("todoPhasesChanged", p => b.push(p));
		bus.emit("todoPhasesChanged", { count: 1 });
		unsubA();
		bus.emit("todoPhasesChanged", { count: 2 });
		expect(a).toEqual([{ count: 1 }]);
		expect(b).toEqual([{ count: 1 }, { count: 2 }]);
	});

	it("calling the unsubscribe closure twice is safe (no throw)", () => {
		const bus = new TypedEventEmitter<Events>();
		const unsubscribe = bus.on("todoPhasesChanged", () => {});
		unsubscribe();
		expect(() => unsubscribe()).not.toThrow();
	});
});

describe("TypedEventEmitter — multiple subscribers", () => {
	it("fires all subscribers in insertion order on emit", () => {
		const bus = new TypedEventEmitter<Events>();
		const order: string[] = [];
		bus.on("todoPhasesChanged", () => order.push("a"));
		bus.on("todoPhasesChanged", () => order.push("b"));
		bus.on("todoPhasesChanged", () => order.push("c"));
		bus.emit("todoPhasesChanged", { count: 0 });
		expect(order).toEqual(["a", "b", "c"]);
	});
});

describe("TypedEventEmitter — zero subscribers (documented no-op)", () => {
	it("emitting an event with no subscribers is a no-op (no throw)", () => {
		const bus = new TypedEventEmitter<Events>();
		expect(() => bus.emit("todoPhasesChanged", { count: 1 })).not.toThrow();
	});

	it("internal handler map stays absent for events that were never subscribed", () => {
		const bus = new TypedEventEmitter<Events>();
		const unsub = bus.on("todoPhasesChanged", () => {});
		unsub();
		expect(() => bus.emit("todoPhasesChanged", { count: 2 })).not.toThrow();
	});
});
