import * as fs from "node:fs";
import packageJson from "../../package.json";

const version = packageJson.version;

globalThis.fetch = (async (input: string | URL | Request) => {
	const marker = process.env.XCSH_UPDATE_FETCH_MARKER;
	if (marker) fs.writeFileSync(marker, "fetch called\n");

	const url = String(input);
	if (url === "https://registry.npmjs.org/@f5-sales-demo/xcsh/latest") {
		return Response.json({ version });
	}
	if (url.includes("/releases/download/") && url.includes("/xcsh-")) {
		return new Response(`#!/bin/sh\nprintf 'xcsh/${version}\\n'\n`, { status: 200 });
	}
	throw new Error(`Unexpected update test URL: ${url}`);
}) as typeof fetch;
