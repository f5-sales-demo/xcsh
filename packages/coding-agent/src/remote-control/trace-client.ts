/** Select one relay client before comparing RPC delivery counts. No deduplication. */
export function clientProtocolEvents(rows: readonly Record<string, any>[], client: { $ref: string }) {
	if (!client || typeof client.$ref !== "string") throw new Error("A captured client reference is required");
	const events: Record<string, any>[] = [];
	let unresolvedChunks = 0;
	for (const row of rows) {
		if (row.kind !== "event" || row.layer !== "relay" || row.message?.client_id?.$ref !== client.$ref) continue;
		const frame = row.message;
		if (["client_message_chunk", "server_message_chunk"].includes(frame.type)) {
			unresolvedChunks++;
			continue;
		}
		if (!["client_message", "server_message"].includes(frame.type) || !frame.message) continue;
		events.push({
			kind: "event",
			sourceSequence: row.sequence,
			elapsedMs: row.elapsedMs,
			layer: "rpc",
			direction: row.direction,
			route: { clientId: frame.client_id, streamId: frame.stream_id },
			message: frame.message,
		});
	}
	return { events, unresolvedChunks };
}
