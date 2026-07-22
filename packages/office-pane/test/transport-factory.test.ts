import { describe, expect, test } from "bun:test";
import type { ConfigurableTransport, GatewayConfig, ProviderConfigure } from "../src/core";
import type { OfficeHost } from "../src/office/host-adapter";
import { makeBuildTransport } from "../src/office/transport-factory";

const CONFIG: GatewayConfig = { baseUrl: "https://gw/anthropic", token: "t", model: "m" };

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
	test("provision() configures xcsh's provider with the saved config, resolving on ack", async () => {
		const stub = makeStub();
		const built = build("Excel", stub);
		await built.provision?.();
		expect(stub.calls).toEqual(["configure"]);
		expect(stub.config()).toEqual({ baseUrl: "https://gw/anthropic", token: "t", model: "m" });
	});

	test("provision runs BEFORE host tools are advertised (the panel sequences provision → onConnected)", async () => {
		const stub = makeStub();
		const built = build("Word", stub);
		// The panel awaits provision() then calls onConnected(); replicate that order here.
		await built.provision?.();
		built.onConnected?.();
		expect(stub.calls).toEqual(["configure", "advertise"]);
	});

	test("a rejected configure PROPAGATES from provision() (not swallowed) so the panel can surface it", async () => {
		const stub = makeStub({ configureRejects: true });
		const built = build("Word", stub);
		expect(built.provision).toBeDefined();
		await expect(built.provision?.()).rejects.toThrow(/configure_error/);
		// Host tools are NOT advertised as a side effect of provision failing.
		expect(stub.calls).toEqual(["configure"]);
	});

	test("provision is undefined when the bridge did not advertise the capability (xcsh keeps its default)", () => {
		const stub = makeStub({ canConfigure: false });
		const built = build("PowerPoint", stub);
		expect(built.provision).toBeUndefined();
	});

	test("onConnected advertises the host-appropriate document tools", () => {
		const stub = makeStub();
		build("Excel", stub).onConnected?.();
		expect(stub.calls).toEqual(["advertise"]);
	});

	test("passes the created transport straight through as the built transport", () => {
		const stub = makeStub();
		const built = build("Excel", stub);
		expect(built.transport).toBe(stub.transport);
	});

	test("a NULL config (chat-first default) builds a transport with NO provision (uses xcsh's provider)", () => {
		const stub = makeStub();
		const built = makeBuildTransport("Excel", {
			createTransport: () => stub.transport,
			wireHostTools: () => ({ onConnected: () => stub.calls.push("advertise") }),
		})(null);
		expect(built.transport).toBe(stub.transport);
		expect(built.provision).toBeUndefined();
		// Host tools are still advertised on connect.
		built.onConnected?.();
		expect(stub.calls).toEqual(["advertise"]);
	});
});
