/**
 * Receipts — the numbers on the front page, and the rule that produces them.
 *
 * Every figure here must be reproducible by a stranger from the public GitHub
 * API. The rule for "agent-authored" is deliberately mechanical: a commit whose
 * message carries a `Co-Authored-By: Claude …` trailer. Nothing is inferred
 * from author names or commit style.
 */

export interface GitHubCommit {
	sha: string;
	html_url: string;
	commit: { message: string; author: { name: string; date: string } | null };
}

export interface GitHubPull {
	number: number;
	html_url: string;
	created_at: string;
	merged_at: string | null;
}

export interface RepoInput {
	name: string;
	url: string;
	commits: GitHubCommit[];
	pulls: GitHubPull[];
}

export interface LedgerRow {
	sha: string;
	short: string;
	message: string;
	repo: string;
	url: string;
	date: string;
	agent: string;
}

export interface RepoSummary {
	name: string;
	url: string;
	totalCommits: number;
	agentCommits: number;
	prsMerged: number;
}

export interface Receipts {
	generatedAt: string;
	windowDays: number;
	since: string;
	totalCommits: number;
	agentCommits: number;
	agentShare: number; // 0..100, one decimal
	agentIdentities: string[];
	prsMerged: number;
	medianPrHours: number | null;
	ledger: LedgerRow[];
	repos: RepoSummary[];
	method: { agentRule: string; source: string };
}

export const RECEIPTS_KEY = 'receipts:latest';
export const LEDGER_ROWS = 8;

const TRAILER_RE = /^co-authored-by:\s*(claude[^<\n]*?)\s*<[^>]*>\s*$/gim;

/** Distinct agent identities named in a commit message's trailers. */
export function parseAgentTrailers(message: string): string[] {
	const out = new Set<string>();
	for (const m of message.matchAll(TRAILER_RE)) {
		const name = m[1].replace(/\s+/g, ' ').trim();
		if (name) out.add(name);
	}
	return [...out];
}

export function isAgentAuthored(message: string): boolean {
	return parseAgentTrailers(message).length > 0;
}

export function firstLine(message: string): string {
	return message.split('\n', 1)[0].trim();
}

export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

