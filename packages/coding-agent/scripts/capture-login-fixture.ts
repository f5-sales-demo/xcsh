#!/usr/bin/env bun
// One-shot capture of the F5/Keycloak login-wall DOM fixture used by the
// auth-preflight detection predicates:
//   test/browser/fixtures/xc-login-wall.html   (logged-OUT login page)
//
// Uses a throwaway profile so the first navigation is unauthenticated. No creds
// needed (we only capture the login page). Run manually; delete the profile after.
//
// The authenticated-console fixture (test/browser/fixtures/xc-console-authed.html)
// is sourced from a real logged-in console capture rather than scripted login:
// a fresh Chrome profile hits a Keycloak "login-actions" interstitial that is not
// worth automating just to produce a fixture.
import puppeteer from "puppeteer";

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.F5XC_API_URL ?? "https://nferreira.staging.volterra.us";
const PROFILE = "/tmp/xc-login-capture-profile";
const LOGIN_OUT = "test/browser/fixtures/xc-login-wall.html";

const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, userDataDir: PROFILE });
try {
	const page = (await browser.pages())[0] ?? (await browser.newPage());
	await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => {});
	await new Promise(r => setTimeout(r, 2500));
	const loginHtml = await page.content();
	await Bun.write(LOGIN_OUT, loginHtml);
	console.log(`wrote ${LOGIN_OUT} (${loginHtml.length} bytes) url=${page.url().slice(0, 80)}`);
} finally {
	await browser.close().catch(() => {});
}
