/**
 * Extension-backed {@link PageActions} implementation.
 *
 * Resolves catalogue workflow selectors **without a full `read_ax`** — instead
 * of serializing the entire AX tree (which FREEZES the MV3 service worker on
 * heavy create forms), each interaction asks the in-page DOM for the ONE
 * element that matches the selector, scrolls it into view, and returns its
 * viewport-center coords. Then `click_xy` / `type_text` dispatch a trusted CDP
 * action — trusted events fire inside Angular's NgZone, so vsui dropdowns,
 * form submit, and the console's reactive forms all work.
 *
 * **Selector grammar** (matches the catalogue YAML + the AX resolver):
 *   - `text('X')`             — element whose textContent includes X.
 *   - `role:text('X')`        — element of `role` (tag-derived) with text X.
 *   - `role[name='X']`        — input/control whose label/name/aria matches X.
 *   - bare `role`             — first element of that role.
 *   - anything else           — CSS querySelector.
 *
 * This approach was validated by the manual full-UI CRUD smoke (login → create
 * health-check via form → delete via kebab → verify) which used javascript_tool
 * + click_xy/type_text to bypass the read_ax freeze.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionPage } from "./extension-provider";
import type { PageActions } from "./page-actions";

const ALLOWED_SCHEMES = new Set(["https:"]);
const CONSOLE_DOMAIN_RE = /\.(volterra\.us|console\.ves\.volterra\.io)$/;

/**
 * A self-contained in-page resolver: given a catalogue selector string, finds
 * the matching element, scrolls it into view, and returns its viewport-center
 * coords. Runs entirely via `javascript_tool` — one small returnByValue, no
 * full AX serialization.
 */
