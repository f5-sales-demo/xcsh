import { expect, test, vi } from "bun:test";
import { PluginSettingsDrafts, type PluginSettingsSnapshot } from "../src/modes/components/plugin-settings-drafts";

function fixture(): PluginSettingsSnapshot {
	return {
		destination: "/fixture/xcsh-plugins.lock.json",
		plugins: [
			{
				name: "example",
				path: "/fixture/example",
				version: "1.0.0",
				enabled: false,
				enabledFeatures: null,
				manifest: {
					version: "1.0.0",
					settings: {
						token: { type: "string", secret: true },
						limit: { type: "number", min: 1, max: 10, default: 2 },
					},
				},
			},
		],
		config: { plugins: { example: { version: "1.0.0", enabled: true, enabledFeatures: null } }, settings: {} },
	};
}

test("plugin drafts use saved defaults, mask secrets and do not mutate source snapshots", async () => {
	const snapshot = fixture();
	const original = structuredClone(snapshot);
	const drafts = new PluginSettingsDrafts();
	const plugin = snapshot.plugins[0];
	expect(drafts.value(snapshot, plugin, "enabled")).toBe(true);
	drafts.stage(snapshot, plugin, "enabled", false);
	drafts.stage(snapshot, plugin, "config:token", "synthetic-secret");
	expect(snapshot).toEqual(original);
	expect(drafts.reviewLines().join("\n")).not.toContain("synthetic-secret");
	expect(drafts.reviewLines().join("\n")).toContain("User defaults");
	drafts.clear();
	const write = vi.fn();
	await drafts.save(async () => snapshot, write);
	expect(write).not.toHaveBeenCalled();
});

test("unchanged values cause no writes and invalid numbers never enter a draft", async () => {
	const snapshot = fixture();
	const drafts = new PluginSettingsDrafts();
	drafts.stage(snapshot, snapshot.plugins[0], "config:limit", 2);
	expect(drafts.size).toBe(0);
	expect(() => drafts.stage(snapshot, snapshot.plugins[0], "config:limit", NaN)).toThrow();
	expect(() => drafts.stage(snapshot, snapshot.plugins[0], "config:limit", 11)).toThrow();
});

test("reviewed plugin identity and saved values are revalidated before any write", async () => {
	const snapshot = fixture();
	const drafts = new PluginSettingsDrafts();
	drafts.stage(snapshot, snapshot.plugins[0], "config:limit", 4);
	const changed = structuredClone(snapshot);
	changed.plugins[0].version = "2.0.0";
	const write = vi.fn();
	await expect(drafts.save(async () => changed, write)).rejects.toThrow("target changed");
	changed.plugins[0].version = "1.0.0";
	changed.config.settings.example = { limit: 3 };
	await expect(drafts.save(async () => changed, write)).rejects.toThrow("value changed");
	expect(write).not.toHaveBeenCalled();
	expect(drafts.size).toBe(1);
});

test("failure retains drafts; retry preserves unrelated state and skips already-completed changes", async () => {
	let snapshot = fixture();
	const drafts = new PluginSettingsDrafts();
	drafts.stage(snapshot, snapshot.plugins[0], "enabled", false);
	drafts.stage(snapshot, snapshot.plugins[0], "config:limit", 4);
	const pending = Promise.withResolvers<void>();
	const first = drafts.save(
		async () => snapshot,
		async () => {
			await pending.promise;
			throw new Error("disk unavailable");
		},
	);
	await expect(drafts.save(async () => snapshot, vi.fn())).rejects.toThrow("already in progress");
	pending.resolve();
	await expect(first).rejects.toThrow("disk unavailable");
	expect(drafts.size).toBe(2);
	snapshot.config.settings.unrelated = { keep: true };
	await drafts.save(
		async () => snapshot,
		async next => {
			snapshot = next;
		},
	);
	expect(snapshot.config.plugins.example.enabled).toBe(false);
	expect(snapshot.config.settings.example.limit).toBe(4);
	expect(snapshot.config.settings.unrelated).toEqual({ keep: true });
	expect(drafts.size).toBe(0);
	drafts.stage(snapshot, snapshot.plugins[0], "enabled", true);
	await expect(
		drafts.save(
			async () => snapshot,
			async next => {
				snapshot = next;
				throw new Error("Acknowledgement lost after write");
			},
		),
	).rejects.toThrow("Acknowledgement lost");
	const redundantWrite = vi.fn();
	await drafts.save(async () => snapshot, redundantWrite);
	expect(redundantWrite).not.toHaveBeenCalled();
	expect(drafts.size).toBe(0);
});
