import { expect, test } from "bun:test";
import { AgentToolError } from "@f5-sales-demo/pi-agent-core";
import { VoiceToolRetry } from "../src/session/voice-tool-retry";
import { ToolError } from "../src/tools/tool-errors";

test("exact classified read retries once without repeating previous mutation", async () => {
	const ledger = new VoiceToolRetry();
	let writes = 0;
	let reads = 0;
	const write = await ledger.run("write", "mutation", async () => {
		writes++;
		return { isError: false };
	});
	const read = await ledger.run("read", "readOnly", async () => ({
		isError: ++reads === 1,
		details: { status: 503 },
	}));
	expect(write.isError).toBe(false);
	expect(read.isError).toBe(false);
	expect(writes).toBe(1);
	expect(reads).toBe(2);
});
test("nested and concurrent read failures share one retry", async () => {
	const ledger = new VoiceToolRetry();
	let calls = 0;
	await Promise.all([
		ledger.run("one", "readOnly", async () => {
			calls++;
			return { isError: true, details: { status: 503 } };
		}),
		ledger.run("two", "readOnly", async () => {
			calls++;
			return { isError: true, details: { status: 503 } };
		}),
	]);
	expect(calls).toBe(3);
});
test.each(["mutation", "unknown"] as const)("%s failure cannot replay", async effect => {
	const ledger = new VoiceToolRetry();
	let calls = 0;
	await expect(
		ledger.run("effect", effect, async () => {
			calls++;
			throw new Error("lost response");
		}),
	).rejects.toThrow("outcome is uncertain");
	expect(calls).toBe(1);
	expect(ledger.operations()).toEqual([{ id: "effect", effect, outcome: "unknown" }]);
});

test("cancellation after failed read prevents retry and retains outcome", async () => {
	const ledger = new VoiceToolRetry();
	let calls = 0;
	let cancelled = false;
	const result = await ledger.run(
		"cancelled",
		"readOnly",
		async () => {
			calls++;
			cancelled = true;
			return { isError: true, details: { status: 503 } };
		},
		() => cancelled,
	);
	expect(result.isError).toBe(true);
	expect(calls).toBe(1);
	expect(ledger.operations()[0]?.outcome).toBe("failed");
});

test("already cancelled operation never executes", async () => {
	const ledger = new VoiceToolRetry();
	let calls = 0;
	await expect(
		ledger.run(
			"cancelled-before",
			"mutation",
			async () => {
				calls++;
				return {};
			},
			() => true,
		),
	).rejects.toThrow("cancelled before execution");
	expect(calls).toBe(0);
});
test("collector failure after execution never retries or hides the uncertain evidence", async () => {
	let records = 0;
	let calls = 0;
	const ledger = new VoiceToolRetry(async () => {
		if (++records === 2) throw new Error("collector failed");
	});
	await expect(
		ledger.run("effect", "mutation", async () => {
			calls++;
			return {};
		}),
	).rejects.toThrow("collector failed");
	expect(calls).toBe(1);
});

test("restored spent retry never executes a second read attempt", async () => {
	const ledger = new VoiceToolRetry(async () => {}, true);
	let attempts = 0;
	await ledger.run("new-read", "readOnly", async () => {
		attempts++;
		return { isError: true, details: { status: 503 } };
	});
	expect(attempts).toBe(1);
});

test("restored uncertain mutation cannot replay under the same operation identity", async () => {
	const ledger = new VoiceToolRetry(async () => {}, false, [
		{ id: "mutation-signature", effect: "mutation", outcome: "pending" },
	]);
	let calls = 0;
	await expect(
		ledger.run("mutation-signature", "mutation", async () => {
			calls++;
			return {};
		}),
	).rejects.toThrow("already admitted");
	expect(calls).toBe(0);
});

test("a deliberate fresh read can use the same resource arguments", async () => {
	const ledger = new VoiceToolRetry();
	let reads = 0;
	await ledger.run("read-signature", "readOnly", async () => {
		reads++;
		return {};
	});
	await ledger.run("read-signature", "readOnly", async () => {
		reads++;
		return {};
	});
	expect(reads).toBe(2);
});

test("permanent and unclassified read errors never consume retries", async () => {
	const ledger = new VoiceToolRetry();
	let calls = 0;
	for (const details of [{ status: 403 }, { status: 404 }, {}])
		await ledger.run(JSON.stringify(details), "readOnly", async () => {
			calls++;
			return { isError: true, details };
		});
	expect(calls).toBe(3);
});
test("target change after transient read failure prevents retry", async () => {
	const ledger = new VoiceToolRetry();
	let calls = 0;
	let current = true;
	await ledger.run(
		"changed",
		"readOnly",
		async () => {
			calls++;
			current = false;
			return { isError: true, details: { status: 503 } };
		},
		() => false,
		() => current,
	);
	expect(calls).toBe(1);
});

