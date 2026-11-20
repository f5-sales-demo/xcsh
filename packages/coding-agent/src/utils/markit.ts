import { untilAborted } from "@f5-sales-demo/pi-utils";
import { ToolAbortError } from "../tools/tool-errors";
import { convertInMarkitWorker } from "./markit-worker-client";

export interface MarkitConversionResult {
	content: string;
	ok: boolean;
	error?: string;
}

function normalizeExtension(extension: string): string {
	const trimmed = extension.trim().toLowerCase();
	if (!trimmed) return ".bin";
	return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function normalizeError(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message.trim();
	}
	return "Conversion failed";
}

async function runMarkitConversion<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	try {
		return signal ? await untilAborted(signal, task) : await task();
	} catch (error) {
		if (error instanceof ToolAbortError) {
			throw error;
		}
		if (error instanceof Error && error.name === "AbortError") {
			throw new ToolAbortError();
		}
		throw error;
	}
}

function finalizeConversion(markdown?: string): MarkitConversionResult {
	if (typeof markdown === "string" && markdown.length > 0) {
		return { content: markdown, ok: true };
	}

	return { content: "", ok: false, error: "Conversion produced no output" };
}

export async function convertFileWithMarkit(filePath: string, signal?: AbortSignal): Promise<MarkitConversionResult> {
	try {
		const markdown = await runMarkitConversion(
			() => convertInMarkitWorker({ operation: "file", path: filePath }, signal),
			signal,
		);
		return finalizeConversion(markdown);
	} catch (error) {
		if (error instanceof ToolAbortError) {
			throw error;
		}
		return { content: "", ok: false, error: normalizeError(error) };
	}
}

export async function convertBufferWithMarkit(
	buffer: Uint8Array,
	extension: string,
	signal?: AbortSignal,
): Promise<MarkitConversionResult> {
	const normalizedExtension = normalizeExtension(extension);

	try {
		const markdown = await runMarkitConversion(
			() =>
				convertInMarkitWorker(
					{
						operation: "buffer",
						data: Buffer.from(buffer).toString("base64"),
						extension: normalizedExtension,
					},
					signal,
				),
			signal,
		);
		return finalizeConversion(markdown);
	} catch (error) {
		if (error instanceof ToolAbortError) {
			throw error;
		}
		return { content: "", ok: false, error: normalizeError(error) };
	}
}
