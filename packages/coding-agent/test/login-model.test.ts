import { describe, expect, it, vi } from "bun:test";
import { applyModelAfterLogin } from "@f5-sales-demo/xcsh/modes/controllers/login-model";

function makeSession(opts: { model?: { id: string; provider: string }; models: { id: string; provider: string }[] }) {
	const setModel = vi.fn(async (_model: { id: string; provider: string }, _role: string, _opts?: unknown) => {});
	const session = {
		model: opts.model,
		modelRegistry: { getAll: () => opts.models },
		setModel,
	};
	return { session, setModel };
}
const M = (id: string, provider = "litellm") => ({ id, provider });

describe("applyModelAfterLogin", () => {
	it("sets the session model when none is configured and the id resolves", async () => {
		const { session, setModel } = makeSession({ model: undefined, models: [M("claude-opus-4")] });
		const applied = await applyModelAfterLogin(session as never, "claude-opus-4");
		expect(applied).toBe(true);
		expect(setModel).toHaveBeenCalledTimes(1);
		expect(setModel.mock.calls[0][0]).toMatchObject({ id: "claude-opus-4" });
		expect(setModel.mock.calls[0][1]).toBe("default");
	});

	it("does not override an already-configured session model", async () => {
		const { session, setModel } = makeSession({ model: M("existing"), models: [M("claude-opus-4")] });
		const applied = await applyModelAfterLogin(session as never, "claude-opus-4");
		expect(applied).toBe(false);
		expect(setModel).not.toHaveBeenCalled();
	});

	it("returns false when the selected id is not in the registry", async () => {
		const { session, setModel } = makeSession({ model: undefined, models: [M("other")] });
		const applied = await applyModelAfterLogin(session as never, "claude-opus-4");
		expect(applied).toBe(false);
		expect(setModel).not.toHaveBeenCalled();
	});

	it("returns false when there is no selected model id", async () => {
		const { session, setModel } = makeSession({ model: undefined, models: [M("claude-opus-4")] });
		const applied = await applyModelAfterLogin(session as never, undefined);
		expect(applied).toBe(false);
		expect(setModel).not.toHaveBeenCalled();
	});
});
