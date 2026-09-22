import { describe, expect, it, vi } from "bun:test";
import { HerdrProtocolError } from "../src/herdr/client";
import { HERDR_SEMANTIC_REPORT_TIMEOUT_MS, requestSemanticReport } from "../src/herdr/semantic-report";

describe("Herdr semantic report retry", () => {
	it("uses a five-second per-attempt deadline", () => {
		expect(HERDR_SEMANTIC_REPORT_TIMEOUT_MS).toBe(5_000);
	});

	it.each(["timeout", "eof", "transport_error"])(
		"retries one %s ambiguity with the same method and params",
		async code => {
			const params = {
				execution_id: "execution-1",
				generation: 7,
				turn_id: "turn-1",
				event_revision: 3,
				native_capability: "private-capability",
			};
			const request = vi
				.fn()
				.mockRejectedValueOnce(new HerdrProtocolError("ambiguous", code))
				.mockResolvedValueOnce({ type: "agent_turn", admitted: false });

			await expect(requestSemanticReport({ request }, "agent.turn.report", params)).resolves.toMatchObject({
				type: "agent_turn",
			});
			expect(request).toHaveBeenCalledTimes(2);
			expect(request.mock.calls).toEqual([
				["agent.turn.report", params],
				["agent.turn.report", params],
			]);
		},
	);

	it.each(["protocol_mismatch", "invalid_json", "protocol_error", "response_too_large", "stale_generation"])(
		"does not retry %s failures",
		async code => {
			const failure = new HerdrProtocolError("definitive", code);
			const request = vi.fn().mockRejectedValue(failure);
			await expect(requestSemanticReport({ request }, "agent.turn.report", { event_revision: 1 })).rejects.toBe(
				failure,
			);
			expect(request).toHaveBeenCalledTimes(1);
		},
	);
});
