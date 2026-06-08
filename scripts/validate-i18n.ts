#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";

const LOCALES_DIR = path.join(import.meta.dirname, "../packages/coding-agent/src/locales");

const enPath = path.join(LOCALES_DIR, "en.json");
const enKeys = Object.keys(JSON.parse(fs.readFileSync(enPath, "utf-8")) as Record<string, string>);

const localeFiles = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith(".json") && f !== "en.json");
let warnings = 0;

for (const file of localeFiles) {
	const locale = file.replace(".json", "");
	const content = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf-8")) as Record<string, string>;
	const localeKeys = Object.keys(content);

	const missing = enKeys.filter(k => !localeKeys.includes(k));
	const extra = localeKeys.filter(k => !enKeys.includes(k));

	if (missing.length > 0) {
		console.warn(`[${locale}] Missing ${missing.length} keys: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`);
		warnings += missing.length;
	}
	if (extra.length > 0) {
		console.warn(`[${locale}] Extra ${extra.length} keys: ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? "..." : ""}`);
		warnings += extra.length;
	}
	if (missing.length === 0 && extra.length === 0) {
		console.log(`[${locale}] OK (${localeKeys.length} keys)`);
	}
}

console.log(`\nValidation complete: ${enKeys.length} source keys, ${localeFiles.length} locales, ${warnings} warnings`);
if (warnings > 0) {
	process.exit(1);
}
