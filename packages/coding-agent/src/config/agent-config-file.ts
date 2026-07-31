import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent } from "@f5-sales-demo/pi-utils";

const AGENT_CONFIG_DIR_MODE = 0o700;
const AGENT_CONFIG_FILE_MODE = 0o600;

export function hardenAgentConfigFileSync(filePath: string): void {
	try {
		fs.chmodSync(filePath, AGENT_CONFIG_FILE_MODE);
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}
}

export async function hardenAgentConfigFile(filePath: string): Promise<void> {
	try {
		await fs.promises.chmod(filePath, AGENT_CONFIG_FILE_MODE);
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}
}

export function writeAgentConfigFileSync(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: AGENT_CONFIG_DIR_MODE });
	hardenAgentConfigFileSync(filePath);
	fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: AGENT_CONFIG_FILE_MODE });
}

export async function writeAgentConfigFile(filePath: string, content: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: AGENT_CONFIG_DIR_MODE });
	await hardenAgentConfigFile(filePath);
	await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: AGENT_CONFIG_FILE_MODE });
}
