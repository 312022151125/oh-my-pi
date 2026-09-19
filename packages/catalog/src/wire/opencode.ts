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

/** Shape the OpenCode gate requires for `x-opencode-session`. */
export const OPENCODE_SESSION_TOKEN_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

/**
 * Format a session identity as OpenCode's canonical session token
 * (`ses_` + 12 lowercase hex + 14 alphanumeric chars).
 *
 * Deterministic: the 12-hex head is the leading digest bits of the input and
 * the alphanumeric tail derives from the rest, so a conversation keeps one
 * token across turns — the gateway pins routing and prompt caching on the
 * value — while the shape always passes the gate's check. The tail is upper
 * base36 (digits `0` mapped to `O`) so no lowercase hex characters leak past
 * the head segment.
 */
export function toOpenCodeSessionToken(sessionId: string): string {
	const digest = new Bun.CryptoHasher("sha256").update(sessionId).digest("hex");
	const tail = BigInt(`0x${digest}`).toString(36).toUpperCase().replace(/0/g, "O");
	return `ses_${`${digest.slice(0, 12)}${tail}`.slice(0, 26)}`;
}
