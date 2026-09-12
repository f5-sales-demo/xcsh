const encoder = new TextEncoder();
const decoder = new TextDecoder();
let buffer = "";

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
		if (request.id == null) continue;
		if (request.method === "initialize") {
			await Bun.sleep(500);
			await reply({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					protocolVersion: "2025-03-26",
					capabilities: { tools: {} },
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
		} else {
			await reply({ jsonrpc: "2.0", id: request.id, result: {} });
		}
	}
}