function buildResolverScript(selector: string): string {
	// Escape for JSON-safe embedding. The script returns JSON {x,y,found,tag,txt} or {found:false,error}.
	const sel = JSON.stringify(selector);
	return `(()=>{
const sel=${sel};
function roleToSelector(role){
  switch(role){
    case'button':return'button,input[type=button],input[type=submit],[role=button]';
    case'link':return'a[href],[role=link]';
    case'tab':return'[role=tab]';
    case'textbox':return'input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]),textarea,[role=textbox]';
    case'spinbutton':return'input[type=number],[role=spinbutton]';
    case'checkbox':return'input[type=checkbox],[role=checkbox]';
    case'radio':return'input[type=radio],[role=radio]';
    case'combobox':return'select,[role=combobox]';
    case'listbox':return'[role=listbox],select';
    case'option':return'[role=option],option';
    case'heading':return'h1,h2,h3,h4,h5,h6,[role=heading]';
    case'menuitem':return'[role=menuitem]';
    case'dialog':return'dialog,[role=dialog],[role=alertdialog]';
    case'navigation':return'nav,[role=navigation]';
    case'table':return'table,[role=table]';
    case'row':return'tr,[role=row],datatable-body-row';
    case'cell':return'td,th,[role=cell],[role=gridcell],[role=columnheader]';
    case'img':return'img,[role=img]';
    case'switch':return'[role=switch]';
    default:return'[role='+role+']';
  }
}
function findByText(text,roleSel){
  const candidates=roleSel?[...document.querySelectorAll(roleSel)]:[...document.querySelectorAll('*')];
  const norm=t=>t.replace(/\\u0421/g,'C').replace(/\\s+/g,' ').trim();
  const want=norm(text);
  // Prefer an EXACT text match (avoids 'Delete' matching 'Delete selected', or a
  // header tab vs footer save button). Fall back to substring only if no exact.
  const exact=candidates.filter(e=>norm(e.textContent||'')===want);
  if(exact.length)return exact[0]; // exact match (e.g. 'Delete' not 'Delete selected') in DOM order
  return candidates.find(e=>norm(e.textContent||'').includes(want));
}
function findByRoleName(role,name){
  const roleSel=roleToSelector(role);
  const candidates=[...document.querySelectorAll(roleSel)];
  const norm=t=>t.replace(/\\s+/g,' ').trim();
  const want=norm(name);
  return candidates.find(e=>{
    const n=norm(e.getAttribute('aria-label')||e.getAttribute('name')||e.getAttribute('placeholder')||e.textContent||'');
    return n===want||n.includes(want);
  })||(role==='textbox'?candidates.find(e=>{
    const lbl=(e.closest('[class*=form-group],[class*=field],.row')||{}).textContent||'';
    return norm(lbl).includes(want);
  }):null);
}
// Row-scoping: "row:has-text('NAME') >> <subSelector>" finds the table row
// containing NAME, then resolves <subSelector> WITHIN that row. Essential for
// per-row actions (kebab/Delete) when a list has many rows.
function findInScope(s){
  const textM=s.match(/^text\\('([^']*)'\\)$/);
  const roleTextM=s.match(/^([a-z]+):text\\('([^']*)'\\)$/);
  const roleNameM=s.match(/^([a-z]+)\\[name='([^']*)'\\]$/);
  const bareRoleM=s.match(/^[a-z]+$/);
  if(textM)return findByText(textM[1]);
  if(roleTextM)return findByText(roleTextM[2],roleToSelector(roleTextM[1]));
  if(roleNameM)return findByRoleName(roleNameM[1],roleNameM[2]);
  if(bareRoleM)return document.querySelector(roleToSelector(s));
  return document.querySelector(s);
}
let el=null;
if(sel.includes('>>')){
  const parts=sel.split('>>').map(p=>p.trim());
  const rowM=parts[0].match(/^row:has-text\\('([^']*)'\\)$/);
  const want=rowM?rowM[1].replace(/\\u0421/g,'C'):'';
  const rows=[...document.querySelectorAll('tr,[role=row],datatable-body-row')];
  const row=rows.find(r=>(r.textContent||'').replace(/\\u0421/g,'C').includes(want));
  if(!row)return JSON.stringify({found:false,error:'no row matching '+parts[0]});
  // resolve the sub-selector within the row
  const subTextM=parts[1].match(/^([a-z]+):text\\('([^']*)'\\)$/);
  if(subTextM){const want2=subTextM[2];const cs=[...row.querySelectorAll(roleToSelector(subTextM[1]))];const nm=t=>t.replace(/\\s+/g,' ').trim();el=cs.find(e=>nm(e.textContent||'')===want2)||cs.find(e=>nm(e.textContent||'').includes(want2));}
  else{el=row.querySelector(parts[1]);}
  if(!el)return JSON.stringify({found:false,error:'sub-selector '+parts[1]+' not found in row'});
}else{
  el=findInScope(sel);
}
if(!el)return JSON.stringify({found:false,error:'no match for '+sel});
el.scrollIntoView({block:'center',inline:'center'});
const r=el.getBoundingClientRect();
return JSON.stringify({found:true,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),tag:el.tagName,txt:(el.textContent||'').trim().slice(0,30)});
})()`;
}

/**
 * Run a `javascript_tool` snippet whose body returns a JSON string, and parse it.
 * The bridge's `javascript_tool` wraps the evaluated value as `{ result: <value> }`,
 * so unwrap `.result` first; tolerate either the wrapper, a bare string, or a bare
 * object so this works against the real BridgeExtensionPage AND test doubles.
 */
async function evalJson(ext: ExtensionPage, code: string): Promise<any> {
	const raw = await ext.javascriptTool(code);
	const payload =
		raw && typeof raw === "object" && "result" in (raw as object) ? (raw as { result: unknown }).result : raw;
	return typeof payload === "string" ? JSON.parse(payload) : payload;
}

/** Resolve a selector to viewport-center coords via `javascript_tool`. */
async function resolveCoords(ext: ExtensionPage, selector: string): Promise<{ x: number; y: number }> {
	const result = await evalJson(ext, buildResolverScript(selector));
	if (!result?.found) {
		throw new Error(`selector "${selector}" not found in the page: ${result?.error ?? "no match"}`);
	}
	return { x: result.x as number, y: result.y as number };
}

