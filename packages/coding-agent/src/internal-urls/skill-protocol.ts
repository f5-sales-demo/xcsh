/**
 * Protocol handler for skill:// URLs.
 *
 * Resolves skill names to their SKILL.md files or relative paths within skill directories.
 *
 * URL forms:
 * - skill://<name> - Reads SKILL.md
 * - skill://<name>/<path> - Reads relative path within skill's baseDir
 */
import * as path from "node:path";
import { resolveSkillFromPath } from "../extensibility/skill-resolution";
import type { Skill } from "../extensibility/skills";
import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";

export interface SkillProtocolOptions {
	/**
	 * Returns the currently loaded skills.
	 */
	getSkills: () => readonly Skill[];
}

/**
 * Get content type based on file extension.
 */
function getContentType(filePath: string): InternalResource["contentType"] {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".md") return "text/markdown";
	return "text/plain";
}

/**
 * Validate that a path is safe (no traversal, no absolute paths).
 */
export function validateRelativePath(relativePath: string): void {
	if (path.isAbsolute(relativePath)) {
		throw new Error("Absolute paths are not allowed in skill:// URLs");
	}

	const normalized = path.normalize(relativePath);
	if (normalized.startsWith("..") || normalized.includes("/../") || normalized.includes("/..")) {
		throw new Error("Path traversal (..) is not allowed in skill:// URLs");
	}
}

/**
 * Handler for skill:// URLs.
 *
 * Resolves skill names to their content files.
 */
export class SkillProtocolHandler implements ProtocolHandler {
	readonly scheme = "skill";

	constructor(private readonly options: SkillProtocolOptions) {}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const skills = this.options.getSkills();

		const rawHost = url.rawHost || url.hostname || "";
		const rawPathname = url.rawPathname || url.pathname || "";

		if (!rawHost && !rawPathname) {
			throw new Error("skill:// URL requires a skill name: skill://<name>");
		}

		// Resolve skill using resilient matcher (handles exact, colon line-ranges, slash notation, aliases)
		const match = resolveSkillFromPath(rawHost, rawPathname, skills);
		if (!match) {
			const available = skills.map(s => s.name);
			const availableStr = available.length > 0 ? available.join(", ") : "none";
			const requested = rawHost + (rawPathname ? rawPathname : "");
			throw new Error(`Unknown skill: ${requested}\nAvailable: ${availableStr}`);
		}

		const { skill, relativePath } = match;
		let targetPath: string;

		if (relativePath) {
			const decoded = decodeURIComponent(relativePath);
			validateRelativePath(decoded);
			targetPath = path.join(skill.baseDir, decoded);

			// Verify resolved path stays within skill baseDir
			const resolvedPath = path.resolve(targetPath);
			const resolvedBaseDir = path.resolve(skill.baseDir);
			if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) && resolvedPath !== resolvedBaseDir) {
				throw new Error("Path traversal is not allowed");
			}
		} else {
			targetPath = skill.filePath;
		}

		// Read the file
		const file = Bun.file(targetPath);
		if (!(await file.exists())) {
			throw new Error(`File not found: ${targetPath}`);
		}

		const content = await file.text();
		const contentType = getContentType(targetPath);

		return {
			url: url.href,
			content,
			contentType,
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: targetPath,
			notes: [],
		};
	}
}
