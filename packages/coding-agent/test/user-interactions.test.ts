import { expect, test } from "bun:test";
import { UserInteractions } from "../src/session/user-interactions";

test("a remote answer closes the terminal prompt and wins only once", async () => {
	const interactions = new UserInteractions();
	const local = Promise.withResolvers<string | undefined>();
	let signal: AbortSignal | undefined;
	const events: string[] = [];
	interactions.subscribe(event => events.push(event.type));
	const result = interactions.request({ kind: "select", title: "Continue?", options: ["Yes", "No"] }, abort => {
		signal = abort;
		return local.promise;
	});
	await Bun.sleep(0);
	const id = interactions.pending()[0].id;
	expect(interactions.respond(id, "Yes")).toBe(true);
	expect(signal?.aborted).toBe(true);
	expect(interactions.respond(id, "No")).toBe(false);
	local.resolve("No");
	expect(await result).toBe("Yes");
	expect(events).toEqual(["opened", "resolved"]);
	expect(interactions.pending()).toEqual([]);
});

test("a terminal answer rejects late remote answers and invalid choices leave the prompt pending", async () => {
	const interactions = new UserInteractions();
	const local = Promise.withResolvers<string | undefined>();
	const result = interactions.request(
		{ kind: "select", title: "Choose", options: ["Allow", "Deny"] },
		() => local.promise,
	);
	const id = interactions.pending()[0].id;
	expect(interactions.respond(id, "invented permission")).toBe(false);
	expect(interactions.pending()).toHaveLength(1);
	local.resolve("Deny");
	expect(await result).toBe("Deny");
	expect(interactions.respond(id, "Allow")).toBe(false);
});

test("cancellation aborts a prompt without turning it into an answer", async () => {
	const interactions = new UserInteractions();
	let signal: AbortSignal | undefined;
	const result = interactions.request({ kind: "input", title: "Fixture input" }, abort => {
		signal = abort;
		return new Promise(() => {});
	});
	await Bun.sleep(0);
	const id = interactions.pending()[0].id;
	interactions.cancelAll();
	expect(await result).toBeUndefined();
	expect(signal?.aborted).toBe(true);
	expect(interactions.respond(id, "late input")).toBe(false);
});

test("pending prompts can be observed after reconnect and consumer failure does not block the terminal", async () => {
	const interactions = new UserInteractions();
	interactions.subscribe(() => {
		throw new Error("fixture consumer failure");
	});
	const local = Promise.withResolvers<string | undefined>();
	const result = interactions.request({ kind: "input", title: "Input" }, () => local.promise);
	const before = interactions.pending();
	const resolved: string[] = [];
	const unsubscribe = interactions.subscribe(event => resolved.push(event.type));
	expect(interactions.pending()).toEqual(before);
	local.resolve("terminal value");
	expect(await result).toBe("terminal value");
	expect(resolved).toEqual(["resolved"]);
	unsubscribe();
});

test("pending input is bounded and shutdown never renders queued prompts", async () => {
	const interactions = new UserInteractions();
	let rendered = 0;
	const local = () => {
		rendered++;
		return new Promise<string | undefined>(() => {});
	};
	const pending = Array.from({ length: 32 }, () => interactions.request({ kind: "input", title: "Fixture" }, local));
	await expect(interactions.request({ kind: "input", title: "Overflow" }, local)).rejects.toThrow("Too many pending");
	expect(rendered).toBe(1);
	interactions.close();
	expect(await Promise.all(pending)).toEqual(Array(32).fill(undefined));
	expect(rendered).toBe(1);
	expect(await interactions.request({ kind: "input", title: "Closed" }, local)).toBeUndefined();
	expect(rendered).toBe(1);
});

test("aborted queued input never renders and observer changes cannot alter valid choices", async () => {
	const interactions = new UserInteractions();
	const first = interactions.request({ kind: "input", title: "Visible" }, () => new Promise(() => {}));
	const abort = new AbortController();
	let rendered = false;
	interactions.subscribe(event => {
		event.interaction.options = ["invented"];
	});
	const second = interactions.request(
		{ kind: "select", title: "Queued", options: ["Yes", "No"] },
		() => {
			rendered = true;
			return new Promise(() => {});
		},
		abort.signal,
	);
	const id = interactions.pending()[1].id;
	expect(interactions.respond(id, "invented")).toBe(false);
	abort.abort();
	expect(await second).toBeUndefined();
	expect(rendered).toBe(false);
	expect(interactions.pending()).toHaveLength(1);
	interactions.cancelAll();
	await first;
});
