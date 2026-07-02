#!/usr/bin/env bun
/**
 * Spike: can we create a resource via the console's JSON tab instead of the
 * per-field form? Most vsui form inputs have no accessible name, so the JSON
 * editor (one field) could be a far more robust create path.
 *
 * This probe opens a resource's create form, clicks the JSON tab, and reports
 * what editor it is (Monaco / CodeMirror / ACE / textarea) + its current value,
 * so we know how to set its content. Read-only — does not save.
 *
 * Usage: bun scripts/json-spike.ts <resource>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { startBridgeServer } from "../src/browser/extension-bridge";
import { ExtensionBrowserProvider } from "../src/browser/extension-provider";

const CONSOLE_ROOT = process.env.CONSOLE_CATALOG_DIR ?? path.resolve(import.meta.dir, "../../../../console");
const NAMESPACE = process.env.XCSH_NAMESPACE ?? "demo";
const BASE_URL = (process.env.XCSH_API_URL ?? "").replace(/\/+$/, "");
process.env.XCSH_BROWSER_PROVIDER ??= "extension";

const resource = process.argv[2] ?? "ip-prefix-set";
const wf = yaml.parse(fs.readFileSync(path.join(CONSOLE_ROOT, "catalog/workflows", resource, "create.yaml"), "utf8"));
const navStep = (wf.steps ?? []).find((s: { action?: string }) => s.action === "navigate");
const addStep = (wf.steps ?? []).find((s: { selector?: string }) => /text\('Add /.test(s.selector ?? ""));
const listUrl: string = (navStep?.url ?? "").replace(/\{namespace\}/g, NAMESPACE);
const addText: string = (addStep?.selector?.match(/text\('([^']+)'\)/)?.[1] ?? "Add").trim();

const clickByText = (t: string) => `(() => {
  const t=${JSON.stringify(t)};
  const el=[...document.querySelectorAll('button,a,[role=button],span,div,li')].find(e=>{
    const own=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
    return own===t;
  }) || [...document.querySelectorAll('button,a,[role=button],span')].find(e=>e.textContent.trim()===t);
  if(el){el.click();return 'clicked '+el.tagName;} return 'NOTFOUND '+t;
})()`;

const PROBE = `(() => {
  const r = { monaco:false, codemirror:false, ace:false, textareas:0, value:null, editorKind:null };
  if (document.querySelector('.monaco-editor')) r.monaco=true;
  if (document.querySelector('.CodeMirror')) r.codemirror=true;
  if (document.querySelector('.ace_editor')) r.ace=true;
  const tas=[...document.querySelectorAll('textarea')].filter(e=>e.offsetParent!==null);
  r.textareas=tas.length;
  try {
    const aceEl=document.querySelector('.ace_editor');
    if (aceEl && aceEl.env && aceEl.env.editor){ r.editorKind='ace'; const ed=aceEl.env.editor; r.value=ed.getValue(); r.readOnly=ed.getReadOnly(); }
    else if (window.monaco && monaco.editor && monaco.editor.getModels().length){ r.editorKind='monaco'; r.value=monaco.editor.getModels()[0].getValue(); }
    else if (tas.length){ r.editorKind='textarea'; r.value=(tas[0].value||''); }
    if (r.value) r.value=r.value.slice(0,400);
    // Controls near the editor that might commit/import JSON
    r.buttons=[...document.querySelectorAll('button,a,[role=button]')].filter(b=>b.offsetParent!==null).map(b=>b.textContent.trim()).filter(t=>t&&t.length<26).slice(0,30);
  } catch(e){ r.err=String(e); }
  return JSON.stringify(r);
})()`;

function unwrapJs(content: unknown): unknown {
	const p =
		content && typeof content === "object" && "result" in (content as object)
			? (content as { result: unknown }).result
			: content;
	if (typeof p !== "string") return p;
	try {
		return JSON.parse(p);
	} catch {
		return p;
	}
}

async function main() {
	const server = await startBridgeServer();
	const provider = new ExtensionBrowserProvider({ server });
	console.log(`Acquiring ${BASE_URL} …`);
	const acquired = await provider.acquire(BASE_URL);
	try {
		await server.request("navigate", { url: `${BASE_URL}${listUrl}` }, 30000);
		await new Promise(r => setTimeout(r, 2500));
		console.log(
			"open form:",
			unwrapJs((await server.request("javascript_tool", { code: clickByText(addText) }, 15000)).content),
		);
		await new Promise(r => setTimeout(r, 3000));
		console.log(
			"click JSON tab:",
			unwrapJs((await server.request("javascript_tool", { code: clickByText("JSON") }, 15000)).content),
		);
		await new Promise(r => setTimeout(r, 2500));
		const probe = unwrapJs((await server.request("javascript_tool", { code: PROBE }, 15000)).content);
		console.log("\n=== JSON editor probe ===");
		console.log(JSON.stringify(probe, null, 2));
	} finally {
		await acquired.release().catch(() => {});
		await server.close().catch(() => {});
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
