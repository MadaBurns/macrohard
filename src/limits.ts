/**
 * Spend controls. Two layers on top of the per-IP rate-limit binding:
 *  - a global daily cap on model calls (KV counter, UTC day)
 *  - a per-query result cache so repeat prompts cost nothing
 */

export function dayKey(now: Date, prefix = 'cap'): string {
	return `${prefix}:${now.toISOString().slice(0, 10)}`;
}

/**
 * Set only when a guard pass could not answer, and short-lived on purpose: the
 * band should report an outage while it is happening and forget it afterwards,
 * not keep a permanent record of every second the guard was unreachable.
 *
 * It lives here rather than in the Worker entrypoint because workerd rejects a
 * named export from the entry module that is not a handler.
 */
export const GUARD_OUTAGE_KEY = 'guard:outage';
export const GUARD_OUTAGE_TTL = 300;

export interface CapResult {
	allowed: boolean;
	used: number;
	cap: number;
}

/**
 * Best-effort counter. KV is eventually consistent, so under a burst this can
 * overshoot by a handful — acceptable for a ceiling whose purpose is "not
 * unbounded", not "exactly N".
 */
export async function consumeDailyCap(kv: KVNamespace, now: Date, cap: number, prefix = 'cap'): Promise<CapResult> {
	const key = dayKey(now, prefix);
	const used = Number((await kv.get(key)) ?? '0') || 0;
	if (used >= cap) return { allowed: false, used, cap };
	await kv.put(key, String(used + 1), { expirationTtl: 2 * 86_400 });
	return { allowed: true, used: used + 1, cap };
}

/**
 * The same counter, read only. Reporting the day's spend must never consume any
 * of it — a band that closed the desk by looking at it would be a spend bound
 * that bills for being displayed.
 */
export async function readDailyCap(kv: KVNamespace, now: Date, cap: number, prefix = 'cap'): Promise<CapResult> {
	const used = Number((await kv.get(dayKey(now, prefix))) ?? '0') || 0;
	return { allowed: used < cap, used, cap };
}

export async function sha256Hex(text: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(length = 8): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = '';
	for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
	return out;
}

export const ID_RE = /^[a-z2-9]{6,12}$/;

// ---------------------------------------------------------------------------
// Turnstile (optional — only enforced when a secret is configured)
// ---------------------------------------------------------------------------

/**
 * The surface the widget is rendered for. siteverify echoes it back, so a token
 * minted for this action cannot be replayed against a different one. Served to
 * the client via /api/config so the two sides cannot drift apart.
 */
export const TURNSTILE_ACTION = 'staff';

/** Tokens are short-lived and single-use; anything this long is not one. */
const TURNSTILE_MAX_TOKEN = 2048;
const TURNSTILE_TIMEOUT_MS = 10_000;

/** `a.example, b.example` -> `['a.example', 'b.example']`. */
export function parseHostnames(raw: string | undefined): string[] {
	return (raw ?? '')
		.split(',')
		.map((h) => h.trim())
		.filter(Boolean);
}

export interface TurnstileCheck {
	secret: string;
	token: string;
	ip: string | null;
	/** Must equal the action the widget was rendered with. */
	action: string;
	/** Hosts allowed to mint a token. Empty refuses everything — fail closed. */
	hostnames: readonly string[];
}

/**
 * Unlike the other bounds here this one fails CLOSED. The rest of the desk
 * degrades to something serveable because the cost of a false negative is a
 * worse answer; here it is an unmoderated write, so a siteverify we cannot
 * complete is a refusal, not a pass.
 */
export async function verifyTurnstile(check: TurnstileCheck, fetcher = fetch): Promise<boolean> {
	const { secret, token, ip, action, hostnames } = check;
	if (!token || token.length > TURNSTILE_MAX_TOKEN || hostnames.length === 0) return false;
	const body = new URLSearchParams({ secret, response: token });
	if (ip) body.set('remoteip', ip);
	let data: { success?: boolean; action?: string; hostname?: string };
	try {
		const res = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			body,
			signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
		});
		if (!res.ok) return false;
		data = (await res.json()) as typeof data;
	} catch {
		return false;
	}
	// success alone is not enough: the token must be for this surface, minted on
	// a host we actually serve.
	return data.success === true && data.action === action && typeof data.hostname === 'string' && hostnames.includes(data.hostname);
}
