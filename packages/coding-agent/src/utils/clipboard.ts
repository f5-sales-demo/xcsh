import { execSync } from "node:child_process";
import type { ClipboardImage } from "@f5-sales-demo/pi-natives";
import * as native from "@f5-sales-demo/pi-natives";

const hasDisplay = process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

/**
 * Copy text to the system clipboard.
 *
 * Emits OSC 52 first when running in a real terminal (works over SSH/mosh),
 * then attempts native clipboard copy as best-effort for local sessions.
 * On Termux, tries `termux-clipboard-set` before native.
 *
 * @param text - UTF-8 text to place on the clipboard.
 */
export async function copyToClipboard(text: string): Promise<void> {
	await copyToClipboardWithResult(text);
}

export type CopyToClipboardResult = { ok: true } | { ok: false; error: string };

/** Copy text while preserving an actionable failure result for interactive workflows. */
export async function copyToClipboardWithResult(text: string): Promise<CopyToClipboardResult> {
	const result = await copyToClipboardWithDelivery(text);
	return result.ok ? { ok: true } : result;
}

export type ClipboardDeliveryResult = { ok: true; delivery: "copied" | "requested" } | { ok: false; error: string };

/** OSC 52 has no delivery acknowledgement; only a completed native copy confirms delivery. */
export async function copyToClipboardWithDelivery(text: string): Promise<ClipboardDeliveryResult> {
	const osc52Accepted = process.stdout.isTTY
		? await new Promise<boolean>(resolve => {
				const finish = (accepted: boolean) => {
					// A failed write callback can precede the stream's error event.
					if (accepted) process.stdout.off("error", onError);
					else setImmediate(() => process.stdout.off("error", onError));
					resolve(accepted);
				};
				const onError = () => finish(false);
				process.stdout.on("error", onError);
				try {
					process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`, error => finish(!error));
				} catch {
					finish(false);
				}
			})
		: false;

	// Also try native tools (best effort for local sessions)
	try {
		if (process.env.TERMUX_VERSION) {
			try {
				execSync("termux-clipboard-set", { input: text, timeout: 5000 });
				return { ok: true, delivery: "copied" };
			} catch {
				// Fall through to native
			}
		}

		await native.copyToClipboard(text);
		return { ok: true, delivery: "copied" };
	} catch (error) {
		if (osc52Accepted) return { ok: true, delivery: "requested" };
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Read an image from the system clipboard.
 *
 * Returns null on Termux (no image clipboard support) or when no display
 * server is available (headless/SSH without forwarding).
 *
 * @returns PNG payload or null when no image is available.
 */
export async function readImageFromClipboard(): Promise<ClipboardImage | null> {
	if (process.env.TERMUX_VERSION) {
		return null;
	}

	if (!hasDisplay) {
		return null;
	}

	return (await native.readImageFromClipboard()) ?? null;
}
