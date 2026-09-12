import { expect, test } from "bun:test";
import { SessionTransitions } from "../src/session/session-transitions";

test("a compound session change owns nested changes and emits one lifecycle pair", async () => {
	const transitions = new SessionTransitions();
	const phases: string[] = [];
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let savedScope: symbol | undefined;
	transitions.subscribe(async phase => {
		phases.push(phase);
		if (phase === "before") {
			entered.resolve();
			await release.promise;
		}
	});
	const change = transitions.run(async scope => {
		savedScope = scope;
		return transitions.run(async () => "Changed", scope);
	});
	await entered.promise;
	try {
		expect(transitions.changing).toBe(true);
		expect(() => transitions.assertAvailable()).toThrow("transition");
		await expect(transitions.run(async () => "Competing")).rejects.toThrow("transition");
		await expect(transitions.run(async () => "Foreign", Symbol())).rejects.toThrow("transition");
	} finally {
		release.resolve();
	}
	expect(await change).toBe("Changed");
	expect(phases).toEqual(["before", "after"]);
	expect(transitions.changing).toBe(false);
	await expect(transitions.run(async () => "Expired", savedScope)).rejects.toThrow("transition");
	expect(await transitions.run(async () => "Next")).toBe("Next");
});

test("a failed nested change restores listeners and permits the next operation", async () => {
	const transitions = new SessionTransitions();
	const phases: string[] = [];
	transitions.subscribe(phase => {
		phases.push(phase);
	});
	await expect(
		transitions.run(scope =>
			transitions.run(async () => {
				throw new Error("Fixture failure");
			}, scope),
		),
	).rejects.toThrow("Fixture failure");
	expect(phases).toEqual(["before", "after"]);
	expect(transitions.changing).toBe(false);
	expect(await transitions.run(async () => "Recovered")).toBe("Recovered");
});

test.each(["before", "after"])(
	"closing during %s listeners drains them and rejects the operation",
	async blockedPhase => {
		const transitions = new SessionTransitions();
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const phases: string[] = [];
		transitions.subscribe(async phase => {
			phases.push(phase);
			if (phase === blockedPhase) {
				entered.resolve();
				await release.promise;
			}
		});
		let changed = false;
		const changing = transitions
			.run(async () => {
				changed = true;
				return "Changed";
			})
			.then(
				value => ({ value }),
				error => ({ error }),
			);
		await entered.promise;
		transitions.beginClose();
		let idle = false;
		const drained = transitions.waitForIdle().then(() => {
			idle = true;
		});
		try {
			await Promise.resolve();
			expect(idle).toBe(false);
			expect(() => transitions.checkpoint()).toThrow("closing");
			await expect(transitions.run(async () => "Late")).rejects.toThrow("closing");
		} finally {
			release.resolve();
		}
		const result = await changing;
		await drained;
		expect(result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining("closing") }) });
		expect(changed).toBe(blockedPhase === "after");
		expect(phases).toEqual(["before", "after"]);
		expect(transitions.changing).toBe(false);
		await expect(transitions.run(async () => "Reopened")).rejects.toThrow("closing");
	},
);

test("a failed transition also invalidates earlier asynchronous preparation", async () => {
	const transitions = new SessionTransitions();
	const check = transitions.checkpoint();
	await expect(
		transitions.run(async () => {
			throw new Error("Storage failed");
		}),
	).rejects.toThrow("Storage failed");
	expect(check).toThrow("superseded");
	expect(() => transitions.checkpoint()()).not.toThrow();
});
