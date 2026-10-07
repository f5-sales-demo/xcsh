import { describe, expect, test } from "bun:test";
import * as native from "@f5-sales-demo/pi-natives";

describe("native asynchronous Blindfold input", () => {
	test("provides cancellable native file/stdin encryption", () => {
		expect(typeof (native as unknown as Record<string, unknown>).blindfoldEncryptInput).toBe("function");
	});
});
