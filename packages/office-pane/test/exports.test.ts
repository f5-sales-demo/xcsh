/**
 * Regression guard: verify the office-pane core public API is re-exported from
 * `src/core/index.ts`.  A missing re-export will cause a TypeScript / module
 * error here.
 */

import { describe, expect, test } from "bun:test";
import type {
	// protocol — message types
	ChatDeltaMsg,
	ChatDoneMsg,
	ChatErrorMsg,
	ChatErrorReason,
	ChatInbound,
	ChatInboundMsg,
	ChatKeepaliveMsg,
	// transport — types
	ChatOutbound,
	ChatRefWire,
	ChatRequestMsg,
	ChatStopMsg,
	ChatStreamMsg,
	ChatToolNoticeMsg,
	ConfigurableTransport,
	ConfigureMsg,
	GatewayConfig,
	InteractionMode,
	LoopbackBridgeOptions,
	ProviderConfigure,
	Transport,
	TurnState,
	WebSocketFactory,
} from "../src/core";
import {
	// protocol — constants
	CHAT_ERROR_REASONS,
	// version
	CORE_CONTRACT_VERSION,
	// gateway config
	GatewayConfigError,
	INTERACTION_MODES,
	// protocol — reducers
	initTurn,
	// protocol — guards
	isChatDelta,
	isChatDone,
	isChatError,
	isChatKeepalive,
	isChatToolNotice,
	isConfigureAck,
	isConfigureError,
	LoopbackBridgeTransport,
	MemoryGatewayConfigStore,
	// transport — concrete classes
	MockTransport,
	normalizeGatewayConfig,
	reduceChatTurn,
} from "../src/core";

// Compile-time only: if any type is missing the import above fails tsc.
// Use them in a single `satisfies` expression so noUnusedLocals is happy.
const _typeCheck = (
	_a: ChatDeltaMsg | undefined,
	_b: ChatDoneMsg | undefined,
	_c: ChatErrorMsg | undefined,
	_d: ChatErrorReason | undefined,
	_e: ChatInbound | undefined,
	_f: ChatInboundMsg | undefined,
	_g: ChatKeepaliveMsg | undefined,
	_h: ChatOutbound | undefined,
	_i: ChatRefWire | undefined,
	_j: ChatRequestMsg | undefined,
	_k: ChatStopMsg | undefined,
	_l: ChatStreamMsg | undefined,
	_m: ChatToolNoticeMsg | undefined,
	_n: InteractionMode | undefined,
	_o: LoopbackBridgeOptions | undefined,
	_p: Transport | undefined,
	_q: TurnState | undefined,
	_r: WebSocketFactory | undefined,
	_s: ConfigureMsg | undefined,
	_t: ConfigurableTransport | undefined,
	_u: ProviderConfigure | undefined,
	_v: GatewayConfig | undefined,
): void => undefined;
// Suppress unused-variable warning for the function itself.
void _typeCheck;

describe("core public API exports (src/core/index.ts)", () => {
	test("CORE_CONTRACT_VERSION is a non-empty string", () => {
		expect(typeof CORE_CONTRACT_VERSION).toBe("string");
		expect(CORE_CONTRACT_VERSION.length).toBeGreaterThan(0);
	});

	test("CHAT_ERROR_REASONS is a non-empty array", () => {
		expect(Array.isArray(CHAT_ERROR_REASONS)).toBe(true);
		expect(CHAT_ERROR_REASONS.length).toBeGreaterThan(0);
	});

	test("gateway config + configure guards are exported and functional", () => {
		expect(typeof normalizeGatewayConfig).toBe("function");
		expect(typeof GatewayConfigError).toBe("function");
		expect(typeof isConfigureAck).toBe("function");
		expect(typeof isConfigureError).toBe("function");
		expect(new MemoryGatewayConfigStore().load()).toBeNull();
	});

	test("INTERACTION_MODES is a non-empty array", () => {
		expect(Array.isArray(INTERACTION_MODES)).toBe(true);
		expect(INTERACTION_MODES.length).toBeGreaterThan(0);
	});

	test("initTurn returns a TurnState with id and streaming status", () => {
		const turn = initTurn("t1");
		expect(turn.id).toBe("t1");
		expect(turn.status).toBe("streaming");
	});

	test("reduceChatTurn is a function", () => {
		expect(typeof reduceChatTurn).toBe("function");
	});

	test("type guards are functions", () => {
		expect(typeof isChatDelta).toBe("function");
		expect(typeof isChatDone).toBe("function");
		expect(typeof isChatError).toBe("function");
		expect(typeof isChatKeepalive).toBe("function");
		expect(typeof isChatToolNotice).toBe("function");
	});

	test("MockTransport can be instantiated and starts idle", () => {
		const t = new MockTransport();
		expect(t.state).toBe("idle");
	});

	test("LoopbackBridgeTransport can be instantiated and starts idle", () => {
		const t = new LoopbackBridgeTransport({ port: 19222 });
		expect(t.state).toBe("idle");
	});
});
