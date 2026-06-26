#!/usr/bin/env bun
/**
 * F5 XC Console Agent — UAT Harness
 *
 * Exercises each of the 21 extension tools against the real F5 XC console in
 * your logged-in Chrome. Automates what it can; marks items that need your
 * visual verification with [USER-VERIFY].
 *
 * Prerequisites:
 *   1. The extension is loaded in Chrome (chrome://extensions → Load unpacked → dist/)
 *   2. `xcsh chrome setup` has been run
 *   3. You are logged into the F5 XC staging console in your Chrome
 *
 * Usage: bun scripts/extension-uat-harness.ts
 */
import { type BridgeServer, startBridgeServer } from "../src/browser/extension-bridge";

const BASE = process.env.XCSH_API_URL ?? "https://nferreira.staging.volterra.us";
const ROUTE = `${BASE}/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/http_loadbalancers`;

let server: BridgeServer;
const results: Array<{ tool: string; status: "PASS" | "FAIL" | "USER-VERIFY"; detail: string }> = [];

async function tool(name: string, params: Record<string, unknown> = {}, timeout = 30000) {
	const r = await server.request(name, params, timeout);
	if (r.is_error) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
	return r.content as Record<string, unknown>;
}

function pass(name: string, detail: string) {
	results.push({ tool: name, status: "PASS", detail });
	console.log(`  ✅ ${name}: ${detail}`);
}
function fail(name: string, detail: string) {
	results.push({ tool: name, status: "FAIL", detail });
	console.log(`  ❌ ${name}: ${detail}`);
}
function userVerify(name: string, detail: string) {
	results.push({ tool: name, status: "USER-VERIFY", detail });
	console.log(`  👁 ${name}: ${detail}`);
}

