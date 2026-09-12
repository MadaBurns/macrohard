/**
 * Spend controls. Two layers on top of the per-IP rate-limit binding:
 *  - a global daily cap on model calls (KV counter, UTC day)
 *  - a per-query result cache so repeat prompts cost nothing
 */

export function dayKey(now: Date): string {
	return `cap:${now.toISOString().slice(0, 10)}`;
}

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
export async function consumeDailyCap(kv: KVNamespace, now: Date, cap: number): Promise<CapResult> {
	const key = dayKey(now);
	const used = Number((await kv.get(key)) ?? '0') || 0;
	if (used >= cap) return { allowed: false, used, cap };
	await kv.put(key, String(used + 1), { expirationTtl: 2 * 86_400 });
	return { allowed: true, used: used + 1, cap };
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
