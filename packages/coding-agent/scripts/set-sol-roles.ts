import { Settings } from "../src/config/settings";

const provider = process.argv[2];
if (provider !== "litellm" && provider !== "openai-codex") throw new Error("Select litellm or openai-codex");
const settings = await Settings.init();
const roles = {
	...settings.getModelRoles(),
	default: `${provider}/gpt-6.1-sol:medium`,
	slow: `${provider}/gpt-6.1-sol:high`,
	plan: `${provider}/gpt-6.1-sol:high`,
};
settings.set("modelRoles", roles);
await settings.flush({ throwOnError: true });
console.log(JSON.stringify({ provider, modelRoles: settings.getModelRoles() }));
