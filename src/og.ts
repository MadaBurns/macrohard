/**
 * Share cards for permalinks. The HTML is rendered to PNG once by Browser
 * Rendering and cached in KV; the front page's generic card is the fallback.
 */
import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer';
import type { Org } from './staff';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (ch) => ESC[ch]);
}

export function fmtUsd(n: number): string {
	return n.toLocaleString('en-US');
}

/** What a shared link says in the card title. */
export function shareTitle(org: Org): string {
	return `${org.title} — ${org.agents} agents, USD ${fmtUsd(org.runRateUsdPerDay)}/day`;
}

/** The card description: the first role's "stands in for" line does the work. */
export function shareDescription(org: Org): string {
	const first = org.roles[0];
	return `Proposed restructuring by Macrohard: ${org.roles.length} roles, cycle time ${org.cycleTime}. ${first.role} stands in for ${first.standsInFor}.`;
}

/** Pre-written share copy. Under 200 characters before the URL is appended. */
export function shareText(org: Org): string {
	const first = org.roles[0];
	return `Macrohard restructured "${org.title}": ${org.agents} agents at USD ${fmtUsd(org.runRateUsdPerDay)}/day. ${first.role} stands in for ${first.standsInFor}.`;
}

const FONTS =
	'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';

export function ogCardHtml(org: Org): string {
	const rows = org.roles
		.slice(0, 4)
		.map(
			(r) => `<div class="row"><span class="role">${escapeHtml(r.role)}</span><span class="for">${escapeHtml(r.standsInFor)}</span></div>`,
		)
		.join('');
	const titleSize = org.title.length > 40 ? 52 : 66;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>
body{margin:0}
.card{width:1200px;height:630px;box-sizing:border-box;padding:52px 64px;background:#f7f4ee;color:#16130f;font-family:'IBM Plex Sans',sans-serif;display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;justify-content:space-between;align-items:center}
.wm{font-size:18px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
.eb{font-family:'IBM Plex Mono',monospace;font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:#9c4a1a}
h1{margin:14px 0 0;font-family:Newsreader,Georgia,serif;font-weight:400;font-size:${titleSize}px;line-height:1.02;letter-spacing:-.02em;max-width:1060px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nums{display:flex;gap:56px;margin-top:18px}
.nums div{display:flex;flex-direction:column;gap:4px}
.nums b{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:40px;letter-spacing:-.03em}
.nums span{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#6b6459}
.roles{border-top:1px solid #16130f;margin-top:18px}
.row{display:flex;justify-content:space-between;gap:40px;padding:11px 0;border-bottom:1px solid #ece5d9;font-size:19px}
.role{font-weight:500}.for{color:#463f35;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:640px}
.bot{display:flex;justify-content:space-between;align-items:center;margin-top:14px;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#6b6459}
</style></head><body><div class="card">
<div class="top"><span class="wm">Macrohard</span><span class="eb">Note 2 — Proposed restructuring</span></div>
<h1>${escapeHtml(org.title)}</h1>
<div class="nums"><div><b>${org.agents}</b><span>agents</span></div><div><b>USD ${fmtUsd(org.runRateUsdPerDay)}</b><span>per day</span></div><div><b>${escapeHtml(org.cycleTime)}</b><span>cycle time</span></div></div>
<div class="roles">${rows}</div>
<div class="bot"><span>Stands in for the people on the right</span><span>macrohard.nz</span></div>
</div></body></html>`;
}

export async function renderOgPng(browser: BrowserWorker, html: string): Promise<Uint8Array> {
	const b = await puppeteer.launch(browser);
	try {
		const page = await b.newPage();
		await page.setViewport({ width: 1200, height: 630 });
		await page.setContent(html, { waitUntil: 'networkidle0' });
		await page.evaluate('document.fonts.ready');
		const png = await page.screenshot({ type: 'png' });
		return new Uint8Array(png);
	} finally {
		await b.close();
	}
}