/**
 * Fill a field located by selector: find it → focus → set value via the
 * framework-safe native-setter technique → dispatch events to commit to
 * Angular's form model. Runs entirely via `javascript_tool`, never serializing
 * the whole AX tree. The selector-matching logic is inlined (same grammar as
 * buildResolverScript) so the fill runs as a single, self-contained eval.
 */
function buildFillScript(selector: string, value: string): string {
	const sel = JSON.stringify(selector);
	const val = JSON.stringify(value);
	return `(()=>{
const sel=${sel};
function roleToSel(r){const m={button:'button,input[type=button],input[type=submit],[role=button]',link:'a[href],[role=link]',tab:'[role=tab]',textbox:'input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]),textarea,[role=textbox]',spinbutton:'input[type=number],[role=spinbutton]',checkbox:'input[type=checkbox],[role=checkbox]',combobox:'select,[role=combobox]',listbox:'[role=listbox],select',option:'[role=option],option',heading:'h1,h2,h3,h4,h5,h6,[role=heading]'};return m[r]||'[role='+r+']';}
function norm(t){return t.replace(/\\u0421/g,'C').replace(/\\s+/g,' ').trim();}
function findText(text,rSel){return(rSel?[...document.querySelectorAll(rSel)]:[...document.querySelectorAll('*')]).find(e=>{const n=norm(e.textContent||'');return n===norm(text)||n.includes(norm(text));});}
function findRoleName(role,name){const cs=[...document.querySelectorAll(roleToSel(role))];const w=norm(name);return cs.find(e=>norm(e.getAttribute('aria-label')||e.getAttribute('name')||e.getAttribute('placeholder')||e.textContent||'').includes(w))||(role==='textbox'?cs.find(e=>norm((e.closest('[class*=form-group],[class*=field],.row')||{}).textContent||'').includes(w)):null);}
let el=null;
const tm=sel.match(/^text\\('([^']*)'\\)$/),rtm=sel.match(/^([a-z]+):text\\('([^']*)'\\)$/),rnm=sel.match(/^([a-z]+)\\[name='([^']*)'\\]$/),br=sel.match(/^[a-z]+$/);
if(tm)el=findText(tm[1]);else if(rtm)el=findText(rtm[2],roleToSel(rtm[1]));else if(rnm)el=findRoleName(rnm[1],rnm[2]);else if(br)el=document.querySelector(roleToSel(sel));else el=document.querySelector(sel);
if(!el)return JSON.stringify({filled:false,error:'selector not found: '+sel});
el.scrollIntoView({block:'center',inline:'center'});el.focus();
let p=Object.getPrototypeOf(el),d;while(p){d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set)break;p=Object.getPrototypeOf(p);}
const v=${val};d&&d.set?d.set.call(el,v):el.value=v;
for(const ev of['input','change','blur','focusout'])el.dispatchEvent(new Event(ev,{bubbles:true}));
return JSON.stringify({filled:true,val:el.value});
})()`;
}

export class ExtensionPageActions implements PageActions {
	#ext: ExtensionPage;

	constructor(ext: ExtensionPage) {
		this.#ext = ext;
	}

