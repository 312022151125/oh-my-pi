/**
 * OpenCode-compatible identity helpers.
 *
 * These mimic the opencode CLI's wire format so upstream gateways
 * attribute requests correctly and apply the same optimizations.
 */

import { createHash } from "node:crypto";

/** OpenCode CLI User-Agent string. Bump when the CLI version changes. */
export const OPENCODE_USER_AGENT = "opencode/1.18.31";

/** OpenCode client type identifier. */
export const OPENCODE_CLIENT = "cli";

/**
 * Generate a deterministic synthetic OpenCode-style session identifier.
 *
 * Same id => same session id.
 * Format: `ses_${12 hex chars}${14 alphanumeric}` (26 chars after prefix)
 */
export function generateSessionId(id: string): string {
	const hash = createHash("sha256").update(id).digest();

	// First 6 bytes => 12 hex chars
	const hex = hash.subarray(0, 6).toString("hex");

	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

	// Next 14 bytes => 14 deterministic alphanumeric chars
	let suffix = "";
	for (let i = 0; i < 14; i++) {
		suffix += alphabet[hash[6 + i] % alphabet.length];
	}

	return `ses_${hex}${suffix}`;
}