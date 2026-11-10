import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	AcceptanceClaims,
	privateJson,
	replayAcceptedResponse,
	runHerdrAcceptanceAction,
} from "../src/lifecycle/herdr-acceptance-control";

describe("private Herdr acceptance controls", () => {
	it("recovers an exact completed receipt when the projection file was never published", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-acceptance-"));
		try {
			const executable = fs.realpathSync(process.execPath);
			const binding = {
				execution_id: "owned",
				pane_id: "p1",
				session_id: "0123abcd4567ef89",
				generation: 0,
				turn_id: "turn-1",
				pid: process.pid,
				executable,
				journal_revision: 2,
				executable_sha256: createHash("sha256").update(fs.readFileSync(executable)).digest("hex"),
			};
			const plan = path.join(dir, "plan.json");
			const descriptor = path.join(dir, "descriptor.json");
			fs.writeFileSync(plan, JSON.stringify({ version: 1, control_directory: dir, approvals: [] }), { mode: 0o600 });
			fs.writeFileSync(
				descriptor,
				JSON.stringify({
					version: 1,
					binding,
					plan_file: plan,
					control_token: "private-token",
					boundary: "released",
				}),
				{ mode: 0o600 },
			);
			const request = {
				version: 1,
				action: "release",
				action_key: "completed",
				binding,
				descriptor_file: descriptor,
				control_token: "private-token",
			};
			const { control_token: _token, ...safeRequest } = request;
			const claims = new AcceptanceClaims(path.join(dir, "claims.sqlite"));
			const receipt = await claims.run(request.action_key, safeRequest, async () => ({
				exact: "durable producer receipt",
			}));
			claims.close();
			const file = path.join(dir, "request.json");
			fs.writeFileSync(file, JSON.stringify(request), { mode: 0o600 });
			expect(await runHerdrAcceptanceAction(file)).toEqual(receipt);
			expect(await runHerdrAcceptanceAction(file)).toEqual(receipt);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects accepted replay acknowledgements for another execution", async () => {
		await expect(
			replayAcceptedResponse({ execution_id: "owned", event_revision: 3 }, async () => ({
				type: "agent_turn",
				admitted: true,
				turn: { execution_id: "foreign", event_revision: 3, revision: 12 },
			})),
		).rejects.toThrow();
	});
	it("claims before effects, replays the exact receipt, and rejects changed requests", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-acceptance-"));
		try {
			const claims = new AcceptanceClaims(path.join(dir, "claims.sqlite"));
			let effects = 0;
			const request = { key: "action-1", binding: { generation: 0 } };
			const effect = async () => {
				expect(claims.state(request.key)).toBe("claimed");
				effects++;
				return { exact: "producer receipt" };
			};
			const receipt = await claims.run(request.key, request, effect);
			expect(await claims.run(request.key, request, effect)).toEqual(receipt);
			expect(effects).toBe(1);
			await expect(claims.run(request.key, { ...request, binding: { generation: 1 } }, effect)).rejects.toThrow(
				"conflicts",
			);
			claims.close();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("retains uncertain claims across adapter restart without repeating an effect", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-acceptance-"));
		try {
			const file = path.join(dir, "claims.sqlite");
			let claims = new AcceptanceClaims(file);
			await expect(
				claims.run("uncertain", {}, async () => {
					throw new Error("cutpoint");
				}),
			).rejects.toThrow("cutpoint");
			claims.close();
			claims = new AcceptanceClaims(file);
			let effects = 0;
			await expect(
				claims.run("uncertain", {}, async () => {
					effects++;
					return {};
				}),
			).rejects.toThrow("uncertain");
			expect(effects).toBe(0);
			claims.close();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("discards an accepted response and redelivers the identical pending payload", async () => {
		const frames: unknown[] = [];
		const result = await replayAcceptedResponse({ execution_id: "owned", event_revision: 3 }, async frame => {
			frames.push(structuredClone(frame));
			return { type: "agent_turn", admitted: frames.length === 1, turn: { ...frame, revision: 12 } };
		});
		expect(frames).toHaveLength(2);
		expect(frames[0]).toEqual(frames[1]);
		expect(result.receipt.acknowledgements).toHaveLength(2);
		expect(result.receipt.response_discarded).toBe(true);
		expect(result.response.admitted).toBe(false);
	});

	it("rejects public and symlinked plan files", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-acceptance-"));
		try {
			const file = path.join(dir, "plan.json");
			fs.writeFileSync(file, "{}", { mode: 0o644 });
			expect(() => privateJson(file)).toThrow("owner-private");
			fs.chmodSync(file, 0o600);
			fs.symlinkSync(file, path.join(dir, "link.json"));
			expect(() => privateJson(path.join(dir, "link.json"))).toThrow("regular");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
