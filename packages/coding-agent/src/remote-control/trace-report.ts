/** Inventory is evidence for review, never a substitute for scenario acceptance. */
export function inventoryProtocolTrace(rows: readonly Record<string, any>[]) {
	const signals = new Map<string, number>();
	const pending = new Map<string, { method: string; direction: string; elapsedMs: number }>();
	const requests: Record<string, unknown>[] = [];
	let uncorrelatedResponses = 0;
	for (const row of rows) {
		if (row.kind !== "event") continue;
		const message = row.message;
		if (!message || typeof message !== "object") continue;
		const name =
			typeof message.method === "string"
				? message.method
				: typeof message.type === "string"
					? message.type
					: "error" in message
						? "error"
						: "result" in message
							? "result"
							: "unclassified";
		const signal = `${row.layer}/${row.direction}/${name}`;
		signals.set(signal, (signals.get(signal) ?? 0) + 1);
		if (row.layer !== "rpc" || message.id == null) continue;
		const id = JSON.stringify(message.id);
		if (typeof message.method === "string") {
			pending.set(`${row.direction}/${id}`, {
				method: message.method,
				direction: row.direction,
				elapsedMs: row.elapsedMs,
			});
		} else if ("result" in message || "error" in message) {
			const key = `${row.direction === "in" ? "out" : "in"}/${id}`;
			const request = pending.get(key);
			if (!request) {
				uncorrelatedResponses++;
				continue;
			}
			pending.delete(key);
			requests.push({
				method: request.method,
				direction: request.direction,
				latencyMs: row.elapsedMs - request.elapsedMs,
				...("error" in message
					? { outcome: "error", errorCode: message.error?.code }
					: {
							outcome: "result",
							resultKeys:
								message.result && typeof message.result === "object" ? Object.keys(message.result).sort() : [],
						}),
			});
		}
	}
	return {
		signals: Object.fromEntries([...signals].sort(([a], [b]) => a.localeCompare(b))),
		requests,
		unanswered: [...pending.values()].map(({ method, direction }) => ({ method, direction })),
		uncorrelatedResponses,
	};
}
