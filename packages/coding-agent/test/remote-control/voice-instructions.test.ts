import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import { convertToLlm } from "../../src/session/messages";

const params = {
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
	realtimeStartInstructions: "Start fixture",
	realtimeEndInstructions: "End fixture",
};
const transports = [
	{ type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	{ type: "existingCall", callId: "fixture-call" },
];
function fixture() {
	const instructions: string[] = [],
		sent: any[] = [],
		events: string[] = [];
	let authenticated = 0;
	const deps: VoiceDependencies = {
		authenticate: async () => {
			authenticated++;
			return { accessToken: "fixture-key", accountId: "example-voice-account" };
		},
		createCall: async () => ({ callId: "fixture-call", sdp: "v=0\r\nfixture-answer" }),
		open: async () => ({ send: data => sent.push(JSON.parse(data)), close: () => {}, bufferedAmount: 0 }),
		modeChanged: async (active, options) => {
			const phase = active ? "start" : "end",
				text = options[phase];
			instructions.push(`${phase}:${text}`);
		},
		emit: method => {
			events.push(method);
		},
		record: async () => {},
		records: () => [],
		delegate: async () => "",
	};
	return { voice: new NativeVoice(deps), deps, instructions, sent, events, authenticated: () => authenticated };
}

test.each(transports)("$type accepts backing instructions and applies them after attachment", async transport => {
	const f = fixture();
	const open = f.deps.open!;
	f.deps.open = async (...args) => {
		expect(f.instructions).toEqual([]);
		return open(...args);
	};
	await f.voice.start({ ...params, transport });
	expect(f.instructions).toEqual(["start:Start fixture"]);
	await f.voice.stop();
	expect(f.instructions).toEqual(["start:Start fixture", "end:End fixture"]);
	if (transport.type === "existingCall") expect(f.sent.some(frame => frame.type === "session.update")).toBe(false);
});

test.each(transports)("$type reports mode changes even without custom instructions", async transport => {
	const f = fixture();
	const modes: unknown[] = [];
	f.deps.modeChanged = async (active, instructions) => {
		modes.push([active, instructions]);
	};
	await f.voice.start({ version: "v3", outputModality: "audio", includeStartupContext: false, transport });
	await f.voice.stop();
	expect(modes).toEqual([
		[true, { start: undefined, end: undefined }],
		[false, { start: undefined, end: undefined }],
	]);
});

test("mode initialization supplies both overrides and owns a copy", async () => {
	const f = fixture();
	const modes: unknown[] = [];
	f.deps.modeChanged = async (active, instructions) => {
		modes.push([active, { ...instructions }]);
		instructions.end = "callback mutation";
	};
	await f.voice.start({ ...params, transport: transports[1] });
	await f.voice.stop();
	expect(modes).toEqual([
		[true, { start: "Start fixture", end: "End fixture" }],
		[false, { start: "Start fixture", end: "End fixture" }],
	]);
});

test("failed sideband attachment does not apply backing mode instructions", async () => {
	const f = fixture();
	f.deps.open = async () => {
		throw new Error("fixture upgrade rejected");
	};
	await expect(f.voice.start({ ...params, transport: transports[0] })).rejects.toThrow();
	await f.voice.stop();
	expect(f.instructions).toEqual([]);
});

test.each(transports)("$type validates instruction types and bounds before authentication", async transport => {
	for (const field of ["realtimeStartInstructions", "realtimeEndInstructions"])
		for (const value of [42, false, "a".repeat(32769), "🌳".repeat(8193)]) {
			const f = fixture();
			await expect(f.voice.start({ ...params, transport, [field]: value })).rejects.toThrow();
			expect(f.authenticated()).toBe(0);
		}
});

test.each(transports)("$type accepts the exact UTF-8 instruction bound", async transport => {
	const f = fixture();
	const text = "🌳".repeat(8192);
	await f.voice.start({ ...params, transport, realtimeStartInstructions: text, realtimeEndInstructions: text });
	await f.voice.stop();
	expect(f.instructions).toEqual([`start:${text}`, `end:${text}`]);
});

test("stop during connection diagnostics cannot report a successful start afterward", async () => {
	const f = fixture();
	const reached = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	f.deps.record = async record => {
		if (record.kind === "voiceDiagnostic" && record.connected === true) {
			reached.resolve();
			await release.promise;
		}
	};
	const starting = f.voice.start({ ...params, transport: transports[1] });
	const result = starting.then(
		() => "opened",
		() => "stopped",
	);
	await reached.promise;
	await f.voice.stop();
	release.resolve();
	expect(await result).toBe("stopped");
	expect(f.voice.active).toBe(false);
	expect(f.instructions).toEqual(["start:Start fixture", "end:End fixture"]);
	expect(f.events.filter(method => method === "thread/realtime/closed")).toHaveLength(1);
});

test("stop drains end instructions before announcing closure", async () => {
	const f = fixture();
	const end = Promise.withResolvers<void>();
	f.deps.modeChanged = async (active, options) => {
		const phase = active ? "start" : "end",
			text = options[phase];
		f.instructions.push(`${phase}:${text}`);
		if (phase === "end") await end.promise;
	};
	await f.voice.start({ ...params, transport: transports[0] });
	const closing = f.voice.stop();
	let closed = false;
	void closing.then(() => {
		closed = true;
	});
	try {
		await Bun.sleep(0);
		expect(closed).toBe(false);
		expect(f.events).not.toContain("thread/realtime/closed");
	} finally {
		end.resolve();
		await closing;
	}
	await f.voice.stop();
	expect(f.instructions).toEqual(["start:Start fixture", "end:End fixture"]);
});

test("stop during start instructions serializes the end update and cannot reopen voice", async () => {
	const f = fixture();
	const started = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	f.deps.modeChanged = async (active, options) => {
		const phase = active ? "start" : "end",
			text = options[phase];
		if (phase === "start") {
			started.resolve();
			await release.promise;
		}
		f.instructions.push(`${phase}:${text}`);
	};
	const starting = f.voice.start({ ...params, transport: transports[0] });
	const result = starting.then(
		() => "opened",
		() => "stopped",
	);
	await started.promise;
	const closing = f.voice.stop();
	release.resolve();
	await closing;
	expect(await result).toBe("stopped");
	expect(f.instructions).toEqual(["start:Start fixture", "end:End fixture"]);
	expect(f.voice.active).toBe(false);
});

test("backing voice mode instructions retain developer priority", () => {
	for (const phase of ["start", "end"]) {
		const messages = convertToLlm([
			{
				role: "custom",
				customType: `remote-voice-${phase}`,
				content: "Fixture instructions",
				display: false,
				timestamp: 1,
			},
		]);
		expect(messages[0]).toMatchObject({
			role: "developer",
			content: [{ type: "text", text: "Fixture instructions" }],
		});
	}
});

test.each(["v1", "v3"])("explicit empty %s mode overrides are retained", async version => {
	const f = fixture();
	await f.voice.start({
		...params,
		version,
		transport: transports[1],
		realtimeStartInstructions: "",
		realtimeEndInstructions: "",
	});
	await f.voice.stop();
	expect(f.instructions).toEqual(["start:", "end:"]);
});

test("a rejected start instruction update drains its cleanup before closure", async () => {
	const f = fixture();
	f.deps.modeChanged = async (active, options) => {
		const phase = active ? "start" : "end",
			text = options[phase];
		f.instructions.push(`${phase}:${text}`);
		if (phase === "start") throw new Error("fixture instruction write rejected");
	};
	await expect(f.voice.start({ ...params, transport: transports[0] })).rejects.toThrow(
		"Native realtime connection failed",
	);
	await f.voice.stop();
	expect(f.instructions).toEqual(["start:Start fixture", "end:End fixture"]);
	expect(f.voice.active).toBe(false);
	expect(f.events.filter(method => method === "thread/realtime/closed")).toHaveLength(1);
});

test("a rejected end instruction update reports failure and still closes once", async () => {
	const f = fixture();
	f.deps.modeChanged = async active => {
		const phase = active ? "start" : "end";
		if (phase === "end") throw new Error("fixture instruction write rejected");
	};
	await f.voice.start({ ...params, transport: transports[1] });
	await f.voice.stop();
	await f.voice.stop();
	expect(f.voice.active).toBe(false);
	expect(f.events.filter(method => method === "thread/realtime/error")).toHaveLength(1);
	expect(f.events.filter(method => method === "thread/realtime/closed")).toHaveLength(1);
});
