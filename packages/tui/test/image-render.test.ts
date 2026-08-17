import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Image } from "@f5-sales-demo/pi-tui/components/image";
import {
	type CellDimensions,
	getCellDimensions,
	ImageProtocol,
	isWindowsTerminalPreviewSixelSupported,
	renderImage,
	resolveTerminalInfo,
	setCellDimensions,
	TERMINAL,
} from "@f5-sales-demo/pi-tui/terminal-capabilities";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminal = TERMINAL as unknown as MutableTerminalInfo;
const BASE64_DUMMY = "AA==";
const SQUARE_DIMENSIONS = { widthPx: 100, heightPx: 100 };
const BASE64_ONE_PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";

function parseKittyParam(sequence: string, key: "c" | "r"): number | null {
	const match = sequence.match(new RegExp(`${key}=(\\d+)`));
	if (!match) return null;
	return Number.parseInt(match[1], 10);
}

function parseITermWidth(sequence: string): string | null {
	const match = sequence.match(/width=([^;:]+)/);
	return match?.[1] ?? null;
}

describe("terminal image rendering", () => {
	const originalProtocol = TERMINAL.imageProtocol;
	let originalCellDims: CellDimensions;

	beforeEach(() => {
		originalCellDims = { ...getCellDimensions() };
		setCellDimensions({ widthPx: 10, heightPx: 10 });
		terminal.imageProtocol = null;
	});

	afterEach(() => {
		setCellDimensions(originalCellDims);
		terminal.imageProtocol = originalProtocol;
	});

	it("fits Kitty images within max width and max height while preserving aspect ratio", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const result = renderImage(BASE64_DUMMY, SQUARE_DIMENSIONS, {
			maxWidthCells: 10,
			maxHeightCells: 2,
		});

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(2);
		expect(parseKittyParam(result?.sequence ?? "", "c")).toBe(2);
		expect(parseKittyParam(result?.sequence ?? "", "r")).toBe(2);
	});

	it("uses intrinsic image size when no bounds are provided", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const result = renderImage(BASE64_DUMMY, SQUARE_DIMENSIONS);

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(10);
		expect(parseKittyParam(result?.sequence ?? "", "c")).toBe(10);
		expect(parseKittyParam(result?.sequence ?? "", "r")).toBe(10);
	});

	it("reduces iTerm2 width when max height is the limiting bound", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		const result = renderImage(BASE64_DUMMY, SQUARE_DIMENSIONS, {
			maxWidthCells: 10,
			maxHeightCells: 2,
		});

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(2);
		expect(parseITermWidth(result?.sequence ?? "")).toBe("2");
		expect(result?.sequence).toContain("height=2");
	});

	it("encodes SIXEL output when protocol is SIXEL", () => {
		terminal.imageProtocol = ImageProtocol.Sixel;
		const result = renderImage(BASE64_ONE_PIXEL_PNG, SQUARE_DIMENSIONS, {
			maxWidthCells: 10,
			maxHeightCells: 2,
		});

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(2);
		expect(result?.sequence.startsWith("\x1bP")).toBe(true);
	});

	it("Image component forwards maxHeightCells to terminal rendering", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const image = new Image(
			BASE64_DUMMY,
			"image/png",
			{ fallbackColor: text => text },
			{ maxWidthCells: 10, maxHeightCells: 2 },
			SQUARE_DIMENSIONS,
		);

		const lines = image.render(20);

		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("\x1b[1A");
		expect(lines[1]).toContain("c=2");
		expect(lines[1]).toContain("r=2");
	});
});

describe("Herdr Kitty graphics capability", () => {
	it("selects Kitty and emits graphics for an explicitly capable Herdr pane", () => {
		const resolved = resolveTerminalInfo({ TERM: "xterm-256color", HERDR_ENV: "1", HERDR_KITTY_GRAPHICS: "1" }, true);
		expect(resolved.imageProtocol).toBe(ImageProtocol.Kitty);

		const originalProtocol = terminal.imageProtocol;
		terminal.imageProtocol = resolved.imageProtocol;
		try {
			const result = renderImage(BASE64_DUMMY, SQUARE_DIMENSIONS);
			expect(result?.sequence.startsWith(ImageProtocol.Kitty)).toBe(true);
		} finally {
			terminal.imageProtocol = originalProtocol;
		}
	});

	it("requires exact enabled Herdr markers and TTY output", () => {
		for (const env of [
			{ TERM: "xterm-256color" },
			{ TERM: "xterm-256color", HERDR_ENV: "1" },
			{ TERM: "xterm-256color", HERDR_KITTY_GRAPHICS: "1" },
			{ TERM: "xterm-256color", HERDR_ENV: "yes", HERDR_KITTY_GRAPHICS: "1" },
			{ TERM: "xterm-256color", HERDR_ENV: "1", HERDR_KITTY_GRAPHICS: "0" },
			{ TERM: "xterm-256color", HERDR_ENV: "1", HERDR_KITTY_GRAPHICS: "true" },
		]) {
			expect(resolveTerminalInfo(env, true).imageProtocol).toBeNull();
		}
		expect(
			resolveTerminalInfo({ TERM: "xterm-256color", HERDR_ENV: "1", HERDR_KITTY_GRAPHICS: "1" }, false)
				.imageProtocol,
		).toBeNull();
	});

	it("preserves explicit image-protocol override precedence", () => {
		const env = { TERM: "xterm-256color", HERDR_ENV: "1", HERDR_KITTY_GRAPHICS: "1" };
		expect(resolveTerminalInfo({ ...env, PI_FORCE_IMAGE_PROTOCOL: "off" }, true).imageProtocol).toBeNull();
		expect(resolveTerminalInfo({ ...env, PI_FORCE_IMAGE_PROTOCOL: "kitty" }, true).imageProtocol).toBe(
			ImageProtocol.Kitty,
		);
		expect(resolveTerminalInfo({ ...env, PI_FORCE_IMAGE_PROTOCOL: "iterm2" }, true).imageProtocol).toBe(
			ImageProtocol.Iterm2,
		);
		expect(resolveTerminalInfo({ ...env, PI_FORCE_IMAGE_PROTOCOL: "sixel" }, true).imageProtocol).toBe(
			ImageProtocol.Sixel,
		);
	});
});

describe("Windows Terminal Preview SIXEL detection", () => {
	it("requires Windows platform, WT session, and known version 1.22+", () => {
		expect(
			isWindowsTerminalPreviewSixelSupported(
				{ WT_SESSION: "1", TERM_PROGRAM: "Windows_Terminal", TERM_PROGRAM_VERSION: "1.22.2362.0" },
				"win32",
			),
		).toBe(true);
		expect(
			isWindowsTerminalPreviewSixelSupported(
				{ WT_SESSION: "1", TERM_PROGRAM: "Windows_Terminal", TERM_PROGRAM_VERSION: "1.21.0.0" },
				"win32",
			),
		).toBe(false);
		expect(
			isWindowsTerminalPreviewSixelSupported({ WT_SESSION: "1", TERM_PROGRAM: "Windows_Terminal" }, "win32"),
		).toBe(false);
		expect(
			isWindowsTerminalPreviewSixelSupported(
				{ WT_SESSION: "1", TERM_PROGRAM: "Windows_Terminal", TERM_PROGRAM_VERSION: "1.22.2362.0" },
				"linux",
			),
		).toBe(false);
	});
});
