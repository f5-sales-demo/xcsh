/**
 * Create a resource via the console's JSON tab (form-bypass), driving the Chrome
 * extension over the bridge. Proven recipe (see scripts/json-create-spike.ts):
 *   robust-open (navigate + poll for the Add button, retry)
 *   → click "Add <Resource>" → click JSON tab
 *   → ace.setValue(spec) + a simulated keystroke
 *   → click the Form tab (COMMITS JSON→model; valid schema = no error modal)
 *   → click the footer save-btn
 * The caller verifies creation independently (API-GET strict cross-check).
 *
 * This sidesteps the vsui no-accessible-name form-selector problem: the JSON
 * editor is ONE field instead of dozens of unaddressable ones.
 */

/** Minimal slice of the extension bridge this module needs (BridgeServer satisfies it). */
export interface Bridge {
	readonly connected: boolean;
	request(tool: string, params: unknown, timeoutMs?: number): Promise<{ content: unknown; is_error: boolean }>;
}

export interface JsonCreateOpts {
	baseUrl: string;
	listUrl: string; // path opening the resource list (workspace), {namespace} already substituted
	addText: string; // exact label of the "Add <Resource>" button
	name: string;
	namespace: string;
	spec: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

const clickByText = (t: string) => `(() => {
  const t=${JSON.stringify(t)};
  const el=[...document.querySelectorAll('button,a,[role=button],span')].find(e=>e.textContent.trim()===t)
    || [...document.querySelectorAll('button,a,[role=button],span')].find(e=>e.textContent.trim().includes(t));
  if(el){el.click();return 'clicked';} return 'NOTFOUND';
})()`;

const presentByText = (t: string) => `(() => {
  const t=${JSON.stringify(t)};
  return [...document.querySelectorAll('button,a,span')].some(e=>(e.textContent||'').trim().includes(t)) ? 'YES':'no';
})()`;

const setAce = (specJson: string) => `(() => {
  const el=document.querySelector('.ace_editor');
  if(!el||!el.env||!el.env.editor) return 'NO_ACE';
  const ed=el.env.editor;
  ed.setValue(${JSON.stringify(specJson)}, -1);
  ed.focus(); ed.navigateFileEnd(); ed.insert(' '); ed.remove('left');
  return 'set';
})()`;

const SAVE = `(() => {
  const btns=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null);
  const b=btns.find(x=>/save-btn/.test(x.className||''))
    || [...document.querySelectorAll("[class*='save-bt'],[class*='submit-button']")].pop();
  if(b){b.click();return 'saved';} return 'NO_SAVE';
})()`;

const ERROR_BANNER = `(() => {
  const b=[...document.querySelectorAll('*')].find(e=>{
    if(e.tagName==='STYLE'||e.tagName==='SCRIPT') return false;
    if(e.offsetParent===null) return false;            // must be visible
    const t=(e.textContent||'').trim();
    return t.length<300 && /We found \\d+ error/i.test(t) && e.children.length<5;
  });
  return b ? (b.textContent||'').trim().slice(0,160) : '';
})()`;

export async function jsonCreate(bridge: Bridge, opts: JsonCreateOpts): Promise<{ ok: boolean; error?: string }> {
	// Wait for the extension to connect to the bridge (handles initial connect +
	// mid-sweep reconnects) — server.request fails fast with "no client connected".
	for (let i = 0; i < 45 && !bridge.connected; i++) await sleep(1000);
	if (!bridge.connected) return { ok: false, error: "extension not connected to bridge" };

	const js = async (code: string): Promise<unknown> =>
		unwrapJs((await bridge.request("javascript_tool", { code }, 15000)).content);
	const waitFor = async (text: string, secs = 20): Promise<boolean> => {
		for (let i = 0; i < secs; i++) {
			if ((await js(presentByText(text))) === "YES") return true;
			await sleep(1000);
		}
		return false;
	};

	// Robust open: navigate + poll for the Add button (SPA sometimes shows the picker).
	let opened = false;
	for (let attempt = 0; attempt < 3 && !opened; attempt++) {
		await bridge.request("navigate", { url: `${opts.baseUrl}${opts.listUrl}` }, 30000);
		opened = await waitFor(opts.addText, 18);
	}
	if (!opened) return { ok: false, error: `list never rendered (${opts.addText})` };

	if ((await js(clickByText(opts.addText))) === "NOTFOUND") return { ok: false, error: "Add button not found" };
	if (!(await waitFor("JSON", 12))) return { ok: false, error: "JSON tab not found" };
	await js(clickByText("JSON"));
	await sleep(1500);

	const body = { metadata: { name: opts.name, namespace: opts.namespace }, spec: opts.spec };
	const setRes = await js(setAce(JSON.stringify(body, null, 2)));
	if (setRes === "NO_ACE") return { ok: false, error: "ACE editor not found" };
	await sleep(1500);

	// Commit JSON→model via the Form tab, then save.
	await js(clickByText("Form"));
	await sleep(2500);
	const banner = await js(ERROR_BANNER);
	if (typeof banner === "string" && banner) return { ok: false, error: `error after commit: ${banner}` };
	if ((await js(SAVE)) === "NO_SAVE") return { ok: false, error: "save button not found" };
	await sleep(5000);
	return { ok: true };
}
