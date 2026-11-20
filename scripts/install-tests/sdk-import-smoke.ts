import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const installed = resolve(process.argv[2]);
const sdk = await import(pathToFileURL(installed + "/src/index.ts").href);
if (typeof sdk.createAgentSession !== "function") throw Error("Installed public SDK session export missing");
console.log(JSON.stringify({ installedSdkImported: true }));
