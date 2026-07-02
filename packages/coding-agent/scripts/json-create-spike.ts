#!/usr/bin/env bun
/**
 * Spike: create ip-prefix-set via the JSON tab (ACE editor) instead of the form.
 * Sets the full spec with one ace setValue(), clicks save, reports the error
 * banner. Decisive test of whether JSON-create bypasses the no-accessible-name
 * form-selector problem. Verify creation separately via API-GET.
 */
import { startBridgeServer } from "../src/browser/extension-bridge";
import { ExtensionBrowserProvider } from "../src/browser/extension-provider";

const NAMESPACE = process.env.XCSH_NAMESPACE ?? "demo";
const BASE_URL = (process.env.XCSH_API_URL ?? "").replace(/\/+$/, "");
process.env.XCSH_BROWSER_PROVIDER ??= "extension";

const LIST_URL = `/web/workspaces/web-app-and-api-protection/namespaces/${NAMESPACE}/manage/shared_objects/ip_prefix_sets`;
const SPEC = {
	metadata: { name: "xcsh-sweep-ip-prefix-set", namespace: NAMESPACE },
	spec: { ipv4_prefixes: [{ ipv4_prefix: "10.10.0.0/24" }] },
};
const SPEC_JSON = JSON.stringify(SPEC, null, 2);

const clickByText = (t: string) => `(() => {
  const t=${JSON.stringify(t)};
  const el=[...document.querySelectorAll('button,a,[role=button],span')].find(e=>e.textContent.trim()===t)
    || [...document.querySelectorAll('button,a,[role=button],span')].find(e=>e.textContent.trim().includes(t));
  if(el){el.click();return 'clicked '+el.tagName;} return 'NOTFOUND '+t;
})()`;

const SET_ACE = `(() => {
  const el=document.querySelector('.ace_editor');
  if(!el||!el.env||!el.env.editor) return 'NO_ACE';
  const ed=el.env.editor;
  ed.setValue(${JSON.stringify(SPEC_JSON)}, -1);
  // Simulate a real edit so the console's change handler commits JSON->model:
  ed.focus(); ed.navigateFileEnd(); ed.insert(' '); ed.remove('left');
  return 'set:'+ed.getValue().length+'chars';
})()`;

const READ_FORM = `(() => {
  const name=document.querySelector("input[aria-label='Name']");
  const all=[...document.querySelectorAll('input')].filter(e=>e.offsetParent!==null).map(e=>({a:e.getAttribute('aria-label'),v:(e.value||'').slice(0,40)}));
  return JSON.stringify({ nameVal: name? name.value: 'NO_NAME_INPUT', inputs: all });
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
	const acquired = await provider.acquire(BASE_URL);
	const js = (code: string) => server.request("javascript_tool", { code }, 15000).then(r => unwrapJs(r.content));
	const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
	const present = (t: string) =>
		js(
			`(()=>{const b=[...document.querySelectorAll('button,a,span')].find(e=>(e.textContent||'').trim().includes(${JSON.stringify(t)}));return b?'YES':'no';})()`,
		);
	const waitFor = async (t: string, secs = 25) => {
		for (let i = 0; i < secs; i++) {
			if ((await present(t)) === "YES") return true;
			await sleep(1000);
		}
		return false;
	};
	try {
		// Robust open: navigate (retry up to 3×) and POLL for the list to render
		// before clicking — the SPA intermittently shows the workspace picker.
		let opened = false;
		for (let attempt = 0; attempt < 3 && !opened; attempt++) {
			await server.request("navigate", { url: `${BASE_URL}${LIST_URL}` }, 30000);
			opened = await waitFor("Add IP Prefix Set", 20);
			console.log(`navigate attempt ${attempt + 1}: list rendered=${opened}`);
		}
		if (!opened) {
			console.log("LIST NEVER RENDERED — aborting");
			return;
		}
		console.log("open:", await js(clickByText("Add IP Prefix Set")));
		await waitFor("JSON", 15);
		console.log("json tab:", await js(clickByText("JSON")));
		await new Promise(r => setTimeout(r, 2000));
		console.log("set ace:", await js(SET_ACE));
		await sleep(2000);
		// Switching to Form COMMITS JSON->model (proven). With a valid schema there's
		// no error modal, so the model populates and we can save from the Form tab.
		console.log("form tab:", await js(clickByText("Form")));
		await sleep(3000);
		console.log("FORM AFTER COMMIT:", await js(READ_FORM));
		const SAVE = `(()=>{const btns=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null);
		  const b=btns.find(x=>/save-btn/.test(x.className||'')) || btns.filter(x=>/Add IP Prefix Set/i.test(x.textContent||'')).pop();
		  if(b){b.click();return 'saved:'+(b.className||b.tagName);}return 'NO_SAVE';})()`;
		console.log("save:", await js(SAVE));
		await sleep(6000);
		console.log("final url:", await js("(()=>location.href)()"));
	} finally {
		await acquired.release().catch(() => {});
		await server.close().catch(() => {});
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
