import { appendFileSync } from "node:fs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let buffer = "";
const eventsPath = process.env.XCSH_MCP_TEST_EVENTS;
const record = event => {
	if (eventsPath) appendFileSync(eventsPath, `${event}\n`);
};

record(`start:${process.pid}`);
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		record(`${signal.toLowerCase()}:${process.pid}`);
		process.exit(0);
	});
}

const reply = response => Bun.stdout.write(encoder.encode(`${JSON.stringify(response)}\n`));

for await (const chunk of Bun.stdin.stream()) {
	buffer += decoder.decode(chunk, { stream: true });
	for (;;) {
		const newline = buffer.indexOf("\n");
		if (newline < 0) break;
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		const request = JSON.parse(line);
		record(`request:${request.method ?? "response"}`);
		if (request.id == null) continue;
		if (request.method === "initialize") {
			await Bun.sleep(500);
			await reply({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					protocolVersion: "2025-03-26",
					capabilities: {
						tools: { listChanged: true },
						prompts: { listChanged: true },
						resources: { listChanged: true, subscribe: true },
					},
					instructions: "Synthetic MCP server instruction",
					serverInfo: { name: "xcsh-terminal-uat", version: "1.0.0" },
				},
			});
		} else if (request.method === "tools/list") {
			await reply({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					tools: [
						{
							name: "synthetic_read",
							description: "Read only the disposable terminal fixture",
							inputSchema: { type: "object", properties: {} },
						},
					],
				},
			});
		} else if (request.method === "prompts/list") {
			await reply({
				jsonrpc: "2.0",
				id: request.id,
				result: { prompts: [{ name: "synthetic_prompt", description: "Synthetic prompt" }] },
			});
		} else if (request.method === "resources/list") {
			await reply({
				jsonrpc: "2.0",
				id: request.id,
				result: { resources: [{ uri: "fixture://value", name: "Synthetic resource", mimeType: "text/plain" }] },
			});
		} else if (request.method === "resources/templates/list") {
			await reply({ jsonrpc: "2.0", id: request.id, result: { resourceTemplates: [] } });
		} else if (request.method === "resources/read") {
			await reply({ jsonrpc: "2.0", id: request.id, result: { contents: [{ uri: request.params.uri, text: "fixture" }] } });
		} else {
			await reply({ jsonrpc: "2.0", id: request.id, result: {} });
		}
	}
}

record(`eof:${process.pid}`);
