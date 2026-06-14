import * as fs from "node:fs";
import * as path from "node:path";
import { parseAllDocuments } from "yaml";

const JSON_EXTENSIONS = new Set([".json"]);
const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);
const SUPPORTED_EXTENSIONS = new Set([...JSON_EXTENSIONS, ...YAML_EXTENSIONS]);

export interface FileReadResult {
	objects: Record<string, unknown>[];
	sourcePath: string;
}

export async function readManifestFiles(filenames: string[], recursive: boolean): Promise<FileReadResult[]> {
	const results: FileReadResult[] = [];
	for (const filename of filenames) {
		if (filename === "-") {
			results.push(await readFromStdin());
			continue;
		}

		const resolved = path.resolve(filename);
		const stat = await fs.promises.stat(resolved).catch(() => null);
		if (!stat) {
			throw new ManifestFileError(`File not found: ${filename}`);
		}

		if (stat.isDirectory()) {
			const files = await collectDirectoryFiles(resolved, recursive);
			for (const file of files) {
				results.push(await readSingleFile(file));
			}
		} else {
			results.push(await readSingleFile(resolved));
		}
	}
	return results;
}

async function readSingleFile(filePath: string): Promise<FileReadResult> {
	const ext = path.extname(filePath).toLowerCase();
	const content = await fs.promises.readFile(filePath, "utf-8");

	if (JSON_EXTENSIONS.has(ext)) {
		return { objects: parseJsonContent(content, filePath), sourcePath: filePath };
	}
	if (YAML_EXTENSIONS.has(ext)) {
		return { objects: parseYamlContent(content, filePath), sourcePath: filePath };
	}

	return { objects: parseAutoDetect(content, filePath), sourcePath: filePath };
}

function parseJsonContent(content: string, sourcePath: string): Record<string, unknown>[] {
	const trimmed = content.trim();
	if (!trimmed) return [];
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return parsed.filter((item): item is Record<string, unknown> => item != null && typeof item === "object");
		}
		if (typeof parsed === "object" && parsed !== null) {
			return [parsed as Record<string, unknown>];
		}
		throw new ManifestFileError(`Expected object or array in ${sourcePath}, got ${typeof parsed}`);
	} catch (err) {
		if (err instanceof ManifestFileError) throw err;
		throw new ManifestFileError(`Invalid JSON in ${sourcePath}: ${(err as Error).message}`);
	}
}

function parseYamlContent(content: string, sourcePath: string): Record<string, unknown>[] {
	const trimmed = content.trim();
	if (!trimmed) return [];
	try {
		const docs = parseAllDocuments(trimmed);
		const objects: Record<string, unknown>[] = [];
		for (const doc of docs) {
			if (doc.errors.length > 0) {
				const firstError = doc.errors[0];
				throw new ManifestFileError(`Invalid YAML in ${sourcePath}: ${firstError.message}`);
			}
			const value = doc.toJSON();
			if (value != null && typeof value === "object" && !Array.isArray(value)) {
				objects.push(value as Record<string, unknown>);
			}
		}
		return objects;
	} catch (err) {
		if (err instanceof ManifestFileError) throw err;
		throw new ManifestFileError(`Invalid YAML in ${sourcePath}: ${(err as Error).message}`);
	}
}

function parseAutoDetect(content: string, sourcePath: string): Record<string, unknown>[] {
	const trimmed = content.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return parseJsonContent(content, sourcePath);
	}
	return parseYamlContent(content, sourcePath);
}

async function collectDirectoryFiles(dirPath: string, recursive: boolean): Promise<string[]> {
	const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (SUPPORTED_EXTENSIONS.has(ext)) {
				files.push(fullPath);
			}
		} else if (entry.isDirectory() && recursive) {
			files.push(...(await collectDirectoryFiles(fullPath, recursive)));
		}
	}
	return files;
}

async function readFromStdin(): Promise<FileReadResult> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			if (chunks.length === 0) {
				reject(new ManifestFileError("No data received from stdin (timed out after 5s)."));
			}
		}, 5000);

		process.stdin.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});

		process.stdin.on("end", () => {
			clearTimeout(timer);
			if (timedOut && chunks.length === 0) return;
			const content = Buffer.concat(chunks).toString("utf-8");
			try {
				resolve({ objects: parseAutoDetect(content, "stdin"), sourcePath: "stdin" });
			} catch (err) {
				reject(err);
			}
		});

		process.stdin.on("error", err => {
			clearTimeout(timer);
			reject(new ManifestFileError(`Failed to read from stdin: ${err.message}`));
		});

		process.stdin.resume();
	});
}

export class ManifestFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ManifestFileError";
	}
}
