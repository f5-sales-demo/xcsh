#!/usr/bin/env bun
/**
 * Live form inspector. Opens a resource's create form via the Chrome extension
 * and dumps the REAL attributes of every visible input/select (role, aria-label,
 * name, placeholder, id, class, nearest label) — so we author selectors from
 * ground truth instead of guessing `role[name='VisibleLabel']` (which fails when
 * the input has no accessible name matching its column header / field label).
 *
 * Uses javascript_tool (read_ax freezes on heavy console forms).
 *
 * Usage:
 *   XCSH_BROWSER_PROVIDER=extension XCSH_API_URL=… XCSH_USERNAME=… \
 *   XCSH_CONSOLE_PASSWORD=… XCSH_NAMESPACE=demo \
 *   bun scripts/inspect-form.ts <resource>
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

const resource = process.argv[2];
if (!resource) {
	console.error("usage: bun scripts/inspect-form.ts <resource>");
	process.exit(1);
}

const wf = yaml.parse(fs.readFileSync(path.join(CONSOLE_ROOT, "catalog/workflows", resource, "create.yaml"), "utf8"));
const navStep = (wf.steps ?? []).find((s: { action?: string }) => s.action === "navigate");
const addStep = (wf.steps ?? []).find((s: { selector?: string }) => /text\('Add /.test(s.selector ?? ""));
const listUrl: string = (navStep?.url ?? "").replace(/\{namespace\}/g, NAMESPACE);
const addText: string = (addStep?.selector?.match(/text\('([^']+)'\)/)?.[1] ?? "Add").trim();

const DUMP = `(() => {
  const sel = 'input,select,textarea,[role=spinbutton],[role=combobox],[role=textbox],[role=listbox]';
  const labelFor = (e) => {
    if (e.getAttribute('aria-labelledby')) { const l=document.getElementById(e.getAttribute('aria-labelledby')); if(l) return l.textContent.trim().slice(0,40); }
    const lab = e.closest('label') || (e.id && document.querySelector('label[for=\\''+e.id+'\\']'));
    if (lab) return lab.textContent.trim().slice(0,40);
    let p=e.parentElement, hops=0; while(p&&hops<4){const h=p.querySelector('label,.field-label,[class*=label]');if(h&&h.textContent.trim())return h.textContent.trim().slice(0,40);p=p.parentElement;hops++;}
    return null;
  };
  const section=(e)=>{let p=e;while(p&&p.tagName!=='BODY'){const h=p.querySelector&&p.querySelector('.section-header,[class*=section] h3,[class*=section] h4,h3,h4');if(h&&h.textContent.trim())return h.textContent.trim().slice(0,30);p=p.parentElement;}return null;};
  const out=[...document.querySelectorAll(sel)].map(e=>{
    const r=e.getBoundingClientRect();
    return {
      vis:e.offsetParent!==null,
      tag:e.tagName.toLowerCase(), type:e.getAttribute('type'), role:e.getAttribute('role'),
      ariaLabel:e.getAttribute('aria-label'), name:e.getAttribute('name'),
      placeholder:e.getAttribute('placeholder'), id:e.id||null,
      e2e:e.getAttribute('ves-e2e-test'), testid:e.getAttribute('data-testid'),
      cls:(e.className||'').slice(0,50), label:labelFor(e), section:section(e),
      dt:!!e.closest('ngx-datatable'), cell:!!e.closest('datatable-body-cell'),
      xy:[Math.round(r.left),Math.round(r.top)],
    };
  });
  return JSON.stringify(out);
})()`;

const CLICK_ADD = `(() => {
  const t=${JSON.stringify(addText)};
  const el=[...document.querySelectorAll('button,a,[role=button],span')].find(e=>e.textContent && e.textContent.trim()===t)
    || [...document.querySelectorAll('button,a,[role=button],span')].find(e=>e.textContent && e.textContent.trim().includes(t));
  if(el){el.click();return 'clicked: '+el.tagName;} return 'NOTFOUND: '+t;
})()`;

function unwrapJs(content: unknown): unknown {
	const payload =
		content && typeof content === "object" && "result" in (content as object)
			? (content as { result: unknown }).result
			: content;
	if (typeof payload !== "string") return payload;
	try {
		return JSON.parse(payload);
	} catch {
		return payload; // plain string result (e.g. the click ack)
	}
}

async function main() {
	const server = await startBridgeServer();
	const provider = new ExtensionBrowserProvider({ server });
	console.log(`Acquiring (login) ${BASE_URL} …`);
	const acquired = await provider.acquire(BASE_URL);
	try {
		console.log(`Navigate: ${BASE_URL}${listUrl}`);
		await server.request("navigate", { url: `${BASE_URL}${listUrl}` }, 30000);
		await new Promise(r => setTimeout(r, 2500));
		const clicked = await server.request("javascript_tool", { code: CLICK_ADD }, 15000);
		console.log(`Open form (${addText}):`, unwrapJs(clicked.content));
		await new Promise(r => setTimeout(r, 3500));
		// If the form has an "Add Item" button (datatable), click it to instantiate the row input.
		const ai = await server.request(
			"javascript_tool",
			{
				code: `(()=>{const b=[...document.querySelectorAll('button,a,span')].find(e=>e.textContent.trim()==='Add Item');if(b){b.click();return 'clicked-add-item';}return 'no-add-item';})()`,
			},
			15000,
		);
		console.log("Add Item:", unwrapJs(ai.content));
		await new Promise(r => setTimeout(r, 2500));
		const dump = await server.request("javascript_tool", { code: DUMP }, 15000);
		const inputs = unwrapJs(dump.content) as Array<Record<string, unknown>>;
		console.log(`\n=== ${resource}: ${inputs.length} visible inputs ===`);
		for (const i of inputs) {
			console.log(
				`  ${i.vis ? "VIS" : "hid"} <${i.tag}${i.type ? ` type=${i.type}` : ""}> @${JSON.stringify(i.xy)} ` +
					`aria=${JSON.stringify(i.ariaLabel)} ph=${JSON.stringify(i.placeholder)} ` +
					`e2e=${JSON.stringify(i.e2e)} dt=${i.dt} cell=${i.cell}\n      cls=${JSON.stringify(i.cls)}`,
			);
		}
	} finally {
		await acquired.release().catch(() => {});
		await server.close().catch(() => {});
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
