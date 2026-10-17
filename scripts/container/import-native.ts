import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

// Native account state, plugins, memories, and executable credential commands are never copied.
export function routingConfig(models: Record<string, unknown>, config: Record<string, unknown>) {
	const providers = structuredClone(models.providers ?? {}) as Record<string, Record<string, unknown>>;
	for (const [name, provider] of Object.entries(providers)) {
		const sanitize = (object: Record<string, unknown> | unknown[]) => {
			for (const [key, value] of Object.entries(object)) {
				if (typeof value === "string" && /apiKey|token|secret|password|authorization/i.test(key)) {
					if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
						(object as Record<string, unknown>)[key] = ["litellm", "anthropic"].includes(name)
							? "LITELLM_API_KEY"
							: `XCSH_PROVIDER_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
					}
				} else if (value && typeof value === "object") {
					sanitize(value as Record<string, unknown>);
				}
			}
		};
		sanitize(provider);
	}
	const settings: Record<string, unknown> = {};
	for (const key of ["modelRoles", "disabledProviders", "routing", "providers", "modelProviderAllowlist"]) {
		if (config[key] !== undefined) settings[key] = config[key];
	}
	settings.browser = { headless: true };
	return { models: { configVersion: models.configVersion, providers }, settings };
}

if (import.meta.main) {
	const input = "/imports/native";
	const destination = join(process.env.HOME!, ".xcsh", "agent");
	await mkdir(destination, { recursive: true, mode: 0o700 });
	const models = Bun.YAML.parse(await Bun.file(join(input, "models.yml")).text()) as Record<string, unknown>;
	const configFile = Bun.file(join(input, "config.yml"));
	const config = (await configFile.exists())
		? (Bun.YAML.parse(await configFile.text()) as Record<string, unknown>)
		: {};
	const output = routingConfig(models, config);
	for (const [name, value] of [
		["models.yml", output.models],
		["config.yml", output.settings],
	] as const) {
		try {
			const staging = join(destination, `.${name}.${randomUUID()}.tmp`);
			const file = await open(staging, "wx", 0o600);
			try {
				await file.writeFile(Bun.YAML.stringify(value));
				await file.sync();
			} finally {
				await file.close();
			}
			try {
				await link(staging, join(destination, name));
			} finally {
				await unlink(staging);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}
