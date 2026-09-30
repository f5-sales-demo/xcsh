import { isAbsolute } from "node:path";

export function solUatLaunch(provider: string, args: string[]) {
	const option = (name: string) => {
		const index = args.indexOf(name);
		if (index === -1) return undefined;
		const value = args[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
		return value;
	};
	const executable = option("--executable");
	if (executable && !isAbsolute(executable)) throw new Error("Installed executable must be an absolute path");
	const modelId = option("--model-id") ?? "gpt-6.1-sol";
	const modelOverride = !args.includes("--saved-role");
	return {
		argv: [
			...(executable ? [executable] : ["bun", "run", "dev"]),
			...(modelOverride ? ["--model", `${provider}/${modelId}`, "--thinking", "medium"] : []),
		],
		modelId,
		modelOverride,
	};
}
