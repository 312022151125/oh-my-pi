/**
 * OpenCode gateway (Zen, Go) wire identity.
 *
 * The contributor free tier is gated on client identity: every request must
 * carry a `User-Agent` whose leading token is `opencode/<version>` and an
 * `x-opencode-session` matching `ses_<12 hex><14 alnum>`. Both are wire-shape
 * checks applied before credentials are evaluated
 * ([#12306](https://github.com/can1357/oh-my-pi/issues/12306)).
 */

/** Canonical OpenCode client User-Agent; the gate reads only the leading token. */
export const OPENCODE_USER_AGENT = "opencode/1.18.31";

/** Provider ids whose hosts sit behind the OpenCode gateways (Zen, Go). */
export const OPENCODE_PROVIDER_IDS: ReadonlySet<string> = new Set(["opencode-zen", "opencode-go"]);

/** Whether `provider` is served by an OpenCode gateway. */
export function isOpenCodeProvider(provider: string): boolean {
	return OPENCODE_PROVIDER_IDS.has(provider);
}

/**
 * The gate requires all five of these OpenCode core tool NAMES in `tools[]`
 * (schemas are ignored, extra non-OpenCode tools are fine, and the count is
 * over distinct names). Agent harnesses carrying a normal tool roster satisfy
 * this natively; tool-less and partial-roster calls (e.g. advisor with only
 * `advise`) must pad.
 */
export const OPENCODE_GATE_TOOL_NAMES = ["bash", "edit", "glob", "grep", "read"] as const;

/** Minimum distinct gate tool names the gateway requires in `tools[]`. */
export const OPENCODE_GATE_MIN_TOOL_NAMES = 5;

/**
 * Gate tool names missing from `names` (exact-match — the gate compares names
 * only). Returns empty when all five gate names are already present; otherwise
 * returns every gate name not yet in the roster so the caller can pad to the
 * full set.
 */
export function missingOpenCodeGateToolNames(names: Iterable<string>): string[] {
	const present = new Set(names);
	return OPENCODE_GATE_TOOL_NAMES.filter(name => !present.has(name));
}

/**
 * Pad `tools` with all missing gate-required OpenCode tool names so every call
 * (tool-less helpers, advisors carrying only `advise`, partial rosters) passes
 * the body check. Pads carry no parameters and an empty description — the gate
 * ignores schemas — but callers MUST keep them out of the agent loop's tool
 * registry: they are wire-shape filler, not executable work.
 *
 * Returns the input array unchanged (same identity) when all five gate names
 * are already present.
 */
export function withOpenCodeGateTools<T extends { name: string }>(tools: readonly T[] | undefined): T[] {
	const existing = tools ?? [];
	const missing = missingOpenCodeGateToolNames(existing.map(tool => tool.name));
	if (missing.length === 0) return existing as T[];
	// The stubs structurally differ from T only in fields the wire never reads.
	// `strict: false` keeps every transport's strict-mode normalization inert.
	const pads = missing.map(name => ({
		name,
		description: "",
		parameters: { type: "object" },
		strict: false,
	})) as unknown as T[];
	return [...existing, ...pads];
}

/** Shape the OpenCode gate requires for `x-opencode-session`. */
export const OPENCODE_SESSION_TOKEN_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

/**
 * Mint the 12-hex timestamp prefix Zen decodes as `~(unix_ms<<12|counter)`
 * truncated to its low 48 bits. Digest-derived prefixes decode to a
 * non-monotonic value that Zen classifies as a non-OpenCode client and
 * rejects with 403 FreeTierError (issue #68).
 */
function mintedTimePrefix(): string {
	const ms = BigInt(Date.now());
	const raw = ~((ms << 12n) | 0n) & 0xffffffffffffn;
	return raw.toString(16).padStart(12, "0");
}

/**
 * Bounded LRU-style cache keyed by sha256(sessionId) hex.
 * Keeps the session stable per conversation so key and proxy affinity do not
 * change across turns. Capped so long-lived processes do not accumulate
 * unboundedly many entries.
 */
const SESSION_CACHE_MAX = 256;
const sessionCache = new Map<string, string>();

/**
 * Format a session identity as OpenCode's canonical session token
 * (`ses_` + 12 lowercase hex + 14 alphanumeric chars).
 *
 * The 12-hex head is minted from the clock as an inverted millisecond
 * timestamp so Zen's client-identity check passes (a digest-derived head is
 * rejected as a non-OpenCode client with 403 FreeTierError — issue #68).
 * The 14-character tail still derives from the digest so it is stable and
 * unique per session. A bounded in-process cache keeps the full token
 * constant across turns so routing and prompt-cache affinity are preserved.
 */
export function toOpenCodeSessionToken(sessionId: string): string {
	const key = new Bun.CryptoHasher("sha256").update(sessionId).digest("hex");
	const cached = sessionCache.get(key);
	if (cached !== undefined) return cached;

	const digest = key;
	const tail = BigInt(`0x${digest}`).toString(36).toUpperCase().replace(/0/g, "O").slice(0, 14);
	const token = `ses_${mintedTimePrefix()}${tail.padEnd(14, "A")}`;

	if (sessionCache.size >= SESSION_CACHE_MAX) {
		// Evict the oldest entry (Map preserves insertion order).
		sessionCache.delete(sessionCache.keys().next().value!);
	}
	sessionCache.set(key, token);
	return token;
}
