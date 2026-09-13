/* Macrohard front page. No framework; two fetches; one form. */
(() => {
	'use strict';

	const $ = (sel, root = document) => root.querySelector(sel);
	const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
	const r = (name) => $(`[data-r="${name}"]`);

	// ---------------------------------------------------------------------
	// Formatting
	// ---------------------------------------------------------------------
	const fmtInt = (n) => Number(n).toLocaleString('en-NZ');

	function fmtHours(h) {
		if (h === null || h === undefined || !Number.isFinite(h)) return '—';
		if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
		if (h < 48) return `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
		return `${(h / 24).toFixed(1)}d`;
	}

	function fmtAgo(iso) {
		const ms = Date.now() - Date.parse(iso);
		if (!Number.isFinite(ms)) return '';
		const m = Math.round(ms / 60000);
		if (m < 60) return `${Math.max(1, m)}m ago`;
		const h = Math.round(m / 60);
		if (h < 48) return `${h}h ago`;
		return `${Math.round(h / 24)}d ago`;
	}

	const fmtShare = (agent, total) => (total ? `${Math.round((agent / total) * 1000) / 10}%` : '—');
	const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
	const fmtSmall = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : fmtInt(n));

	// ---------------------------------------------------------------------
	// Motion
	//
	// Nothing here loops for atmosphere: a figure moves only when the snapshot
	// says it moved, and it wears its change marker until the next snapshot
	// replaces or clears it. Reduced motion drops every animation to its end
	// state — the values still change, because those are content.
	// ---------------------------------------------------------------------
	const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function countTo(el, from, to, fmt, dp) {
		const t0 = performance.now();
		const step = (t) => {
			const p = Math.min(1, (t - t0) / 700);
			const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
			el.textContent = fmt(dp ? Math.round(v * 10) / 10 : Math.round(v));
			if (p < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	/** Set a figure; count to it when it moved, and say what it moved by. */
	function setNum(name, value, fmt, dp) {
		const el = r(name);
		if (!el) return;
		const had = el.dataset.v !== undefined;
		const prev = had ? Number(el.dataset.v) : null;
		el.dataset.v = String(value);
		if (!had || prev === value || still()) el.textContent = fmt(value);
		else countTo(el, prev, value, fmt, dp);

		const chip = $(`[data-d="${name}"]`);
		if (!chip) return;
		const up = had && value > prev ? Math.round((value - prev) * 10) / 10 : 0;
		chip.textContent = up ? `+${up}` : '';
		chip.hidden = !up;
	}

	// ---------------------------------------------------------------------
	// Receipts
	// ---------------------------------------------------------------------
	let warmTries = 0;
	// Bounded: a snapshot that stays stale (the token lapsed, GitHub is refusing
	// us) must not turn every open tab into a request every eight seconds for
	// as long as it is open. After a few looks, the minute poll is enough.
	let staleTries = 0;
	const STALE_TRIES = 3;
	// Commits the page has shown, and the subset that landed while you watched.
	const seenShas = new Set();
	const freshShas = new Set();
	let firstLedger = true;

	async function loadReceipts() {
		let res;
		try {
			res = await fetch('/api/receipts', { headers: { accept: 'application/json' } });
		} catch {
			return;
		}
		if (res.status === 202) {
			if (warmTries++ < 12) setTimeout(loadReceipts, 5000);
			return;
		}
		if (!res.ok) return;
		renderReceipts(await res.json());
	}

	function renderReceipts(d) {
		live.receipts = d;
		setNum('agentCommits', d.agentCommits, fmtInt);
		setNum('prsMerged', d.prsMerged, fmtInt);
		r('medianPr').textContent = fmtHours(d.medianPrHours);
		setNum('agentIdentities', (d.agentIdentities || []).length, fmtInt);
		setNum('agentShare', d.agentShare, (n) => `${n}%`, 1);
		r('asof').textContent = d.generatedAt ? `As of ${fmtAgo(d.generatedAt)}.` : '';

		const rows = $('#ledger-rows');
		const tpl = $('#tpl-ledger-row');
		rows.replaceChildren();
		for (const row of d.ledger || []) {
			const node = tpl.content.firstElementChild.cloneNode(true);
			const sha = $('[data-f="sha"]', node);
			sha.textContent = row.short;
			sha.href = row.url;
			$('[data-f="message"]', node).textContent = row.message;
			$('[data-f="message"]', node).title = row.message;
			$('[data-f="repo"]', node).textContent = row.repo;
			$('[data-f="agent"]', node).textContent = row.agent;
			$('[data-f="when"]', node).textContent = fmtAgo(row.date);
			// New means "since the snapshot this page opened on", not "since you
			// reloaded" — otherwise every visit re-announces the same eight rows.
			const arrived = !firstLedger && !seenShas.has(row.sha);
			seenShas.add(row.sha);
			if (arrived) freshShas.add(row.sha);
			if (freshShas.has(row.sha)) {
				node.classList.add('fresh');
				$('[data-f="tag"]', node).hidden = false;
			}
			if (arrived) {
				node.classList.add('tint', 'arriving');
				setTimeout(() => node.classList.remove('tint'), 8000);
			}
			rows.appendChild(node);
		}
		firstLedger = false;
		if (!(d.ledger || []).length) {
			rows.innerHTML = '<div class="ledger-empty">No agent-authored commits in the window.</div>';
		}
		const more = Math.max(0, (d.agentCommits || 0) - (d.ledger || []).length);
		const foot = r('ledgerMore');
		foot.replaceChildren();
		const repos = d.repos || [];
		if (repos.length) {
			foot.append(more ? `${fmtInt(more)} more in ` : 'Repositories: ');
			repos.forEach((x, i) => {
				const a = document.createElement('a');
				a.href = `${x.url}/commits`;
				a.rel = 'noopener';
				a.textContent = x.name;
				foot.append(a, i < repos.length - 1 ? ', ' : '');
			});
		}

		renderSegments(d);
		renderSelf(d);
		renderIdentities(d);
		renderRun(d);
		renderBand();
		// A refresh is already in flight upstream; look again rather than wait for the minute.
		if (!d.stale) staleTries = 0;
		else if (staleTries++ < STALE_TRIES) setTimeout(loadReceipts, 8000);
	}

	// ---------------------------------------------------------------------
	// The band, and Note 10's run strip
	//
	// Only what the Worker actually knows. The age of the figures and the token
	// state ride on the snapshot; the desk and the guard come from /api/live.
	// The countdown is arithmetic on a */30 cron, not a promise.
	// ---------------------------------------------------------------------
	const live = { receipts: null, desk: null, guard: null };
	const bandEl = $('#live');
	const dotEl = $('#live-dot');
	const labelEl = $('#live-label');
	const factsEl = $('#live-facts');

	const two = (n) => String(n).padStart(2, '0');

	function nextRun(now = new Date()) {
		const d = new Date(now);
		d.setUTCSeconds(0, 0);
		d.setUTCMinutes(d.getUTCMinutes() < 30 ? 30 : 60);
		return d;
	}

	function countdown(to, now = Date.now()) {
		const s = Math.max(0, Math.round((to - now) / 1000));
		return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
	}

	function fact(label, value, warn) {
		const span = document.createElement('span');
		if (warn) {
			span.className = 'live-warn';
			span.textContent = value;
			return span;
		}
		span.append(`${label} `);
		const b = document.createElement('b');
		b.textContent = value;
		span.append(b);
		return span;
	}

	function renderRun(d) {
		const at = Date.parse(d.generatedAt);
		if (Number.isFinite(at)) r('runAt').textContent = `${new Date(at).toISOString().slice(11, 19)}Z`;
		r('runRepos').textContent = fmtInt((d.repos || []).length);
		r('runWindow').textContent = `${fmtInt(d.windowDays || 90)}d`;
		r('runCommits').textContent = fmtInt(d.totalCommits);
	}

	function renderBand() {
		const d = live.receipts;
		if (!d || !bandEl) return;
		const spent = live.desk && live.desk.cap > 0 && live.desk.used >= live.desk.cap;
		const lapsed = d.tokenRejected === true;
		const at = Date.parse(d.generatedAt);

		const label = lapsed ? 'Running unauthenticated' : d.stale ? 'Reading GitHub' : 'Running';
		if (labelEl.textContent !== label) labelEl.textContent = label;
		// Only when it changes: reassigning restarts the pulse every tick.
		const cls = `live-dot${lapsed ? ' lapsed' : spent ? ' hollow' : ' beat'}`;
		if (dotEl.className !== cls) dotEl.className = cls;

		const bits = [];
		if (Number.isFinite(at)) bits.push(fact('Refreshed', `${new Date(at).toISOString().slice(11, 16)}Z`));
		// A countdown the Worker cannot honour is a forecast, and the company issues none.
		bits.push(lapsed ? fact('', `${fmtAgo(d.generatedAt).replace(' ago', '')} old`, true) : fact('Next in', countdown(nextRun())));
		if (live.desk) {
			bits.push(
				spent ? fact('', 'Desk closed · reopens 00:00Z', true) : fact('Desk open', `${fmtInt(live.desk.used)}/${fmtInt(live.desk.cap)}`),
			);
		}
		if (live.guard) bits.push(live.guard === 'degraded' ? fact('', 'Guard unreachable', true) : fact('Guard', 'ok'));

		factsEl.replaceChildren();
		bits.forEach((b, i) => {
			if (i) {
				const sep = document.createElement('span');
				sep.className = 'live-sep';
				sep.textContent = '/';
				factsEl.append(sep);
			}
			factsEl.append(b);
		});
		bandEl.hidden = false;

		if (r('runNext')) r('runNext').textContent = `in ${countdown(nextRun())}`;
		if (r('cycleAge') && Number.isFinite(at)) r('cycleAge').textContent = `· ran ${fmtAgo(d.generatedAt)}`;
	}

	async function loadLive() {
		try {
			const l = await (await fetch('/api/live')).json();
			live.desk = l.desk || null;
			live.guard = l.guard || null;
		} catch {
			/* the band degrades to the half the snapshot already carries */
		}
		renderBand();
	}

	function renderSegments(d) {
		const rows = $('#segment-rows');
		const tpl = $('#tpl-segment-row');
		if (!rows || !tpl) return;
		rows.replaceChildren();
		const repos = [...(d.repos || [])].sort((a, b) => b.totalCommits - a.totalCommits);
		for (const x of repos) {
			const node = tpl.content.firstElementChild.cloneNode(true);
			const a = $('[data-f="name"]', node);
			a.textContent = x.name;
			a.href = `${x.url}/commits`;
			$('[data-f="total"]', node).textContent = fmtInt(x.totalCommits);
			$('[data-f="agent"]', node).textContent = fmtInt(x.agentCommits);
			$('[data-f="share"]', node).textContent = fmtShare(x.agentCommits, x.totalCommits);
			$('[data-f="prs"]', node).textContent = fmtInt(x.prsMerged);
			rows.appendChild(node);
		}
		r('segTotal').textContent = fmtInt(d.totalCommits);
		r('segAgent').textContent = fmtInt(d.agentCommits);
		r('segShare').textContent = `${d.agentShare}%`;
		r('segPrs').textContent = fmtInt(d.prsMerged);
	}

	function renderSelf(d) {
		const el = $('#note-self');
		if (!el) return;
		const me = (d.repos || []).find((x) => x.name === el.dataset.self);
		if (!me) return;
		r('selfAgent').textContent = fmtInt(me.agentCommits);
		r('selfTotal').textContent = fmtInt(me.totalCommits);
		const rest = me.totalCommits - me.agentCommits;
		r('selfRest').textContent =
			rest === 0
				? 'All of them.'
				: rest === 1
					? 'The one that does not is a merge, performed by the human.'
					: `The ${fmtSmall(rest)} that do not are merges, performed by the human.`;
	}

	function renderIdentities(d) {
		const ul = $('#kmp-list');
		if (!ul) return;
		const names = d.agentIdentities || [];
		ul.replaceChildren(...names.map((n) => Object.assign(document.createElement('li'), { textContent: n })));
		const bare = $('#kmp-bare');
		if (bare) bare.hidden = !names.includes('Claude');
	}

	// ---------------------------------------------------------------------
	// Staff your company
	// ---------------------------------------------------------------------
	const form = $('#staff-form');
	const input = $('#staff-q');
	const go = $('#staff-go');
	const err = $('#staff-err');
	const out = $('#staff-out');
	let turnstileToken = null;
	let turnstileWidget = null;

	async function loadConfig() {
		try {
			const cfg = await (await fetch('/api/config')).json();
			if (cfg.turnstileSiteKey) mountTurnstile(cfg.turnstileSiteKey, cfg.turnstileAction);
		} catch {
			/* config is optional */
		}
	}

	function mountTurnstile(sitekey, action) {
		const s = document.createElement('script');
		s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		s.async = true;
		s.onload = () => {
			turnstileWidget = window.turnstile.render('#turnstile', {
				sitekey,
				action,
				callback: (t) => (turnstileToken = t),
				'expired-callback': () => (turnstileToken = null),
				theme: 'light',
			});
		};
		document.head.appendChild(s);
	}

	function setBusy(on) {
		go.disabled = on;
		out.classList.toggle('busy', on);
		if (on) out.innerHTML = '<div class="staff-empty">Costing the proposal…</div>';
	}

	function showError(msg) {
		err.textContent = msg;
		err.hidden = !msg;
	}

	function setPressed(query) {
		for (const c of $$('.chip')) c.setAttribute('aria-pressed', String(c.dataset.q.toLowerCase() === (query || '').toLowerCase()));
	}

	async function submit(query) {
		showError('');
		setPressed(query);
		setBusy(true);
		let res;
		try {
			res = await fetch('/api/staff', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query, turnstile: turnstileToken }),
			});
		} catch {
			setBusy(false);
			out.innerHTML = '<div class="staff-empty">Network trouble. Try again.</div>';
			return;
		}
		setBusy(false);
		if (turnstileWidget !== null && window.turnstile) {
			window.turnstile.reset(turnstileWidget);
			turnstileToken = null;
		}
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			out.innerHTML = '<div class="staff-empty">No organisation proposed yet.</div>';
			showError(body.error || 'Something went wrong.');
			return;
		}
		renderOrg(body.org, body.mode, body.id, body.share, body.moderated);
		if (body.id) history.replaceState(null, '', `/s/${body.id}`);
		// Not counted server-side when the guard could not answer, so do not count it here either.
		if (body.mode === 'ai' && !body.cached && body.moderated !== false) bumpCounter();
	}

	// ---------------------------------------------------------------------
	// Counter
	// ---------------------------------------------------------------------
	let restructured = 0;

	function showCounter() {
		const el = r('restructured');
		if (!el) return;
		el.textContent = restructured > 0 ? `${fmtInt(restructured)} organisation${restructured === 1 ? '' : 's'} restructured to date.` : '';
	}

	async function loadStats() {
		try {
			const s = await (await fetch('/api/stats')).json();
			restructured = Number(s.restructured) || 0;
			showCounter();
		} catch {
			/* cosmetic */
		}
	}

	function bumpCounter() {
		restructured += 1;
		showCounter();
	}

	function renderOrg(org, mode, id, share, moderated) {
		const tpl = $('#tpl-org');
		const node = tpl.content.firstElementChild.cloneNode(true);
		$('[data-f="title"]', node).textContent = org.title;
		$('[data-f="agents"]', node).textContent = fmtInt(org.agents);
		$('[data-f="cost"]', node).textContent = `USD ${fmtInt(org.runRateUsdPerDay)} / day`;
		$('[data-f="cycle"]', node).textContent = org.cycleTime;
		const roles = $('[data-f="roles"]', node);
		const rtpl = $('#tpl-role');
		for (const role of org.roles) {
			const rn = rtpl.content.firstElementChild.cloneNode(true);
			$('[data-f="role"]', rn).textContent = role.role;
			$('[data-f="tools"]', rn).textContent = role.tools;
			$('[data-f="tokens"]', rn).textContent = role.tokensPerDay;
			$('[data-f="standsInFor"]', rn).textContent = role.standsInFor;
			roles.appendChild(rn);
		}
		if (mode === 'fallback') {
			const note = $('[data-f="note"]', node);
			note.classList.add('fallback');
			note.textContent =
				'The model was unavailable or the day’s budget is spent, so this is one of our standing proposals. Figures are illustrative.';
		} else if (moderated === false) {
			const note = $('[data-f="note"]', node);
			note.classList.add('fallback');
			note.textContent = 'The safety check could not answer, so this one is yours only: it is not saved and has no link.';
		}
		const copy = $('[data-f="copy"]', node);
		const post = $('[data-f="post"]', node);
		if (id) {
			const url = `${location.origin}/s/${id}`;
			const text = share || `Macrohard restructured "${org.title}": ${org.agents} agents at USD ${fmtInt(org.runRateUsdPerDay)}/day.`;
			post.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${text}\n\n${url}`)}`;
			copy.addEventListener('click', async () => {
				try {
					await navigator.clipboard.writeText(`${location.origin}/s/${id}`);
					copy.textContent = 'Copied';
					setTimeout(() => (copy.textContent = 'Copy link'), 1500);
				} catch {
					copy.textContent = `${location.origin}/s/${id}`;
				}
			});
		} else {
			copy.remove();
			post.remove();
		}
		out.replaceChildren(node);
	}

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const q = input.value.trim();
		if (q.length < 3) return showError('Describe an organisation in a few words.');
		submit(q);
	});

	for (const chip of $$('.chip')) {
		chip.addEventListener('click', () => {
			input.value = chip.dataset.q;
			submit(chip.dataset.q);
		});
	}

	async function loadPermalink() {
		const m = location.pathname.match(/^\/s\/([a-z2-9]{6,12})$/);
		if (!m) return;
		try {
			const res = await fetch(`/api/s/${m[1]}`);
			if (!res.ok) return;
			const stored = await res.json();
			input.value = stored.query;
			setPressed(stored.query);
			renderOrg(stored.org, stored.mode, stored.id, stored.share);
			$('#staff').scrollIntoView({ block: 'start' });
		} catch {
			/* leave the empty state */
		}
	}

	// One request a minute while the tab is visible, which the 60s cache header on
	// /api/receipts already sizes. A hidden tab costs nothing.
	function poll() {
		if (document.hidden) return;
		loadReceipts();
		loadLive();
	}

	if (bandEl) {
		setInterval(poll, 60_000);
		setInterval(() => {
			if (!document.hidden) renderBand();
		}, 1000);
		document.addEventListener('visibilitychange', poll);
	}

	loadReceipts();
	loadLive();
	loadConfig();
	loadStats();
	loadPermalink();
})();
