import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { reserveWorkerPort } from "./worker-process";

test("worker fixture ports avoid automatic outbound allocation and are not reused", () => {
	const [start, end] =
		process.platform === "linux"
			? readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number)
			: [49152, 65535];
	const ports = Array.from({ length: 256 }, () => reserveWorkerPort());
	expect(ports.every(port => port < start || port > end)).toBe(true);
	expect(new Set(ports).size).toBe(ports.length);
});
