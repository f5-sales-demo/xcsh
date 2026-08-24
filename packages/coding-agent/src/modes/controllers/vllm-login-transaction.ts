import * as fs from "node:fs";
import * as path from "node:path";
import type { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { AuthCredential, Model } from "@f5-sales-demo/pi-ai";
import { writeVllmModelsConfig } from "../../config/vllm-config";
import { applyModelAfterLogin, type LoginModelChoice } from "./login-model";
import type { VllmLoginCredentials } from "./vllm-login-flow";

interface VllmTransactionSession {
	model?: Model;
	thinkingLevel?: ThinkingLevel;
	modelRegistry: {
		authStorage: {
			get(provider: string): AuthCredential | undefined;
			set(provider: string, credential: AuthCredential): Promise<void>;
			remove(provider: string): Promise<void>;
		};
		refreshProvider(providerId: string, strategy: "online"): Promise<void>;
		getAll(): Model[];
	};
	setModel(model: Model, role: "default", options: { selector: string; thinkingLevel: ThinkingLevel }): Promise<void>;
	setModelTemporary?(model: Model, thinkingLevel?: ThinkingLevel): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	settings: {
		getModelRoles(): Readonly<Record<string, string | undefined>>;
		set(key: "modelRoles", value: Record<string, string>): void;
	};
}

interface CommitVllmLoginOptions {
	modelsPath: string;
	credentials: VllmLoginCredentials;
	choice: LoginModelChoice;
	session: VllmTransactionSession;
}

interface FileSnapshot {
	existed: boolean;
	content?: Buffer;
	mode?: number;
}

interface DirectorySnapshot {
	existed: boolean;
	mode?: number;
}

function captureFile(filePath: string): FileSnapshot {
	try {
		const stat = fs.statSync(filePath);
		return { existed: true, content: fs.readFileSync(filePath), mode: stat.mode & 0o777 };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { existed: false };
		throw error;
	}
}

async function restoreFile(filePath: string, snapshot: FileSnapshot): Promise<void> {
	if (!snapshot.existed) {
		await fs.promises.rm(filePath, { force: true });
		return;
	}
	if (!snapshot.content) throw new Error(`Missing rollback content for ${filePath}`);
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
	await fs.promises.writeFile(filePath, snapshot.content, { mode: snapshot.mode });
	if (snapshot.mode !== undefined) await fs.promises.chmod(filePath, snapshot.mode);
}

function captureDirectory(directory: string): DirectorySnapshot {
	try {
		return { existed: true, mode: fs.statSync(directory).mode & 0o777 };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { existed: false };
		throw error;
	}
}

async function restoreDirectory(directory: string, snapshot: DirectorySnapshot): Promise<void> {
	if (snapshot.existed) {
		if (snapshot.mode !== undefined) await fs.promises.chmod(directory, snapshot.mode);
		return;
	}
	await fs.promises.rmdir(directory).catch(error => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
			throw error;
		}
	});
}

export async function commitVllmLogin(options: CommitVllmLoginOptions): Promise<void> {
	const { modelsPath, credentials, choice, session } = options;
	const modelsSnapshot = captureFile(modelsPath);
	const directory = path.dirname(modelsPath);
	const directorySnapshot = captureDirectory(directory);
	const previousCredential = session.modelRegistry.authStorage.get("vllm");
	const previousModel = session.model;
	const previousThinkingLevel = session.thinkingLevel;
	const previousModelRoles = Object.fromEntries(
		Object.entries(session.settings.getModelRoles()).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	const apiKey = credentials.apiKey.trim();

	try {
		await writeVllmModelsConfig(modelsPath, credentials.baseUrl, { authenticated: apiKey.length > 0 });
		if (apiKey) await session.modelRegistry.authStorage.set("vllm", { type: "api_key", key: apiKey });
		else await session.modelRegistry.authStorage.remove("vllm");

		await session.modelRegistry.refreshProvider("vllm", "online");
		const applied = await applyModelAfterLogin(session, choice);
		if (!applied) throw new Error(`Model unavailable after refresh: ${choice.provider}/${choice.modelId}`);
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		try {
			await restoreFile(modelsPath, modelsSnapshot);
			await restoreDirectory(directory, directorySnapshot);
		} catch (rollbackError) {
			rollbackErrors.push(rollbackError);
		}
		try {
			if (previousCredential) await session.modelRegistry.authStorage.set("vllm", previousCredential);
			else await session.modelRegistry.authStorage.remove("vllm");
		} catch (rollbackError) {
			rollbackErrors.push(rollbackError);
		}
		try {
			session.settings.set("modelRoles", previousModelRoles);
		} catch (rollbackError) {
			rollbackErrors.push(rollbackError);
		}
		try {
			await session.modelRegistry.refreshProvider("vllm", "online");
			if (previousModel && session.setModelTemporary) {
				await session.setModelTemporary(previousModel, previousThinkingLevel);
			} else if (previousThinkingLevel !== undefined) {
				session.setThinkingLevel(previousThinkingLevel);
			}
		} catch (rollbackError) {
			rollbackErrors.push(rollbackError);
		}

		if (rollbackErrors.length > 0) {
			throw new AggregateError([error, ...rollbackErrors], "vLLM login failed and rollback was incomplete");
		}
		throw error;
	}
}
