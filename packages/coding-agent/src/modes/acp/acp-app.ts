import { type AgentConnection, agent, RequestError, type Stream } from "@agentclientprotocol/sdk/unstable";
import type { AgentSession } from "../../session/agent-session";
import { AcpAgent, type AcpMediaReadRequest } from "./acp-agent";

function parseMediaReadRequest(params: unknown): AcpMediaReadRequest {
	if (
		typeof params !== "object" ||
		params === null ||
		Array.isArray(params) ||
		!("sessionId" in params) ||
		typeof params.sessionId !== "string" ||
		!("ref" in params) ||
		typeof params.ref !== "string"
	) {
		throw RequestError.invalidParams({ method: "_xcsh/media/read" });
	}
	const offset = "offset" in params ? params.offset : undefined;
	const length = "length" in params ? params.length : undefined;
	for (const value of [offset, length]) {
		if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
			throw RequestError.invalidParams({ method: "_xcsh/media/read" });
		}
	}
	return {
		sessionId: params.sessionId,
		ref: params.ref,
		offset: typeof offset === "number" ? offset : undefined,
		length: typeof length === "number" ? length : undefined,
	};
}

/** Each transport owns one app and its session registry. Fork remains an explicit ACP v1 unstable capability. */
export function connectAcpAgent(
	transport: Stream,
	initialSession: AgentSession,
	createSession: (cwd: string) => Promise<AgentSession>,
): AgentConnection {
	let engine: AcpAgent | undefined;
	const current = (): AcpAgent => {
		if (!engine) throw new Error("ACP transport has not connected");
		return engine;
	};
	const connection: AgentConnection = agent({ name: "xcsh" })
		.onConnect(connection => {
			engine = new AcpAgent(connection, initialSession, createSession);
		})
		.onRequest("initialize", ({ params }) => current().initialize(params))
		.onRequest("authenticate", ({ params }) => current().authenticate(params))
		.onRequest("session/new", ({ params }) => current().newSession(params))
		.onRequest("session/load", ({ params }) => current().loadSession(params))
		.onRequest("session/list", ({ params }) => current().listSessions(params))
		.onRequest("session/resume", ({ params }) => current().resumeSession(params))
		.onRequest("session/fork", ({ params }) => current().forkSession(params))
		.onRequest("session/close", ({ params }) => current().closeSession(params))
		.onRequest("session/set_mode", ({ params }) => current().setSessionMode(params))
		.onRequest("session/set_config_option", ({ params }) => current().setSessionConfigOption(params))
		.onRequest("session/prompt", async ({ params, signal, requestId }) => {
			const owner = current();
			if (signal.aborted) throw RequestError.requestCancelled({ requestId });
			const cancel = () => {
				if (owner.signal.aborted) return;
				void owner.cancel(params).catch(error => connection.close(error));
			};
			signal.addEventListener("abort", cancel, { once: true });
			try {
				return await owner.prompt(params);
			} finally {
				signal.removeEventListener("abort", cancel);
			}
		})
		.onNotification("session/cancel", ({ params }) => current().cancel(params))
		.onRequest("_xcsh/media/read", parseMediaReadRequest, ({ params }) => current().readMedia(params))
		.connect(transport);
	return {
		client: connection.client,
		signal: connection.signal,
		close: error => connection.close(error),
		closed: current().closed,
	};
}