export function aggregate(inputs: RepoInput[], now: Date, windowDays: number): Receipts {
	const since = new Date(now.getTime() - windowDays * 86_400_000);
	const sinceIso = since.toISOString();

	let totalCommits = 0;
	let agentCommits = 0;
	let prsMerged = 0;
	const identities = new Set<string>();
	const prHours: number[] = [];
	const ledger: LedgerRow[] = [];
	const repos: RepoSummary[] = [];

	for (const repo of inputs) {
		let repoTotal = 0;
		let repoAgent = 0;
		let repoPrs = 0;

		for (const c of repo.commits) {
			const date = c.commit.author?.date ?? '';
			if (!date || date < sinceIso) continue;
			repoTotal++;
			const agents = parseAgentTrailers(c.commit.message);
			if (agents.length === 0) continue;
			repoAgent++;
			for (const a of agents) identities.add(a);
			ledger.push({
				sha: c.sha,
				short: c.sha.slice(0, 7),
				message: firstLine(c.commit.message),
				repo: repo.name,
				url: c.html_url,
				date,
				agent: agents[0],
			});
		}

		for (const p of repo.pulls) {
			if (!p.merged_at || p.merged_at < sinceIso) continue;
			repoPrs++;
			const hours = (Date.parse(p.merged_at) - Date.parse(p.created_at)) / 3_600_000;
			if (Number.isFinite(hours) && hours >= 0) prHours.push(hours);
		}

		totalCommits += repoTotal;
		agentCommits += repoAgent;
		prsMerged += repoPrs;
		repos.push({ name: repo.name, url: repo.url, totalCommits: repoTotal, agentCommits: repoAgent, prsMerged: repoPrs });
	}

	ledger.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

	const med = median(prHours);
	return {
		generatedAt: now.toISOString(),
		windowDays,
		since: sinceIso,
		totalCommits,
		agentCommits,
		agentShare: totalCommits === 0 ? 0 : round1((agentCommits / totalCommits) * 100),
		agentIdentities: [...identities].sort(),
		prsMerged,
		medianPrHours: med === null ? null : round1(med),
		ledger: ledger.slice(0, LEDGER_ROWS),
		repos,
		method: {
			agentRule: 'A commit is agent-authored when its message carries a "Co-Authored-By: Claude …" trailer.',
			source: 'GitHub REST API: /repos/{owner}/{repo}/commits?since=… and /repos/{owner}/{repo}/pulls?state=closed',
		},
	};
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_PAGES = 10;

const GITHUB_API = 'https://api.github.com/';

/** The `next` page from a Link header — only if it stays on the GitHub API host. */
export function nextLink(res: Response): string | null {
	const link = res.headers.get('link');
	if (!link) return null;
	for (const part of link.split(',')) {
		const m = part.match(/<([^>]+)>;\s*rel="next"/);
		if (m && m[1].startsWith(GITHUB_API)) return m[1];
	}
	return null;
}

const BASE_HEADERS: Record<string, string> = {
	accept: 'application/vnd.github+json',
	'user-agent': 'macrohard.nz receipts (+https://macrohard.nz/method)',
	'x-github-api-version': '2022-11-28',
};

/**
 * Fetch with the token when there is one, and fall back to an anonymous request
 * if GitHub rejects it (401 — bad, revoked, expired or whitespace-mangled).
 *
 * A token is an optimisation here: it lifts the anonymous 60/hr ceiling so the
 * cron stops losing to shared egress IPs. It must never be load-bearing — before
 * the secret existed the anonymous path worked, and a bad secret must not be able
 * to freeze the snapshot permanently. `tokenState` is shared across a refresh so
 * one rejection disables the token for the rest of it rather than doubling every
 * request.
 */
export interface TokenState {
	rejected: boolean;
}

async function ghFetch(fetcher: Fetcher, url: string, token: string | undefined, state: TokenState): Promise<Response> {
	const clean = token?.trim();
	if (clean && !state.rejected) {
		const res = await fetcher(url, { headers: { ...BASE_HEADERS, authorization: `Bearer ${clean}` } });
		if (res.status !== 401) return res;
		state.rejected = true;
		console.error('GitHub rejected GITHUB_TOKEN (401) — falling back to anonymous for this refresh');
	}
	return fetcher(url, { headers: BASE_HEADERS });
}

async function paginate<T>(
	fetcher: Fetcher,
	url: string,
	token: string | undefined,
	state: TokenState,
	stop?: (page: T[]) => boolean,
): Promise<T[]> {
	const out: T[] = [];
	let next: string | null = url;
	for (let i = 0; i < MAX_PAGES && next; i++) {
		const res = await ghFetch(fetcher, next, token, state);
		if (!res.ok) throw new Error(`GitHub ${res.status} for ${next}`);
		const page = (await res.json()) as T[];
		out.push(...page);
		if (stop && stop(page)) break;
		next = nextLink(res);
	}
	return out;
}

export async function fetchRepo(
	fetcher: Fetcher,
	owner: string,
	name: string,
	since: Date,
	token?: string,
	state: TokenState = { rejected: false },
): Promise<RepoInput> {
	const base = `https://api.github.com/repos/${owner}/${name}`;
	const sinceIso = since.toISOString();
	const commits = await paginate<GitHubCommit>(fetcher, `${base}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`, token, state);
	// Closed PRs come newest-updated first; stop once a whole page predates the window.
	const pulls = await paginate<GitHubPull>(
		fetcher,
		`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
		token,
		state,
		(page) => page.length > 0 && page.every((p) => p.created_at < sinceIso && (!p.merged_at || p.merged_at < sinceIso)),
	);
	return { name, url: `https://github.com/${owner}/${name}`, commits, pulls };
}

export interface RefreshOpts {
	owner: string;
	repos: string[];
	windowDays: number;
	token?: string;
	now?: Date;
	fetcher?: Fetcher;
}

export async function refreshReceipts(kv: KVNamespace, opts: RefreshOpts): Promise<Receipts> {
	const now = opts.now ?? new Date();
	const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
	const since = new Date(now.getTime() - opts.windowDays * 86_400_000);
	// One state across the whole refresh: a rejected token is disabled once, not per repo.
	const state: TokenState = { rejected: false };
	const inputs = await Promise.all(opts.repos.map((r) => fetchRepo(fetcher, opts.owner, r, since, opts.token, state)));
	const receipts = aggregate(inputs, now, opts.windowDays);
	// A snapshot that shows zeros is worse than a stale one: keep it if nothing was counted.
	if (receipts.totalCommits === 0) {
		const prev = await kv.get<Receipts>(RECEIPTS_KEY, 'json');
		if (prev) return prev;
	}
	await kv.put(RECEIPTS_KEY, JSON.stringify(receipts));
	return receipts;
}

export async function getReceipts(kv: KVNamespace): Promise<Receipts | null> {
	return kv.get<Receipts>(RECEIPTS_KEY, 'json');
}

export function isStale(r: Receipts, now: Date, maxAgeMs: number): boolean {
	return now.getTime() - Date.parse(r.generatedAt) > maxAgeMs;
}
