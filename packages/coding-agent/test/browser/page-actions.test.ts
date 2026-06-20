import { describe, expect, it } from "bun:test";
import { CdpPageActions } from "@f5xc-salesdemos/xcsh/browser/cdp-page-actions";
import { ExtensionPageActions } from "@f5xc-salesdemos/xcsh/browser/extension-page-actions";
import type { PageActions } from "@f5xc-salesdemos/xcsh/browser/page-actions";

describe("PageActions", () => {
	it("CdpPageActions structurally satisfies PageActions", () => {
		// Type-level check: CdpPageActions is assignable to PageActions.
		// Runtime: instantiate with a fake page to confirm no constructor errors.
		const fakePage = {} as import("puppeteer").Page;
		const pa: PageActions = new CdpPageActions(fakePage);
		expect(typeof pa.click).toBe("function");
		expect(typeof pa.fill).toBe("function");
		expect(typeof pa.goto).toBe("function");
		expect(typeof pa.screenshot).toBe("function");
	});

	it("ExtensionPageActions structurally satisfies PageActions", () => {
		const fakeExt = {} as import("@f5xc-salesdemos/xcsh/browser/extension-provider").ExtensionPage;
		const pa: PageActions = new ExtensionPageActions(fakeExt);
		expect(typeof pa.click).toBe("function");
		expect(typeof pa.fill).toBe("function");
		expect(typeof pa.goto).toBe("function");
		expect(typeof pa.screenshot).toBe("function");
	});
});
