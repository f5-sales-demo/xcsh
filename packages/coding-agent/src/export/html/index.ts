import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentState } from "@f5-sales-demo/pi-agent-core";
import { APP_NAME, isEnoent } from "@f5-sales-demo/pi-utils";
import { listMediaAssets, listMediaDescriptors, projectMediaDescriptorForTransport } from "../../media/transport";
import { getResolvedThemeColors, getThemeExportColors } from "../../modes/theme/theme";
import { parseBlobRef } from "../../session/blob-store";
import { type SessionEntry, type SessionHeader, SessionManager } from "../../session/session-manager";
// Pre-generated template (created by scripts/generate-template.ts at publish time)
import { TEMPLATE } from "./template.generated";

export interface ExportOptions {
	outputPath?: string;
	themeName?: string;
}

/** Parse a color string to RGB values. */
function parseColor(color: string): { r: number; g: number; b: number } | undefined {
	const hexMatch = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
	if (hexMatch) {
		return {
			r: Number.parseInt(hexMatch[1], 16),
			g: Number.parseInt(hexMatch[2], 16),
			b: Number.parseInt(hexMatch[3], 16),
		};
	}
	const rgbMatch = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
	if (rgbMatch) {
		return {
			r: Number.parseInt(rgbMatch[1], 10),
			g: Number.parseInt(rgbMatch[2], 10),
			b: Number.parseInt(rgbMatch[3], 10),
		};
	}
	return undefined;
}

/** Calculate relative luminance of a color (0-1, higher = lighter). */
function getLuminance(r: number, g: number, b: number): number {
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Adjust color brightness. */
function adjustBrightness(color: string, factor: number): string {
	const parsed = parseColor(color);
	if (!parsed) return color;
	const adjust = (c: number) => Math.min(255, Math.max(0, Math.round(c * factor)));
	return `rgb(${adjust(parsed.r)}, ${adjust(parsed.g)}, ${adjust(parsed.b)})`;
}

/** Derive export background colors from a base color. */
function deriveExportColors(baseColor: string): { pageBg: string; cardBg: string; infoBg: string } {
	const parsed = parseColor(baseColor);
	if (!parsed) {
		return { pageBg: "rgb(24, 24, 30)", cardBg: "rgb(30, 30, 36)", infoBg: "rgb(60, 55, 40)" };
	}

	const luminance = getLuminance(parsed.r, parsed.g, parsed.b);
	if (luminance > 0.5) {
		return {
			pageBg: adjustBrightness(baseColor, 0.96),
			cardBg: baseColor,
			infoBg: `rgb(${Math.min(255, parsed.r + 10)}, ${Math.min(255, parsed.g + 5)}, ${Math.max(0, parsed.b - 20)})`,
		};
	}
	return {
		pageBg: adjustBrightness(baseColor, 0.7),
		cardBg: adjustBrightness(baseColor, 0.85),
		infoBg: `rgb(${Math.min(255, parsed.r + 20)}, ${Math.min(255, parsed.g + 15)}, ${parsed.b})`,
	};
}

/** Generate CSS custom properties for theme. */
async function generateThemeVars(themeName?: string): Promise<string> {
	const colors = await getResolvedThemeColors(themeName);
	const lines: string[] = [];
	for (const [key, value] of Object.entries(colors)) {
		lines.push(`--${key}: ${value};`);
	}

	const themeExport = await getThemeExportColors(themeName);
	const userMessageBg = colors.userMessageBg || "#343541";
	const derived = deriveExportColors(userMessageBg);

	lines.push(`--body-bg: ${themeExport.pageBg ?? derived.pageBg};`);
	lines.push(`--container-bg: ${themeExport.cardBg ?? derived.cardBg};`);
	lines.push(`--info-bg: ${themeExport.infoBg ?? derived.infoBg};`);

	return lines.join(" ");
}

interface SessionData {
	header: SessionHeader | null;
	entries: SessionEntry[];
	leafId: string | null;
	systemPrompt?: string;
	tools?: { name: string; description: string }[];
	mediaAssets?: Record<string, string | null>;
}

/** Generate HTML from bundled template with runtime substitutions. */
async function generateHtml(sessionData: SessionData, themeName?: string): Promise<string> {
	const themeVars = await generateThemeVars(themeName);
	const sessionDataBase64 = Buffer.from(JSON.stringify(sessionData)).toBase64();

	return TEMPLATE.replace("<theme-vars/>", `<style>:root { ${themeVars} }</style>`).replace(
		"{{SESSION_DATA}}",
		sessionDataBase64,
	);
}

function projectMediaEntries(entries: SessionEntry[]): SessionEntry[] {
	return entries.map(entry => {
		if (entry.type !== "message" || entry.message.role !== "media") return entry;
		return {
			...entry,
			message: { ...entry.message, media: projectMediaDescriptorForTransport(entry.message.media) },
		};
	});
}

const mediaExtension: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"video/mp4": ".mp4",
	"text/plain": ".txt",
};

