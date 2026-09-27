import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage, ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Model } from "@f5-sales-demo/pi-ai";
import { formatSessionDumpText } from "../../coding-agent/src/session/session-dump-format";

export type ConversationDumpSnapshot = {
	messages: AgentMessage[];
	sourceSessionFile?: string;
	systemPrompt?: string;
	model?: Model;
	thinkingLevel?: ThinkingLevel | undefined;
	dumpTools?: Array<{ name: string; description: string; parameters: unknown }>;
};

function sanitizeDumpPathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getConversationDumpPath(dumpDir: string, taskId: string, runIndex: number): string {
	return path.join(dumpDir, sanitizeDumpPathSegment(taskId), `run-${runIndex + 1}.md`);
}

/** Artifacts directory for a session dump file (.md or legacy .jsonl). */
function dumpArtifactsDir(dumpFilePath: string): string {
	if (dumpFilePath.endsWith(".md")) return dumpFilePath.slice(0, -3);
	if (dumpFilePath.endsWith(".jsonl")) return dumpFilePath.slice(0, -6);
	const ext = path.extname(dumpFilePath);
	return path.join(path.dirname(dumpFilePath), path.basename(dumpFilePath, ext));
}

async function copyConversationArtifacts(sourceSessionFile: string, targetDumpFile: string): Promise<void> {
	const sourceArtifactsDir = dumpArtifactsDir(sourceSessionFile);
	const targetArtifactsDir = dumpArtifactsDir(targetDumpFile);
	try {
		const stat = await fs.promises.stat(sourceArtifactsDir);
		if (!stat.isDirectory()) return;
		await fs.promises.cp(sourceArtifactsDir, targetArtifactsDir, { recursive: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}

export async function writeConversationDump(params: {
	dumpDir: string;
	taskId: string;
	runIndex: number;
	snapshot: ConversationDumpSnapshot;
}): Promise<string> {
	const dumpPath = getConversationDumpPath(params.dumpDir, params.taskId, params.runIndex);
	await fs.promises.mkdir(path.dirname(dumpPath), { recursive: true });
	const body = formatSessionDumpText({
		messages: params.snapshot.messages,
		systemPrompt: params.snapshot.systemPrompt,
		model: params.snapshot.model,
		thinkingLevel: params.snapshot.thinkingLevel,
		tools: params.snapshot.dumpTools,
	});
	await Bun.write(dumpPath, `${body}\n`);
	if (params.snapshot.sourceSessionFile) {
		await copyConversationArtifacts(params.snapshot.sourceSessionFile, dumpPath);
	}
	return dumpPath;
}
