import { describe, expect, test } from "bun:test";
import type { ConfigurableTransport, GatewayConfig, ProviderConfigure } from "../src/core";
import type { OfficeHost } from "../src/office/host-adapter";
import { makeBuildTransport } from "../src/office/transport-factory";

const CONFIG: GatewayConfig = { baseUrl: "https://gw/anthropic", token: "t", model: "m" };

/** Flush the async on-connect IIFE (a macrotask tick). */
const tick = (): Promise<void> => new Promise(r => setTimeout(r, 0));

/**
 * A ConfigurableTransport stub that records a shared call-order log (so ordering
 * vs. host-tool advertisement is observable) and the config it was given.
 */
function makeStub(opts: { canConfigure?: boolean; configureRejects?: boolean } = {}) {
	const calls: string[] = [];
	let received: ProviderConfigure | undefined;
	const transport: ConfigurableTransport = {
		state: "open",
		canConfigureProvider: opts.canConfigure ?? true,
		connect: () => Promise.resolve(),
		send: () => {},
		onMessage: () => () => {},
		stop: () => {},
		dispose: () => {},
		configure: (c: ProviderConfigure) => {
			calls.push("configure");
			received = c;
			return opts.configureRejects ? Promise.reject(new Error("configure_error")) : Promise.resolve("model-x");
		},
	};
	return { transport, calls, config: () => received };
}

function build(host: OfficeHost, stub: ReturnType<typeof makeStub>) {
	return makeBuildTransport(host, {
		createTransport: () => stub.transport,
		wireHostTools: () => ({ onConnected: () => stub.calls.push("advertise") }),
	})(CONFIG);
}

describe("makeBuildTransport", () => {
	test("configure() runs BEFORE host tools are advertised, with the saved config", async () => {
		const stub = makeStub();
		build("Excel", stub).onConnected?.();
		await tick();
		expect(stub.calls).toEqual(["configure", "advertise"]);
		expect(stub.config()).toEqual({ baseUrl: "https://gw/anthropic", token: "t", model: "m" });
	});

	test("a rejected configure() still advertises host tools (degrade, don't silently break)", async () => {
		const stub = makeStub({ configureRejects: true });
		build("Word", stub).onConnected?.();
		await tick();
		expect(stub.calls).toEqual(["configure", "advertise"]);
	});

	test("skips configure() when the bridge did not advertise the capability", async () => {
		const stub = makeStub({ canConfigure: false });
		build("PowerPoint", stub).onConnected?.();
		await tick();
		expect(stub.calls).toEqual(["advertise"]);
	});

	test("passes the created transport straight through as the built transport", () => {
		const stub = makeStub();
		const built = build("Excel", stub);
		expect(built.transport).toBe(stub.transport);
	});
});
