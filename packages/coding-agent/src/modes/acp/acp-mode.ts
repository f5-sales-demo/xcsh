import * as stream from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk/unstable";
import type { AgentSession } from "../../session/agent-session";
import { connectAcpAgent } from "./acp-app";

export type AcpSessionFactory = (cwd: string) => Promise<AgentSession>;

export async function runAcpMode(session: AgentSession, createSession: AcpSessionFactory): Promise<never> {
	const input = stream.Writable.toWeb(process.stdout);
	const output = stream.Readable.toWeb(process.stdin);
	const transport = ndJsonStream(input, output);
	const connection = connectAcpAgent(transport, session, createSession);
	await connection.closed;
	process.exit(0);
}
