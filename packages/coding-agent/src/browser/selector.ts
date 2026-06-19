export type Locator =
	| { kind: "roleName"; role: string; name: string }
	| { kind: "role"; role: string }
	| { kind: "text"; text: string }
	| { kind: "css"; css: string };

/** ARIA roles the catalogue addresses by bare role or role+name. */
export const KNOWN_ROLES: ReadonlySet<string> = new Set([
	"button",
	"tab",
	"option",
	"textbox",
	"spinbutton",
	"listbox",
	"combobox",
	"checkbox",
	"radio",
	"switch",
	"link",
	"menuitem",
	"searchbox",
	"slider",
	"treeitem",
]);

const TEXT_RE = /^text\('([^']*)'\)$/;
const ROLE_TEXT_RE = /^([a-z]+):text\('([^']*)'\)$/;
const ROLE_NAME_RE = /^([a-z]+)\[name='([^']*)'\]$/;
const BARE_ROLE_RE = /^[a-z]+$/;

export function parseLocator(selector: string): Locator {
	const text = selector.match(TEXT_RE);
	if (text) return { kind: "text", text: text[1]! };
	const roleText = selector.match(ROLE_TEXT_RE);
	if (roleText) return { kind: "roleName", role: roleText[1]!, name: roleText[2]! };
	const roleName = selector.match(ROLE_NAME_RE);
	if (roleName) return { kind: "roleName", role: roleName[1]!, name: roleName[2]! };
	if (BARE_ROLE_RE.test(selector) && KNOWN_ROLES.has(selector)) return { kind: "role", role: selector };
	return { kind: "css", css: selector };
}
