import { afterEach, describe, expect, it, vi } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { runReadCommand } from "../../src/cli/read-cli";
import { Settings } from "../../src/config/settings";
import { InternalDocsProtocolHandler } from "../../src/internal-urls/xcsh-protocol";
import * as scrapers from "../../src/web/scrapers/types";

describe("runReadCommand URL handling", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("routes xcsh documentation URIs through the internal read tool", async () => {
		const settings = Settings.isolated({});
		vi.spyOn(Settings, "init").mockResolvedValue(settings);
		const resolve = vi.spyOn(InternalDocsProtocolHandler.prototype, "resolve").mockResolvedValue({
			url: "xcsh://terraform-documentation/test",
			content: "Complete offline Terraform documentation",
			contentType: "text/markdown",
		});
		const output = vi.spyOn(console, "log").mockImplementation(() => {});
		await runReadCommand({
			path: "xcsh://terraform-documentation/documentation/resources/fixture/index.md?view=full#schema-name",
		});
		expect(resolve).toHaveBeenCalled();
		expect(output).toHaveBeenCalledWith("Complete offline Terraform documentation");
	});

	it("delegates URL inputs through the read tool pipeline", async () => {
		const cwd = path.join(os.tmpdir(), "read-cli-url-test");
		const settings = Settings.isolated({ "fetch.enabled": true });
		const pageUrl = "https://example.com/cli-read";
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(Settings, "init").mockResolvedValue(settings);
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "text/plain",
			finalUrl: pageUrl,
			content: "CLI URL content",
		});
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);

		await runReadCommand({ path: pageUrl });

		expect(cwdSpy).toHaveBeenCalled();
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("CLI URL content"));
	});
});