async function exportMediaAssets(sm: SessionManager, entries: SessionEntry[], outputPath: string) {
	const descriptors = listMediaDescriptors(entries);
	const assets = new Map(descriptors.flatMap(listMediaAssets).map(asset => [asset.ref, asset]));
	if (assets.size === 0) return {};
	const mediaDirName = `${path.basename(outputPath, path.extname(outputPath))}-media`;
	const mediaDir = path.join(path.dirname(outputPath), mediaDirName);
	const result: Record<string, string | null> = {};
	for (const asset of assets.values()) {
		const hash = parseBlobRef(asset.ref);
		const blob = hash ? await sm.getBlobStore().get(hash) : null;
		if (!hash || !blob || blob.byteLength !== asset.bytes) {
			result[asset.ref] = null;
			continue;
		}
		await fs.mkdir(mediaDir, { recursive: true });
		const fileName = `${hash}${mediaExtension[asset.mimeType] ?? ".bin"}`;
		await Bun.write(path.join(mediaDir, fileName), blob);
		result[asset.ref] = `${mediaDirName}/${fileName}`;
	}
	return result;
}

/** Export session to HTML using SessionManager and AgentState. */
export async function exportSessionToHtml(
	sm: SessionManager,
	state?: AgentState,
	options?: ExportOptions | string,
): Promise<string> {
	const opts: ExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	const sessionFile = sm.getSessionFile();
	if (!sessionFile) throw new Error("Cannot export in-memory session to HTML");

	const outputPath = opts.outputPath || `${APP_NAME}-session-${path.basename(sessionFile, ".jsonl")}.html`;
	const entries = sm.getEntries();
	const sessionData: SessionData = {
		header: sm.getHeader(),
		entries: projectMediaEntries(entries),
		leafId: sm.getLeafId(),
		systemPrompt: state?.systemPrompt,
		tools: state?.tools?.map(t => ({ name: t.name, description: t.description })),
		mediaAssets: await exportMediaAssets(sm, entries, outputPath),
	};

	const html = await generateHtml(sessionData, opts.themeName);
	await Bun.write(outputPath, html);
	return outputPath;
}

/** Export session file to HTML (standalone). */
export async function exportFromFile(inputPath: string, options?: ExportOptions | string): Promise<string> {
	const opts: ExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	let sm: SessionManager;
	try {
		sm = await SessionManager.open(inputPath);
	} catch (err) {
		if (isEnoent(err)) throw new Error(`File not found: ${inputPath}`);
		throw err;
	}

	const outputPath = opts.outputPath || `${APP_NAME}-session-${path.basename(inputPath, ".jsonl")}.html`;
	const entries = sm.getEntries();
	const sessionData: SessionData = {
		header: sm.getHeader(),
		entries: projectMediaEntries(entries),
		leafId: sm.getLeafId(),
		mediaAssets: await exportMediaAssets(sm, entries, outputPath),
	};

	const html = await generateHtml(sessionData, opts.themeName);
	await Bun.write(outputPath, html);
	return outputPath;
}
