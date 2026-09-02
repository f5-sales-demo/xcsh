import { type Container, Text } from "@f5-sales-demo/pi-tui";
import { copyToClipboard } from "../../utils/clipboard";
import { theme } from "../theme/theme";

type AuthLinkContainer = Pick<Container, "addChild">;

export interface AuthLinkPresenterOptions {
	copy?: (url: string) => void | Promise<void>;
	platform?: NodeJS.Platform;
}

/** Present a browser authorization target without exposing its long URL as visible terminal text. */
export function presentAuthLink(
	container: AuthLinkContainer,
	url: string,
	options: AuthLinkPresenterOptions = {},
): void {
	const platform = options.platform ?? process.platform;
	const clickHint = platform === "darwin" ? "Cmd+click to open" : "Ctrl+click to open";
	const hyperlink = `\x1b]8;;${url}\x07Open sign-in page\x1b]8;;\x07`;
	container.addChild(new Text(`${theme.fg("accent", hyperlink)} ${theme.fg("dim", `(${clickHint})`)}`, 1, 0));
	container.addChild(
		new Text(
			theme.fg("dim", "Sign-in URL copied when supported. Clipboard availability depends on terminal support."),
			1,
			0,
		),
	);

	const copy = options.copy ?? copyToClipboard;
	try {
		void Promise.resolve(copy(url)).catch(() => undefined);
	} catch {
		// Clipboard access is best-effort; the OSC 8 link remains available.
	}
}
