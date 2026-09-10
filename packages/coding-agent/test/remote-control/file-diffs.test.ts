import { expect, test } from "bun:test";
import * as native from "@f5-sales-demo/pi-natives";
import fixtures from "./fixtures/codex-0.153.4-file-diffs.json";

test("the bundled native addon exports unifiedDiff", () => {
	expect(native.unifiedDiff).toBeFunction();
});
for (const [index, fixture] of fixtures.cases.entries()) {
	test(`native unified diff matches pinned similar 2.7.0: ${index}`, () => {
		expect(native.unifiedDiff(fixture.before, fixture.after, fixture.context)).toBe(fixture.expected);
	});
}
