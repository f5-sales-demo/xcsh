import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function terminalUatLinkExtension(pi: ExtensionAPI) {
	pi.registerCommand("uat-schedule-link", {
		description: "Schedule a disposable transcript link for terminal acceptance",
		handler: async (_args, ctx) => {
			setTimeout(() => {
				pi.sendMessage({
					customType: "terminal-uat-link",
					content: "Synthetic changed link: https://example.test/changed-after-review",
					display: true,
					attribution: "agent",
				});
			}, 750);
			ctx.ui.notify("Scheduled disposable link update", "info");
		},
	});
}
