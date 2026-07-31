import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ReferenceChips } from "../src/components/ReferenceChips";
import type { ChatReference } from "../src/types";

const doc: ChatReference = { kind: "doc", title: "WAF overview", url: "https://docs.cloud.f5.com/waf" };
const console: ChatReference = {
	kind: "console",
	title: "HTTP LB",
	url: "https://example.console.ves.volterra.io/lb",
};

test("renders a labelled Sources list with one chip per reference", () => {
	render(<ReferenceChips references={[doc, console]} />);
	const list = screen.getByRole("list", { name: /sources/i });
	expect(list).toBeDefined();
	expect(screen.getByText("WAF overview")).toBeDefined();
	expect(screen.getByText("HTTP LB")).toBeDefined();
});

test("each chip is a safe external link (new tab, noopener) tagged by kind", () => {
	render(<ReferenceChips references={[doc, console]} />);
	const docLink = screen.getByRole("link", { name: /WAF overview/ }) as HTMLAnchorElement;
	expect(docLink.getAttribute("href")).toBe(doc.url);
	expect(docLink.getAttribute("target")).toBe("_blank");
	expect(docLink.getAttribute("rel")).toContain("noopener");
	expect(docLink.className).toContain("ref-doc");
	const consoleLink = screen.getByRole("link", { name: /HTTP LB/ }) as HTMLAnchorElement;
	expect(consoleLink.className).toContain("ref-console");
});

test("dedupes references by URL", () => {
	render(<ReferenceChips references={[doc, { ...doc, title: "dupe" }]} />);
	expect(screen.getAllByRole("link")).toHaveLength(1);
});

test("an unsafe (non-http) URL is rendered as plain text, not a link", () => {
	const evil: ChatReference = { kind: "doc", title: "evil", url: "javascript:alert(1)" };
	render(<ReferenceChips references={[evil]} />);
	expect(screen.queryByRole("link")).toBeNull();
	expect(screen.getByText("evil")).toBeDefined();
});

test("renders nothing when there are no references", () => {
	const { container } = render(<ReferenceChips references={[]} />);
	expect(container.firstChild).toBeNull();
});
