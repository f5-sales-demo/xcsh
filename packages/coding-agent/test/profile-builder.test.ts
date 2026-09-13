import { expect, test } from "bun:test";
import { ProfileBuilder } from "../src/person-profile/builder";

test("builder gathers both profiles repeatedly and stops on disposal", async () => {
	let person = 0,
		machine = 0,
		allowed = true;
	const builder = new ProfileBuilder(
		{
			reconcileFromCollectors: async () => {
				person++;
			},
		} as never,
		{
			refresh: async () => {
				machine++;
			},
		} as never,
		() => allowed,
	);
	await builder.refresh();
	await builder.refresh();
	expect([person, machine]).toEqual([2, 2]);
	allowed = false;
	await builder.refresh();
	expect([person, machine]).toEqual([2, 2]);
	allowed = true;
	await builder.dispose();
	await builder.refresh();
	expect([person, machine]).toEqual([2, 2]);
});

test("builder joins overlapping requests and aborts active collection on disposal", async () => {
	let aborted = false,
		calls = 0;
	const builder = new ProfileBuilder(
		{
			reconcileFromCollectors: async (signal: AbortSignal) => {
				calls++;
				await new Promise<void>(resolve => {
					signal.addEventListener(
						"abort",
						() => {
							aborted = true;
							resolve();
						},
						{ once: true },
					);
				});
			},
		} as never,
		{ refresh: async () => {} } as never,
		() => true,
	);
	const first = builder.refresh(),
		second = builder.refresh();
	await builder.dispose();
	await Promise.all([first, second]);
	expect(calls).toBe(1);
	expect(aborted).toBe(true);
});
