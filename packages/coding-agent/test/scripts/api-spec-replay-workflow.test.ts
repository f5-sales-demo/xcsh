import { expect, test } from "bun:test";

test("pending replay preserves attested files while retaining exact verification", async () => {
	const workflow = await Bun.file(
		new URL("../../../../.github/workflows/api-spec-update.yml", import.meta.url),
	).text();
	for (const name of [
		"Remove stale generated files",
		"Generate exact API spec and catalog indexes",
		"Generate Terraform index",
		"Generate exact minimum-settings defaults table",
	]) {
		expect(workflow).toContain(
			`- name: ${name}\n        if: steps.main_delivery.outputs.applied != 'true' && steps.main_pending.outputs.pending != 'true'`,
		);
	}
	expect(workflow).toContain(
		"- name: Verify exact regenerated delivery bytes\n        if: steps.main_delivery.outputs.applied != 'true'",
	);
	expect(workflow).toContain("run: bun scripts/api-spec-delivery.ts verify-generated");
	expect(workflow).toContain("- name: Verify post-merge release publication");
});
