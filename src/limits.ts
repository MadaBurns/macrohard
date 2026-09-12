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

export async function verifyTurnstile(secret: string, token: string, ip: string | null, fetcher = fetch): Promise<boolean> {
	const body = new URLSearchParams({ secret, response: token });
	if (ip) body.set('remoteip', ip);
	const res = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
	if (!res.ok) return false;
	const data = (await res.json()) as { success?: boolean };
	return data.success === true;
}
