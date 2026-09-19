import { describe, expect, it } from "bun:test";
import { completeSimple } from "@oh-my-pi/pi-ai";
import { formatMessage } from "@oh-my-pi/pi-ai/error";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import {
	withOpenCodeGateTools,
	OPENCODE_GATE_TOOL_NAMES,
	OPENCODE_SESSION_TOKEN_PATTERN,
} from "@oh-my-pi/pi-catalog/wire/opencode";
import type { Model } from "@oh-my-pi/pi-ai/types";

const OPENCODE_GO_COMPLETIONS_MODEL = {
	provider: "opencode-go",
	id: "kimi-k2.7-code",
	baseUrl: "https://opencode.ai/zen/go/v1",
};

function makeOpenCodeGoCompletionsModel(): Model<"openai-completions"> {
	return buildModel({
		...OPENCODE_GO_COMPLETIONS_MODEL,
		name: "Kimi K2.7 Code",
		api: "openai-completions",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 8192,
	});
}

function makeOpenAICompletionsModel(): Model<"openai-completions"> {
	return buildModel({
		id: "gpt-5.5",
		name: "GPT-5.5",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 8192,
	});
}

function chatSse(): Response {
	const chunk = (delta: unknown, finishReason: string | null) =>
		JSON.stringify({
			id: "x",
			object: "chat.completion.chunk",
			created: 0,
			choices: [{ index: 0, delta, finish_reason: finishReason }],
		});
	return new Response(`data: ${chunk({ content: "ok" }, null)}\n\ndata: ${chunk({}, "stop")}\n\ndata: [DONE]\n\n`, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

async function captureRequestTools(model: Model<"openai-completions">): Promise<Array<{ name: string }>> {
	let body: unknown;
	const fetchMock = async (_input: string | URL | Request, init?: RequestInit) => {
		body = JSON.parse(String(init?.body));
		return chatSse();
	};
	await completeSimple(
		model,
		{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
		{ apiKey: "key", fetch: fetchMock as typeof fetch },
	);
	return (body as { tools?: Array<{ function: { name: string } }> }).tools?.map(tool => tool.function) ?? [];
}

describe("withOpenCodeGateTools", () => {
	it("pads exactly the gate names missing from the roster", () => {
		const padded = withOpenCodeGateTools([{ name: "read", description: "r", parameters: {} }]);
		expect(padded.map(tool => tool.name).sort()).toEqual([...OPENCODE_GATE_TOOL_NAMES].sort());
	});

	it("returns the same array identity when the roster already satisfies the gate", () => {
		const roster = OPENCODE_GATE_TOOL_NAMES.map(name => ({ name, description: "", parameters: {} }));
		expect(withOpenCodeGateTools(roster)).toBe(roster);
	});

	it("pads a tool-less call to the full required roster", () => {
		expect(
			withOpenCodeGateTools<{ name: string }>(undefined)
				.map(tool => tool.name)
				.sort(),
		).toEqual([...OPENCODE_GATE_TOOL_NAMES].sort());
		expect(
			withOpenCodeGateTools<{ name: string }>([])
				.map(tool => tool.name)
				.sort(),
		).toEqual([...OPENCODE_GATE_TOOL_NAMES].sort());
	});

	it("does not mutate the caller's array", () => {
		const roster = [{ name: "read", description: "r", parameters: {} }];
		const padded = withOpenCodeGateTools(roster);
		expect(roster).toHaveLength(1);
		expect(padded).not.toBe(roster);
	});
});

describe("OpenCode free-tier body gate", () => {
	it("tool-less auxiliary calls reach the wire with the full gate roster", async () => {
		const tools = await captureRequestTools(makeOpenCodeGoCompletionsModel());
		const names = new Set(tools.map(tool => tool.name));
		for (const required of OPENCODE_GATE_TOOL_NAMES) {
			expect(names.has(required)).toBe(true);
		}
	});

	it("pads do not disturb a roster that already satisfies the gate", async () => {
		// A single-tool call gets exactly the missing four, nothing else:
		// five total entries on the wire.
		const padded = withOpenCodeGateTools([{ name: "bash", description: "run", parameters: { type: "object" } }]);
		expect(padded).toHaveLength(5);
	});

	it("leaves non-OpenCode providers untouched", async () => {
		const tools = await captureRequestTools(makeOpenAICompletionsModel());
		expect(tools).toEqual([]);
	});
});

describe("OpenCode free-tier error rewrite", () => {
	it("explains the model-scoped denial while preserving the classifier markers", async () => {
		const raw =
			'403 {"error":{"type":"FreeTierError","message":"OpenCode\'s free tier can only be used from within OpenCode"}}';
		const rewritten = await formatMessage(new Error(raw), { provider: "opencode-zen" });
		expect(rewritten).toMatch(/FreeTierError/);
		expect(rewritten).toMatch(/free tier can only be used from within/i);
		expect(rewritten).toMatch(/paid models on the same key keep working/);
		// Untouched for other providers: the wording is not globally unique.
		expect(await formatMessage(new Error(raw), { provider: "openai" })).toBe(raw);
	});
});

describe("OpenCode gate identity remains on every request", () => {
	it("tool-less calls still carry the ses_-shaped session header", async () => {
		let headers: Headers | undefined;
		const fetchMock = async (_input: string | URL | Request, init?: RequestInit) => {
			headers = new Headers(init?.headers);
			return chatSse();
		};
		await completeSimple(
			makeOpenCodeGoCompletionsModel(),
			{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
			{ apiKey: "key", fetch: fetchMock as typeof fetch },
		);
		expect(headers?.get("x-opencode-session")).toMatch(OPENCODE_SESSION_TOKEN_PATTERN);
	});
});
