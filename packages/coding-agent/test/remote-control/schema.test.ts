import { expect, test } from "bun:test";
import Ajv from "ajv";
import { configResponse, modelResponse } from "../../src/remote-control/metadata";
import { RemoteRouter } from "../../src/remote-control/router";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import configSchema from "./fixtures/ConfigReadResponse.json";
import initializeSchema from "./fixtures/InitializeResponse.json";
import modelSchema from "./fixtures/ModelListResponse.json";
import listSchema from "./fixtures/ThreadListResponse.json";

test("initialization and live thread payload match pinned upstream schemas", async () => {
	const ajv = new Ajv({ strict: false });
	for (const name of ["int32", "int64", "uint", "uint16", "uint32", "uint64"])
		ajv.addFormat(name, {
			type: "number",
			validate: (value: number) => Number.isSafeInteger(value) && (!name.startsWith("u") || value >= 0),
		});
	for (const [schema, response] of [
		[configSchema, configResponse({ model: "gpt-6-astra", modelProvider: "openai-codex" }, true)],
		[modelSchema, modelResponse([{ model: "gpt-6-astra" }])],
	] as const) {
		const validate = ajv.compile(schema);
		expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
	}
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const initialized = (await router.handle("fixture", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	})) as { result: unknown };
	const validInit = ajv.compile(initializeSchema);
	expect(validInit(initialized.result), JSON.stringify(validInit.errors)).toBe(true);
	const remote = new RemoteSession({
		sessionId: "fixture",
		sessionName: "Fixture",
		messages: [],
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
	} as unknown as SessionTarget);
	try {
		const validList = ajv.compile(listSchema);
		expect(validList({ data: [remote.thread()], nextCursor: null }), JSON.stringify(validList.errors)).toBe(true);
	} finally {
		remote.dispose();
	}
});
