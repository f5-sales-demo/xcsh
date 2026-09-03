import { describe, expect, it } from "bun:test";
import type { Tool, ToolCall } from "@f5-sales-demo/pi-ai/types";
import { validateToolArguments } from "@f5-sales-demo/pi-ai/utils/validation";
import { Type } from "@sinclair/typebox";

describe("Tool argument coercion", () => {
	it("coerces numeric strings when schema expects number", () => {
		const tool: Tool = {
			name: "t1",
			description: "",
			parameters: Type.Object({ timeout: Type.Number() }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-1",
			name: "t1",
			arguments: { timeout: "300" },
		};

		const result = validateToolArguments(tool, toolCall) as { timeout: number };
		expect(result.timeout).toBe(300);
		expect(typeof result.timeout).toBe("number");
	});

	it("preserves string values when schema expects string", () => {
		const tool: Tool = {
			name: "t2",
			description: "",
			parameters: Type.Object({ label: Type.String() }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-2",
			name: "t2",
			arguments: { label: "300" },
		};

		const result = validateToolArguments(tool, toolCall) as { label: string };
		expect(result.label).toBe("300");
		expect(typeof result.label).toBe("string");
	});

	it("parses JSON arrays in string values when schema expects array", () => {
		const tool: Tool = {
			name: "t3",
			description: "",
			parameters: Type.Object({ items: Type.Array(Type.Number()) }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-3",
			name: "t3",
			arguments: { items: "[1, 2, 3]" },
		};

		const result = validateToolArguments(tool, toolCall) as { items: number[] };
		expect(result.items).toEqual([1, 2, 3]);
	});

	it("parses JSON objects in string values when schema expects object", () => {
		const tool: Tool = {
			name: "t4",
			description: "",
			parameters: Type.Object({ payload: Type.Object({ a: Type.Number() }) }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-4",
			name: "t4",
			arguments: { payload: '{"a": 1}' },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.payload).toEqual({ a: 1 });
	});

	it("parses nested JSON arrays in string values", () => {
		const tool: Tool = {
			name: "t5",
			description: "",
			parameters: Type.Object({ payload: Type.Object({ items: Type.Array(Type.Number()) }) }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-5",
			name: "t5",
			arguments: { payload: { items: "[4, 5]" } },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.payload.items).toEqual([4, 5]);
	});

	it("coerces JSON-stringified object arrays when schema expects array of objects", () => {
		const tool: Tool = {
			name: "t9",
			description: "",
			parameters: Type.Object({
				a: Type.String(),
				b: Type.Array(
					Type.Object({
						k: Type.String(),
					}),
				),
			}),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-9",
			name: "t9",
			arguments: {
				a: "hello",
				b: '[{"k":"y"}]',
			},
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result.b).toEqual([{ k: "y" }]);
	});

	it("coerces JSON-stringified root arguments containing array-of-object fields", () => {
		const tool: Tool = {
			name: "t10",
			description: "",
			parameters: Type.Object({
				a: Type.String(),
				b: Type.Array(
					Type.Object({
						k: Type.String(),
					}),
				),
			}),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-10",
			name: "t10",
			arguments: '{"a":"hello","b":"[{\\"k\\":\\"y\\"}]"}' as unknown as Record<string, unknown>,
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({
			a: "hello",
			b: [{ k: "y" }],
		});
	});

	it("iteratively coerces when both root arguments and nested fields are JSON strings", () => {
		const tool: Tool = {
			name: "t7",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						new_content: Type.String(),
					}),
				),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-7",
			name: "t7",
			arguments:
				'{"path":"somefile.js","edits":"[{\\"target\\":\\"13#cf\\",\\"new_content\\":\\"...\\"}]"}' as unknown as Record<
					string,
					unknown
				>,
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.path).toBe("somefile.js");
		expect(result.edits).toEqual([{ target: "13#cf", new_content: "..." }]);
	});

	it("rejects array strings with trailing wrapper braces", () => {
		const tool: Tool = {
			name: "t16",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				edits: Type.Array(
					Type.Object({
						op: Type.String(),
						pos: Type.String(),
						end: Type.String(),
						lines: Type.Array(Type.String()),
					}),
				),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-16",
			name: "t16",
			arguments: {
				path: "packages/coding-agent/src/prompts/tools/bash.md",
				edits: '[{"op":"replace","pos":"38#BR","end":"39#QY","lines":["line 1","line 2"]}]}\n',
			},
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "t16"');
	});
	it("iteratively coerces nested array items that are JSON-serialized objects", () => {
		const tool: Tool = {
			name: "t8",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						new_content: Type.String(),
					}),
				),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-8",
			name: "t8",
			arguments: {
				path: "somefile.js",
				edits: '["{\\"target\\":\\"13#cf\\",\\"new_content\\":\\"...\\"}"]',
			},
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.edits).toEqual([{ target: "13#cf", new_content: "..." }]);
	});

	it("normalizes the captured Sonnet todo payload before validating union branches", () => {
		const todoOperation = Type.Union([
			Type.Object({
				op: Type.Literal("replace"),
				phases: Type.Array(
					Type.Object({
						name: Type.String(),
						tasks: Type.Optional(Type.Array(Type.Object({ content: Type.String(), status: Type.String() }))),
					}),
				),
			}),
			Type.Object({ op: Type.Literal("remove_task"), id: Type.String() }),
		]);
		const tool: Tool = {
			name: "todo_write",
			description: "",
			parameters: Type.Object({ ops: Type.Array(todoOperation) }),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-sonnet-todo",
			name: "todo_write",
			arguments: JSON.stringify({
				ops: JSON.stringify([
					{
						op: "replace",
						phases: JSON.stringify([
							JSON.stringify({
								name: "Answer directly",
								tasks: JSON.stringify([
									JSON.stringify({
										content: "Answer the identity question",
										status: "in_progress",
									}),
								]),
							}),
						]),
					},
				]),
			}) as unknown as Record<string, unknown>,
		};

		expect(validateToolArguments(tool, toolCall)).toEqual({
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Answer directly",
							tasks: [{ content: "Answer the identity question", status: "in_progress" }],
						},
					],
				},
			],
		});
	});

	it("normalizes schema-declared containers nested through unions and arrays", () => {
		const tool: Tool = {
			name: "nested-containers",
			description: "",
			parameters: Type.Object({
				payload: Type.Union([
					Type.Object({
						rows: Type.Array(Type.Union([Type.Object({ values: Type.Array(Type.Number()) }), Type.Null()])),
					}),
					Type.Null(),
				]),
				optional: Type.Optional(Type.Array(Type.String())),
			}),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-nested-containers",
			name: "nested-containers",
			arguments: {
				payload: '{"rows":["{\\"values\\":\\"[1,2,3]\\"}",null]}',
			},
		};

		expect(validateToolArguments(tool, toolCall)).toEqual({
			payload: { rows: [{ values: [1, 2, 3] }, null] },
		});
	});

	it("rejects malformed and trailing-junk container strings", () => {
		const tool: Tool = {
			name: "strict-containers",
			description: "",
			parameters: Type.Object({ values: Type.Array(Type.Number()) }),
		};

		for (const values of ["[1,2", "[1,2] trailing", "[1,2]]"]) {
			const toolCall: ToolCall = {
				type: "toolCall",
				id: "call-strict-containers",
				name: "strict-containers",
				arguments: { values },
			};
			expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "strict-containers"');
		}
	});

	it("does not parse JSON containers for incompatible schema branches", () => {
		const tool: Tool = {
			name: "conservative-containers",
			description: "",
			parameters: Type.Object({ value: Type.Union([Type.String(), Type.Number()]) }),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-conservative-containers",
			name: "conservative-containers",
			arguments: { value: "[1,2]" },
		};

		expect(validateToolArguments(tool, toolCall)).toEqual({ value: "[1,2]" });
	});

	it("does not recurse through prototype-sensitive keys in parsed containers", () => {
		const tool: Tool = {
			name: "prototype-safe-containers",
			description: "",
			parameters: Type.Object({
				payload: Type.Object({
					constructor: Type.Array(Type.String()),
				}),
			}),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-prototype-safe-containers",
			name: "prototype-safe-containers",
			arguments: { payload: '{"constructor":"[\\"polluted\\"]"}' },
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow(
			'Validation failed for tool "prototype-safe-containers"',
		);
		expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("accepts null for optional properties by treating them as omitted", () => {
		const tool: Tool = {
			name: "t11",
			description: "",
			parameters: Type.Object({
				requiredText: Type.String(),
				optionalCount: Type.Optional(Type.Number()),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-11",
			name: "t11",
			arguments: { requiredText: "ok", optionalCount: null },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ requiredText: "ok" });
	});

	it("drops null optional properties nested in array objects", () => {
		const tool: Tool = {
			name: "t12",
			description: "",
			parameters: Type.Object({
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						pos: Type.Optional(Type.String()),
						end: Type.Optional(Type.String()),
					}),
				),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-12",
			name: "t12",
			arguments: { edits: [{ target: "a", pos: null, end: "e" }] },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ edits: [{ target: "a", end: "e" }] });
	});

	it("drops null optional properties in anyOf object branches", () => {
		const opSchema = Type.Union([
			Type.Object({
				op: Type.Literal("add_task"),
				phase: Type.String(),
				content: Type.String(),
			}),
			Type.Object({
				op: Type.Literal("update"),
				id: Type.String(),
				status: Type.Optional(Type.String()),
				content: Type.Optional(Type.String()),
				notes: Type.Optional(Type.String()),
			}),
		]);

		const tool: Tool = {
			name: "t13",
			description: "",
			parameters: Type.Object({
				ops: Type.Array(opSchema),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-13",
			name: "t13",
			arguments: {
				ops: [
					{
						op: "update",
						id: "task-1",
						status: "completed",
						content: null,
						notes: "",
					},
				],
			},
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({
			ops: [
				{
					op: "update",
					id: "task-1",
					status: "completed",
					notes: "",
				},
			],
		});
	});

	it("does not parse quoted JSON strings when schema expects number", () => {
		const tool: Tool = {
			name: "t6",
			description: "",
			parameters: Type.Object({ timeout: Type.Number() }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-6",
			name: "t6",
			arguments: { timeout: '"300"' },
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "t6"');
	});

	it("coerces numeric string for Optional<number> (anyOf:[number,null])", () => {
		const tool: Tool = {
			name: "t14",
			description: "",
			parameters: Type.Object({ tick_size: Type.Optional(Type.Number()) }),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-14",
			name: "t14",
			arguments: { tick_size: "1.0" },
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result.tick_size).toBe(1);
		expect(typeof result.tick_size).toBe("number");
	});

	it("leaves Optional<number> as undefined when absent", () => {
		const tool: Tool = {
			name: "t15",
			description: "",
			parameters: Type.Object({ tick_size: Type.Optional(Type.Number()) }),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-15",
			name: "t15",
			arguments: {},
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result.tick_size).toBeUndefined();
	});
	it("strips string 'null' on optional boolean field", () => {
		const tool: Tool = {
			name: "edit-tool",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				delete: Type.Optional(Type.Boolean()),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-edit",
			name: "edit-tool",
			arguments: { path: "file.ts", delete: "null" },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ path: "file.ts" });
	});

	it("strips string 'null' on optional string field", () => {
		const tool: Tool = {
			name: "edit-tool",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				move: Type.Optional(Type.String()),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-edit",
			name: "edit-tool",
			arguments: { path: "file.ts", move: "null" },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ path: "file.ts" });
	});

	it("errors on string 'null' for required field", () => {
		const tool: Tool = {
			name: "required-tool",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-required",
			name: "required-tool",
			arguments: { path: "null" },
		};

		// Should NOT strip - path is required, so validation should pass
		// (the string "null" is a valid string)
		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ path: "null" });
	});

	it("strips string 'null' and actual null on multiple optional fields", () => {
		const tool: Tool = {
			name: "multi-optional",
			description: "",
			parameters: Type.Object({
				required: Type.String(),
				optBool: Type.Optional(Type.Boolean()),
				optString: Type.Optional(Type.String()),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-multi",
			name: "multi-optional",
			arguments: { required: "value", optBool: "null", optString: null },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ required: "value" });
	});

	it("rejects a stringified array with an extra bracket", () => {
		const tool: Tool = {
			name: "heal-1",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						content: Type.String(),
					}),
				),
			}),
		};

		// Model wrote "]}]" at the end instead of "}]" -- extra ] between " and }
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-heal-1",
			name: "heal-1",
			arguments: {
				path: "foo.ts",
				edits: '[{"target": "fn_foo#ABCD", "content": "code}"}]}]',
			},
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "heal-1"');
	});

	it("rejects a stringified array with the wrong bracket type", () => {
		const tool: Tool = {
			name: "heal-2",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						content: Type.String(),
					}),
				),
			}),
		};

		// Model wrote "}}" at the end instead of "}]" -- wrong bracket type
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-heal-2",
			name: "heal-2",
			arguments: {
				path: "bar.ts",
				edits: '[{"target": "fn_bar#1234", "content": "return 1}"}}',
			},
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "heal-2"');
	});

	it("rejects a stringified array with literal backslash-n between tokens", () => {
		const tool: Tool = {
			name: "heal-esc-1",
			description: "",
			parameters: Type.Object({
				edits: Type.Array(Type.Object({ target: Type.String(), content: Type.String() })),
			}),
		};

		// LLM emits literal \n between the closing } and ]
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-heal-esc-1",
			name: "heal-esc-1",
			arguments: {
				edits: '[{"target": "fn_foo#ABCD~", "content": "return 1;\\n"}\\n]',
			},
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "heal-esc-1"');
	});

	it("rejects a stringified array with trailing junk after a balanced container", () => {
		const tool: Tool = {
			name: "heal-trail-1",
			description: "",
			parameters: Type.Object({
				edits: Type.Array(Type.Object({ target: Type.String(), op: Type.String() })),
			}),
		};

		// LLM appends \n</invoke> after the valid JSON
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-heal-trail-1",
			name: "heal-trail-1",
			arguments: {
				edits: '[{"target": "fn_foo", "op": "replace"}]\n</invoke>',
			},
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "heal-trail-1"');
	});

	it("does not coerce prototype-sensitive JSON Pointer paths", () => {
		const schema = JSON.parse(
			'{"type":"object","properties":{"__proto__":{"type":"number"}},"required":["__proto__"]}',
		);
		const tool: Tool = { name: "prototype-guard", description: "", parameters: schema };
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-prototype-guard",
			name: "prototype-guard",
			arguments: JSON.parse('{"__proto__":"not-a-number"}'),
		};

		const result = validateToolArguments(tool, toolCall) as Record<string, unknown>;
		expect(Object.hasOwn(result, "__proto__")).toBe(true);
		expect(Reflect.get(result, "__proto__")).toBe("not-a-number");
		expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("rejects deeply broken JSON strings", () => {
		const tool: Tool = {
			name: "heal-3",
			description: "",
			parameters: Type.Object({
				edits: Type.Array(Type.Object({ target: Type.String() })),
			}),
		};

		// Structural error deep in the middle -- should NOT be healed
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-heal-3",
			name: "heal-3",
			arguments: {
				edits: '[{"target": invalid json here}]',
			},
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow("Validation failed");
	});
});
