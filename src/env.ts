/**
 * Bindings and vars the Worker expects. `wrangler types` generates the
 * authoritative `Env` from wrangler.jsonc; this is the narrow, hand-typed
 * view the modules program against so they stay testable with fakes.
 */

export interface AiLike {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface RateLimiterLike {
	limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface AppEnv {
	ASSETS: Fetcher;
	KV: KVNamespace;
	AI: AiLike;
	STAFF_RL?: RateLimiterLike;
	BROWSER?: Fetcher; // Browser Rendering; optional so tests and local dev run without it
	GITHUB_OWNER: string;
	GITHUB_REPOS: string;
	RECEIPTS_WINDOW_DAYS: string;
	STAFF_DAILY_CAP: string;
	AI_MODEL: string;
	CONTACT_EMAIL: string;
	TURNSTILE_SITE_KEY: string;
	// Secrets (optional)
	GITHUB_TOKEN?: string;
	TURNSTILE_SECRET?: string;
}