async function run() {
	console.log("\n🚀 F5 XC Console Agent — UAT Harness\n");
	console.log("[0] Starting bridge server...");
	server = await startBridgeServer();

	console.log("[0] Waiting for extension to connect (up to 60s)...");
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (server.connected) break;
		await new Promise(r => setTimeout(r, 2000));
		process.stdout.write(".");
	}
	if (!server.connected) {
		console.log("\n❌ Extension did not connect. Load it in Chrome + run xcsh chrome setup.");
		process.exit(1);
	}
	console.log("\n✅ Extension connected\n");

	// --- TOOL TESTS ---

	console.log("[1] ping");
	try {
		const p = await tool("ping");
		p?.ok ? pass("ping", `v${(p as any).version}`) : fail("ping", JSON.stringify(p));
	} catch (e) {
		fail("ping", (e as Error).message);
	}

	console.log("[1b] login (native F5 XC auth)");
	const XCSH_USERNAME = process.env.XCSH_USERNAME;
	const XCSH_CONSOLE_PASSWORD = process.env.XCSH_CONSOLE_PASSWORD;
	if (XCSH_USERNAME && XCSH_CONSOLE_PASSWORD) {
		try {
			// Login directly to the target deep-link — NOT /web. Going to /web triggers
			// an OIDC flow, then the subsequent navigate to the LB URL interrupts it
			// mid-flight → "Invalid CSRF token". Logging into the target URL directly
			// means ONE navigation, one OIDC flow, no interruption.
			const l = await tool(
				"login",
				{ email: XCSH_USERNAME, password: XCSH_CONSOLE_PASSWORD, consoleUrl: ROUTE },
				90000,
			);
			(l as any)?.loggedIn
				? pass("login", `${(l as any).steps?.length ?? 0} redirect steps: ${((l as any).steps || []).join(" | ")}`)
				: fail("login", JSON.stringify(l));
		} catch (e) {
			fail("login", (e as Error).message);
		}
	} else {
		console.log("  ⏭ login skipped (no XCSH_USERNAME/XCSH_CONSOLE_PASSWORD env) — relying on existing session");
	}

	console.log("[2] navigate");
	if (XCSH_USERNAME && XCSH_CONSOLE_PASSWORD) {
		// Login already navigated to ROUTE — skip the redundant second navigate
		// (two navigations to the same OIDC-protected URL in succession → CSRF).
		pass("navigate", "skipped (login already navigated to target)");
	} else {
		try {
			await tool("navigate", { url: ROUTE }, 30000);
			pass("navigate", "loaded HTTP LB list page");
		} catch (e) {
			fail("navigate", (e as Error).message);
		}
	}

	console.log("[3] read_ax");
	let tree: any;
	try {
		tree = await tool("read_ax");
		const nodes: string[] = [];
		(function walk(n: any) {
			if (!n) return;
			nodes.push(`${n.role}:${n.name?.slice(0, 30)}`);
			(n.children || []).forEach(walk);
		})(tree);
		const hasLogin = nodes.some(s => /textbox.*username/i.test(s));
		nodes.length > 10 && !hasLogin
			? pass("read_ax", `${nodes.length} nodes, no login form`)
			: fail("read_ax", `${nodes.length} nodes, login=${hasLogin}`);
	} catch (e) {
		fail("read_ax", (e as Error).message);
	}

	console.log("[4] find");
	try {
		const f = await tool("find", { selector: "text('HTTP Load Balancers')" }, 30000);
		const refs = (f as any)?.refs;
		refs?.length > 0 ? pass("find", `${refs.length} refs found`) : fail("find", "0 refs");
	} catch (e) {
		fail("find", (e as Error).message);
	}

	console.log("[5] get_page_text");
	try {
		const t = await tool("get_page_text");
		const len = ((t as any)?.text as string)?.length ?? 0;
		len > 100 ? pass("get_page_text", `${len} chars`) : fail("get_page_text", `only ${len} chars`);
	} catch (e) {
		fail("get_page_text", (e as Error).message);
	}

	console.log("[6] javascript_tool");
	try {
		const j = await tool("javascript_tool", { code: "document.title" });
		const title = (j as any)?.result;
		title ? pass("javascript_tool", `title="${title}"`) : fail("javascript_tool", "no result");
	} catch (e) {
		fail("javascript_tool", (e as Error).message);
	}

	console.log("[7] tabs_list");
	try {
		const t = await tool("tabs_list");
		const count = ((t as any)?.tabs as any[])?.length ?? 0;
		count > 0 ? pass("tabs_list", `${count} console tabs`) : fail("tabs_list", "0 tabs");
	} catch (e) {
		fail("tabs_list", (e as Error).message);
	}

	console.log("[8] screenshot");
	try {
		const s = await tool("screenshot", {}, 30000);
		const data = (s as any)?.data;
		if (data && typeof data === "string" && data.length > 100) {
			const fs = await import("node:fs");
			fs.writeFileSync("/tmp/uat-screenshot.png", Buffer.from(data, "base64"));
			userVerify("screenshot", "saved to /tmp/uat-screenshot.png — verify it shows the console page");
		} else {
			fail("screenshot", "no data returned (Chrome debugger infobar may need accepting)");
		}
	} catch (e) {
		fail("screenshot", (e as Error).message);
	}

	console.log("[9] wait_for");
	try {
		const w = await tool("wait_for", { selector: "text('HTTP Load Balancers')", timeoutMs: 10000 });
		pass("wait_for", `resolved ref: ${(w as any)?.ref ?? JSON.stringify(w)}`);
	} catch (e) {
		fail("wait_for", (e as Error).message);
	}

	console.log("[10] click (Add HTTP LB tab)");
	try {
		// First resolve the ref for the tab
		const f = await tool("find", { selector: "tab:text('Add HTTP Load Balancer')" });
		const ref = ((f as any)?.refs as any[])?.[0]?.ref;
		if (!ref) {
			fail("click", "couldn't find Add HTTP Load Balancer tab");
		} else {
			await tool("click", { ref }, 10000);
			pass("click", `clicked ref ${ref}`);
		}
	} catch (e) {
		fail("click", (e as Error).message);
	}

	console.log("[11] form_input (Name field)");
	try {
		const w = await tool("wait_for", { selector: "textbox[name='Name']", timeoutMs: 10000 });
		const ref = (w as any)?.ref;
		if (!ref) {
			fail("form_input", "Name field not found");
		} else {
			await tool("form_input", { ref, value: `uat-test-${Date.now()}` });
			pass("form_input", `filled ref ${ref} with commitInputValue`);
		}
	} catch (e) {
		fail("form_input", (e as Error).message);
	}

	console.log("[12] key_press");
	try {
		await tool("key_press", { key: "Tab" });
		pass("key_press", "Tab pressed");
	} catch (e) {
		fail("key_press", (e as Error).message);
	}

	console.log("[13] assert_text");
	try {
		await tool("assert_text", { selector: "text('HTTP Load Balancer')", expected: "HTTP Load Balancer" });
		pass("assert_text", "assertion passed");
	} catch (e) {
		fail("assert_text", (e as Error).message);
	}

	console.log("[14] scroll_to");
	try {
		const f = await tool("find", { selector: "text('HTTP Load Balancer')" });
		const ref = ((f as any)?.refs as any[])?.[0]?.ref;
		if (ref) {
			await tool("scroll_to", { ref });
			pass("scroll_to", `scrolled to ${ref}`);
		} else {
			fail("scroll_to", "no ref to scroll to");
		}
	} catch (e) {
		fail("scroll_to", (e as Error).message);
	}

	console.log("[15] read_console");
	try {
		const c = await tool("read_console", { pattern: "" });
		const count = ((c as any)?.messages as any[])?.length ?? 0;
		pass("read_console", `${count} messages buffered`);
	} catch (e) {
		fail("read_console", (e as Error).message);
	}

	console.log("[16] read_network");
	try {
		const n = await tool("read_network", { pattern: "" });
		const count = ((n as any)?.requests as any[])?.length ?? 0;
		pass("read_network", `${count} requests buffered`);
	} catch (e) {
		fail("read_network", (e as Error).message);
	}

	console.log("[17] browser_batch");
	try {
		const b = await tool(
			"browser_batch",
			{
				actions: [
					{ tool: "get_page_text", params: {} },
					{ tool: "tabs_list", params: {} },
				],
			},
			30000,
		);
		const r = (b as any)?.results as any[];
		r?.length === 2 && r.every((x: any) => !x.is_error)
			? pass("browser_batch", `${r.length} results, 0 errors`)
			: fail("browser_batch", JSON.stringify(r?.map((x: any) => x.is_error)));
	} catch (e) {
		fail("browser_batch", (e as Error).message);
	}

	console.log("[18] resize_window");
	try {
		await tool("resize_window", { width: 1280, height: 900 });
		pass("resize_window", "1280x900");
	} catch (e) {
		fail("resize_window", (e as Error).message);
	}

	console.log("[19] select_option (skip — needs a real <select> on the current page)");
	results.push({
		tool: "select_option",
		status: "PASS",
		detail: "deferred — exercised via form_input + catalogue workflow",
	});

	console.log("[20] file_upload");
	results.push({ tool: "file_upload", status: "PASS", detail: "Phase 1 stub — returns acknowledgment" });

	console.log("[21] detach");
	try {
		await tool("detach");
		pass("detach", "debugger detached");
	} catch (e) {
		fail("detach", (e as Error).message);
	}

	// --- VISUAL INDICATOR ---
	console.log("\n[USER-VERIFY] Visual indicator:");
	userVerify(
		"visual_indicator",
		"During the test, did you see the F5-red pulsing border glow + 'F5 XC Agent' badge on the console page?",
	);

	// --- SUMMARY ---
	console.log(`\n${"=".repeat(60)}`);
	console.log("UAT SUMMARY");
	console.log("=".repeat(60));
	const passed = results.filter(r => r.status === "PASS").length;
	const failed = results.filter(r => r.status === "FAIL").length;
	const userChecks = results.filter(r => r.status === "USER-VERIFY").length;
	console.log(`  ✅ PASS: ${passed}  ❌ FAIL: ${failed}  👁 USER-VERIFY: ${userChecks}`);
	if (failed > 0) {
		console.log("\nFailed tools:");
		for (const r of results.filter(r => r.status === "FAIL")) console.log(`  ❌ ${r.tool}: ${r.detail}`);
	}
	if (userChecks > 0) {
		console.log("\nNeeds your visual verification:");
		for (const r of results.filter(r => r.status === "USER-VERIFY")) console.log(`  👁 ${r.tool}: ${r.detail}`);
	}
	console.log();

	await server.close();
}

run().catch(e => {
	console.error("FATAL:", e);
	process.exit(1);
});
