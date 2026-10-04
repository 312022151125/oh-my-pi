/**
 * `bun test` inherits the developer's shell, so a machine-wide export like
 * `ANTHROPIC_BASE_URL` or `HINDSIGHT_BANK_ID` silently reorders behaviour a test
 * asserts on: env bindings outrank every settings layer (`config/registry.ts`
 * `#effectiveEnv`) and outrank endpoint detection, so an assertion only holds on
 * a shell that happens not to export those names.
 */

/** Restore one name without coercing an absent value to `"undefined"`. */
function restoreEnvValue(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

/**
 * Unset every name in `keys` and return the restore function. Call it once in
 * `beforeAll` and the restore in `afterAll` so the scrub spans the whole file.
 */
export function scrubEnv(keys: readonly string[]): () => void {
	const snapshot = keys.map(key => [key, process.env[key]] as const);
	for (const key of keys) delete process.env[key];
	return () => {
		for (const [key, value] of snapshot) restoreEnvValue(key, value);
	};
}
