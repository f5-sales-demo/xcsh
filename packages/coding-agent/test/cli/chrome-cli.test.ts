import { describe, expect, it } from "bun:test";
import { renderStatus } from "@f5-sales-demo/xcsh/cli/chrome-cli";

describe("renderStatus", () => {
	it("renders the planned action, the probes, and the open-port security note", () => {
		const out = renderStatus({
			debuggableNow: false,
			chromeRunning: true,
			chromeInstalled: true,
			plannedAction: "dedicated",
			detail: "…isolated profile…",
		});
		expect(out).toMatch(/dedicated/);
		expect(out).toMatch(/Chrome running:\s*yes/i);
		expect(out).toMatch(/debuggable now:\s*no/i);
		expect(out).toMatch(/any local process/i); // the security note
	});
});
