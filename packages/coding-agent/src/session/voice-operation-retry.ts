export type Effect = "readOnly" | "mutation" | "unknown";
export type Outcome = "pending" | "completed" | "failed" | "unknown";
export class VoiceOperationRetry {
	#spent = false;
	constructor(spent = false, restored: { id: string; effect: Effect; outcome: Outcome }[] = []) {
		this.#spent = spent;
		for (const operation of restored)
			this.#operations.set(operation.id, {
				...operation,
				outcome: operation.outcome === "pending" ? "unknown" : operation.outcome,
			});
	}
	#operations = new Map<string, { id: string; effect: Effect; outcome: Outcome }>();
	begin(id: string, effect: Effect): void {
		if (this.#operations.has(id) && effect !== "readOnly") throw new Error("Duplicate operation identity");
		this.#operations.set(id, { id, effect, outcome: "pending" });
	}
	settle(id: string, outcome: Outcome): void {
		const op = this.#operations.get(id);
		if (!op) throw new Error("Unknown operation identity");
		op.outcome = outcome;
	}
	retry(id: string): boolean {
		const op = this.#operations.get(id);
		if (this.#spent || !op || op.effect !== "readOnly" || op.outcome !== "failed") return false;
		this.#spent = true;
		op.outcome = "pending";
		return true;
	}
	snapshot() {
		return [...this.#operations.values()].map(op => ({ ...op }));
	}
}

export function canonicalVoiceArguments(value: unknown): string {
	if (Array.isArray(value)) return "[" + value.map(canonicalVoiceArguments).join(",") + "]";
	if (value && typeof value === "object")
		return (
			"{" +
			Object.entries(value)
				.filter(([, item]) => item !== undefined)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, item]) => JSON.stringify(key) + ":" + canonicalVoiceArguments(item))
				.join(",") +
			"}"
		);
	return JSON.stringify(value) ?? "null";
}
