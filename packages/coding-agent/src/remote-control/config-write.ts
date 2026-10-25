import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock } from "../config/file-lock";
import type { RemoteTaskSettings } from "./router";
import { ProtocolError } from "./session";

const keys = ["model", "model_reasoning_effort", "approval_policy", "approvals_reviewer", "sandbox_mode"] as const;
type ConfigKey = (typeof keys)[number];
type Values = Partial<Record<ConfigKey, string>>;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Native remote-host defaults. Global writes do not change an existing conversation. */
export class RemoteConfig {
	readonly filePath: string;
	constructor(private readonly directory: string) {
		this.filePath = join(directory, "task-settings.json");
	}
	async #load(): Promise<{ values: Values; version: string }> {
		let raw: string;
		try {
			const info = await lstat(this.filePath);
			if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.())
				throw new Error("Invalid remote config file");
			raw = await readFile(this.filePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { values: {}, version: digest("") };
			throw error;
		}
		const record = JSON.parse(raw);
		if (
			record.schemaVersion !== 1 ||
			!record.values ||
			typeof record.values !== "object" ||
			Array.isArray(record.values) ||
			Object.entries(record.values).some(
				([key, value]) => !keys.includes(key as ConfigKey) || typeof value !== "string",
			)
		)
			throw new Error("Invalid remote config values");
		return { values: record.values, version: digest(raw) };
	}
	async read(bootstrap: RemoteTaskSettings | undefined) {
		const stored = await this.#load();
		const config: Record<string, unknown> = {
			...(bootstrap?.defaults
				? {
						model: bootstrap.defaults.model,
						model_provider: bootstrap.defaults.modelProvider,
						model_reasoning_effort: bootstrap.defaults.reasoningEffort,
					}
				: {}),
			...stored.values,
		};
		const selected = bootstrap?.models.find(model => model.id === config.model);
		if (selected) {
			config.model_provider = selected.provider;
			if (stored.values.model_reasoning_effort === undefined && selected.id !== bootstrap?.defaults?.model)
				config.model_reasoning_effort = selected.defaultReasoningEffort;
		}
		return { ...stored, config };
	}
	#validate(values: Values, bootstrap: RemoteTaskSettings) {
		const model = bootstrap.models.find(model => model.id === (values.model ?? bootstrap.defaults?.model));
		if (!model) throw new ProtocolError(-32602, "Selected model is unavailable; refresh task settings");
		const effort =
			values.model_reasoning_effort ??
			(model.id === bootstrap.defaults?.model ? bootstrap.defaults.reasoningEffort : model.defaultReasoningEffort);
		if (
			!model.supportedReasoningEfforts.some(option => option.reasoningEffort === effort) &&
			!(effort === "none" && model.supportedReasoningEfforts.length === 0)
		)
			throw new ProtocolError(-32602, "Selected model does not support that reasoning effort");
		if (values.approvals_reviewer !== undefined && values.approvals_reviewer !== "user")
			throw new ProtocolError(-32602, "Unsupported approvals reviewer");
		if (values.approval_policy !== undefined && !["on-request", "never"].includes(values.approval_policy))
			throw new ProtocolError(-32602, "Unsupported approval policy");
		if (
			values.sandbox_mode !== undefined &&
			!["workspace-write", "read-only", "danger-full-access"].includes(values.sandbox_mode)
		)
			throw new ProtocolError(-32602, "Unsupported sandbox mode");
		if (
			values.approval_policy !== undefined &&
			values.sandbox_mode !== undefined &&
			values.approval_policy !== (values.sandbox_mode === "workspace-write" ? "on-request" : "never")
		)
			throw new ProtocolError(-32602, "Unsupported remote permission combination");
	}
	async write(params: Record<string, unknown>, bootstrap: RemoteTaskSettings | undefined, batch: boolean) {
		if (!bootstrap) throw new ProtocolError(-32602, "Host task settings are unavailable");
		if (params.filePath != null && params.filePath !== this.filePath)
			throw new ProtocolError(-32602, "Only the owned remote config file can be written");
		if (params.expectedVersion != null && typeof params.expectedVersion !== "string")
			throw new ProtocolError(-32602, "Invalid expected config version");
		if (params.reloadUserConfig != null && typeof params.reloadUserConfig !== "boolean")
			throw new ProtocolError(-32602, "Invalid reloadUserConfig");
		const edits = batch
			? params.edits
			: [{ keyPath: params.keyPath, value: params.value, mergeStrategy: params.mergeStrategy }];
		if (!Array.isArray(edits) || edits.length === 0 || edits.length > 32)
			throw new ProtocolError(-32602, "Invalid config edits");
		const changes: Values = {};
		for (const edit of edits) {
			if (
				!edit ||
				typeof edit !== "object" ||
				Array.isArray(edit) ||
				!keys.includes(edit.keyPath) ||
				typeof edit.value !== "string" ||
				!["replace", "upsert"].includes(edit.mergeStrategy)
			)
				throw new ProtocolError(-32602, "Unsupported config edit");
			changes[edit.keyPath as ConfigKey] = edit.value;
		}
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const directory = await lstat(this.directory);
		if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.())
			throw new ProtocolError(-32602, "Invalid remote config directory");
		return withFileLock(this.filePath, async () => {
			const current = await this.#load();
			if (params.expectedVersion != null && params.expectedVersion !== current.version)
				throw new ProtocolError(-32602, "Config changed; refresh task settings");
			const values = { ...current.values, ...changes };
			this.#validate(values, bootstrap);
			const raw = `${JSON.stringify({ schemaVersion: 1, values }, null, 2)}\n`;
			const temp = `${this.filePath}.${randomUUID()}.tmp`;
			try {
				await writeFile(temp, raw, { mode: 0o600, flag: "wx" });
				await rename(temp, this.filePath);
			} finally {
				await unlink(temp).catch(() => {});
			}
			return { status: "ok", version: digest(raw), filePath: this.filePath, overriddenMetadata: null };
		});
	}
}