	async goto(url: string): Promise<void> {
		const parsed = new URL(url);
		if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
			throw new Error(`Disallowed URL scheme: ${parsed.protocol} (only https: is allowed)`);
		}
		if (!CONSOLE_DOMAIN_RE.test(parsed.hostname)) {
			throw new Error(`URL "${parsed.hostname}" is not an F5 XC console domain`);
		}
		await this.#ext.navigate(url);
	}

	async click(selector: string, _context?: string): Promise<void> {
		const { x, y } = await resolveCoords(this.#ext, selector);
		await this.#ext.clickXy(x, y);
	}

	async fill(selector: string, value: string, _context?: string): Promise<void> {
		const result = await evalJson(this.#ext, buildFillScript(selector, value));
		if (!result?.filled) {
			throw new Error(`fill("${selector}"): ${result?.error ?? "could not set value"}`);
		}
	}

	async selectOption(selector: string, value: string, _context?: string): Promise<void> {
		// F5 XC vsui listboxes are <input role="listbox"> — clicking opens the
		// panel, and typing FILTERS the options (the target option often isn't in
		// the initial set). So: focus → type to filter → click the matching option.
		// Bound every sub-step so a frozen/blocking dropdown can never hang the whole
		// workflow — the option set may load async, and many selects have a sensible
		// default, so option selection is best-effort.
		const withTimeout = <R>(p: Promise<R>, ms: number, label: string): Promise<R> =>
			Promise.race([
				p,
				new Promise<R>((_, rej) =>
					setTimeout(() => rej(new Error(`selectOption ${label} timed out after ${ms}ms`)), ms),
				),
			]);
		const { x, y } = await withTimeout(resolveCoords(this.#ext, selector), 10_000, "resolve-listbox");
		await withTimeout(this.#ext.clickXy(x, y), 10_000, "click-listbox");
		await new Promise(r => setTimeout(r, 800));
		try {
			await withTimeout(this.#ext.typeText(value), 8_000, "type");
			await new Promise(r => setTimeout(r, 1200));
		} catch {
			/* not a text-filterable widget */
		}
		// Click the option whose text matches value (exact-first via the resolver).
		// Best-effort: if it never renders, fall through — the default value usually
		// already applies, and a hard failure here would block create flows.
		try {
			const optCoords = await withTimeout(
				resolveCoords(this.#ext, `option:text('${value}')`),
				10_000,
				"resolve-option",
			);
			await withTimeout(this.#ext.clickXy(optCoords.x, optCoords.y), 10_000, "click-option");
			await new Promise(r => setTimeout(r, 600));
		} catch {
			// Option not selectable (already default, or non-standard widget) — press
			// Escape to dismiss any open overlay and continue.
			await this.#ext.keyPress("Escape").catch(() => {});
		}
	}

	async scrollIntoView(selector: string, _context?: string): Promise<void> {
		// resolveCoords already does scrollIntoView.
		await resolveCoords(this.#ext, selector);
	}

	async pressKey(key: string): Promise<void> {
		await this.#ext.keyPress(key);
	}

	async assertText(selector: string, expected: string, _context?: string): Promise<void> {
		// Use javascript_tool to check text presence (avoids read_ax freeze).
		const result = await evalJson(this.#ext, buildResolverScript(selector));
		if (!result?.found) throw new Error(`assertText: selector "${selector}" not found`);
		const txt = result.txt ?? "";
		if (!txt.includes(expected)) {
			throw new Error(`assertText: expected "${expected}" not found in "${txt}"`);
		}
	}

	async waitFor(selector: string, _context?: string, timeoutMs?: number): Promise<void> {
		// Poll via javascript_tool (not read_ax, which freezes on heavy forms).
		const ms = timeoutMs ?? 30_000;
		const deadline = Date.now() + ms;
		while (Date.now() < deadline) {
			try {
				await resolveCoords(this.#ext, selector);
				return; // found
			} catch {
				await new Promise(r => setTimeout(r, 1000));
			}
		}
		throw new Error(`waitFor "${selector}" timed out after ${ms}ms`);
	}

	async screenshot(file: string): Promise<void> {
		const cwdReal = fs.realpathSync(process.cwd());
		const lexical = path.resolve(file);
		let parentReal: string;
		try {
			parentReal = fs.realpathSync(path.dirname(lexical));
		} catch {
			throw new Error(`Screenshot directory does not exist: ${path.dirname(lexical)}`);
		}
		const resolved = path.join(parentReal, path.basename(lexical));
		if (!resolved.startsWith(cwdReal + path.sep) && resolved !== cwdReal) {
			throw new Error(`Screenshot path "${file}" resolves outside the working directory`);
		}
		const b64 = await this.#ext.screenshot();
		await Bun.write(resolved, Buffer.from(b64, "base64"));
	}
}