test("target change while retry reservation persists prevents second invocation", async () => {
	let current = true;
	let calls = 0;
	const ledger = new VoiceToolRetry(async record => {
		if (record.kind === "voiceRetryReserved") current = false;
	});
	await ledger.run(
		"read",
		"readOnly",
		async () => {
			calls++;
			return { isError: true, details: { status: 503 } };
		},
		() => false,
		() => current,
	);
	expect(calls).toBe(1);
});

test("target change during reservation preserves original thrown read failure", async () => {
	let current = true;
	let calls = 0;
	const ledger = new VoiceToolRetry(async record => {
		if (record.kind === "voiceRetryReserved") current = false;
	});
	await expect(
		ledger.run(
			"thrown",
			"readOnly",
			async () => {
				calls++;
				throw Object.assign(new Error("original failure"), { code: "EIO" });
			},
			() => false,
			() => current,
		),
	).rejects.toThrow("original failure");
	expect(calls).toBe(1);
});

test("target change while admission persists prevents first mutation", async () => {
	let current = true;
	let calls = 0;
	const ledger = new VoiceToolRetry(async record => {
		if (record.kind === "voiceOperation" && record.outcome === "pending") current = false;
	});
	await expect(
		ledger.run(
			"mutation",
			"mutation",
			async () => {
				calls++;
				return {};
			},
			() => false,
			() => current,
		),
	).rejects.toThrow();
	expect(calls).toBe(0);
});

test.each(["mutation", "unknown"] as const)(
	"returned %s errors retain unknown outcomes without replay",
	async effect => {
		const records: Record<string, unknown>[] = [];
		const ledger = new VoiceToolRetry(async record => {
			records.push(record);
		});
		let calls = 0;
		const result = await ledger.run("response-lost", effect, async () => {
			calls++;
			return { isError: true, details: { status: 0 } };
		});
		expect(result.isError).toBe(true);
		expect(calls).toBe(1);
		expect(ledger.operations()).toEqual([{ id: "response-lost", effect, outcome: "unknown" }]);
		expect(records.at(-1)).toMatchObject({ id: "response-lost", effect, outcome: "unknown" });
		await expect(
			ledger.run("response-lost", effect, async () => {
				calls++;
				return {};
			}),
		).rejects.toThrow("already admitted");
		expect(calls).toBe(1);
	},
);

test("structured unknown command failure retains execution evidence without permitting replay", async () => {
	const ledger = new VoiceToolRetry();
	const details = {
		execution: {
			kind: "command",
			command: "example-read-command",
			cwd: "/example/project",
			status: "failed",
			exitCode: 1,
			aggregatedOutput: "Optional setting is absent",
		},
	};
	const original = new ToolError("Command exited with code 1", undefined, details);
	let attempts = 0;
	let caught: unknown;
	try {
		await ledger.run("structured-command", "unknown", async () => {
			attempts++;
			throw original;
		});
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(AgentToolError);
	const failed = caught as AgentToolError;
	expect(failed.result.details).toEqual(details);
	expect(failed.result.content).toEqual([
		{ type: "text", text: "Command exited with code 1" },
		{
			type: "text",
			text: "The operation outcome is uncertain. Reconcile authoritative task or resource state before retrying.",
		},
	]);
	expect(attempts).toBe(1);
	expect(ledger.operations()).toEqual([{ id: "structured-command", effect: "unknown", outcome: "unknown" }]);
	await expect(ledger.run("structured-command", "unknown", async () => ({}))).rejects.toThrow("already admitted");
});

test("structured mutation failure preserves payload while retaining uncertain effects", async () => {
	const ledger = new VoiceToolRetry();
	const original = new AgentToolError("Provider response unavailable", {
		content: [{ type: "text", text: "Provider response unavailable" }],
		details: { status: 0, requestId: "example-request" },
	});
	let attempts = 0;
	let caught: unknown;
	try {
		await ledger.run("structured-mutation", "mutation", async () => {
			attempts++;
			throw original;
		});
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(AgentToolError);
	expect((caught as AgentToolError).result.details).toEqual(original.result.details);
	expect((caught as Error).message).toContain("outcome is uncertain");
	expect(attempts).toBe(1);
	expect(ledger.operations()).toEqual([{ id: "structured-mutation", effect: "mutation", outcome: "unknown" }]);
});
