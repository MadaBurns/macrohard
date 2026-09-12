/**
 * "Staff your company" — the generator.
 *
 * Input is a short description of an organisation. Output is a costed agent
 * org chart. The model's JSON is validated against a strict schema and scrubbed
 * before it is stored or shown; if the model fails, a canned org stands in and
 * the response says so.
 */
import { z } from 'zod';
import type { AiLike } from './env';

const Clean = (max: number) => z.string().trim().min(1).max(max);

export const RoleSchema = z.object({
	role: Clean(48),
	tools: Clean(90),
	tokensPerDay: Clean(12),
	standsInFor: Clean(80),
});

export const OrgSchema = z.object({
	title: Clean(80),
	agents: z.number().int().min(1).max(60),
	runRateUsdPerDay: z.number().int().min(1).max(100_000),
	cycleTime: Clean(24),
	roles: z.array(RoleSchema).min(3).max(7),
});

export type Org = z.infer<typeof OrgSchema>;

export const QUERY_MAX = 200;

export function normalizeQuery(q: string): string {
	return q.replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
}

export function cacheKeyText(q: string): string {
	return normalizeQuery(q).toLowerCase();
}

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: string };

export function validateQuery(raw: unknown): QueryCheck {
	if (typeof raw !== 'string') return { ok: false, reason: 'Describe an organisation.' };
	const q = normalizeQuery(raw);
	if (q.length < 3) return { ok: false, reason: 'Describe an organisation in a few words.' };
	if (/https?:\/\/|www\./i.test(q)) return { ok: false, reason: 'Words, not links.' };
	if (/@/.test(q)) return { ok: false, reason: 'No email addresses, please.' };
	return { ok: true, query: q };
}

const URL_OR_EMAIL = /https?:\/\/\S+|www\.\S+|\S+@\S+/gi;

/** Strip anything link-shaped from model output before it is stored or shown. */
export function scrub(org: Org): Org {
	const s = (v: string) => v.replace(URL_OR_EMAIL, '').replace(/\s+/g, ' ').trim() || '—';
	return {
		title: s(org.title),
		agents: org.agents,
		runRateUsdPerDay: org.runRateUsdPerDay,
		cycleTime: s(org.cycleTime),
		roles: org.roles.map((r) => ({ role: s(r.role), tools: s(r.tools), tokensPerDay: s(r.tokensPerDay), standsInFor: s(r.standsInFor) })),
	};
}

// ---------------------------------------------------------------------------
// Fallback orgs — served when the model fails or the daily cap is reached.
// ---------------------------------------------------------------------------

export const FALLBACK_ORGS: Record<string, Org> = {
	saas: {
		title: 'A 200-person SaaS company',
		agents: 10,
		runRateUsdPerDay: 412,
		cycleTime: '4h 11m',
		roles: [
			{ role: 'Principal Agent', tools: 'repo write, CI, deploy keys', tokensPerDay: '2.4M', standsInFor: 'VP Engineering' },
			{ role: 'Feature Squad (x6)', tools: 'repo write, test runner', tokensPerDay: '9.1M', standsInFor: '42 engineers' },
			{
				role: 'Reviewer Agent',
				tools: 'read-only, policy gates',
				tokensPerDay: '1.8M',
				standsInFor: 'the staff engineer everyone waits on',
			},
			{ role: 'Incident Agent', tools: 'logs, alerts, rollback', tokensPerDay: '0.6M', standsInFor: 'the on-call rotation' },
			{ role: 'Support Agent', tools: 'ticket queue, docs corpus', tokensPerDay: '1.2M', standsInFor: '18 support staff' },
		],
	},
	agency: {
		title: 'A digital agency',
		agents: 6,
		runRateUsdPerDay: 178,
		cycleTime: '2h 40m',
		roles: [
			{ role: 'Art Direction Agent', tools: 'design tokens, asset store', tokensPerDay: '0.9M', standsInFor: '2 art directors' },
			{ role: 'Build Squad (x3)', tools: 'repo write, CI', tokensPerDay: '4.2M', standsInFor: '11 developers' },
			{ role: 'Copy Agent', tools: 'brand voice guide, CMS', tokensPerDay: '0.7M', standsInFor: '3 copywriters' },
			{ role: 'Account Agent', tools: 'inbox, invoicing', tokensPerDay: '0.4M', standsInFor: '4 account managers' },
		],
	},
	bank: {
		title: "A bank's IT department",
		agents: 8,
		runRateUsdPerDay: 356,
		cycleTime: '9h 02m',
		roles: [
			{ role: 'Change Agent', tools: 'repo write, change register', tokensPerDay: '1.6M', standsInFor: 'the change advisory board' },
			{ role: 'Compliance Agent', tools: 'policy corpus, audit log', tokensPerDay: '2.1M', standsInFor: '9 compliance analysts' },
			{ role: 'Maintenance Squad (x4)', tools: 'repo write, CI', tokensPerDay: '5.8M', standsInFor: '60 contractors' },
			{ role: 'Evidence Agent', tools: 'control tests, reporting', tokensPerDay: '1.1M', standsInFor: 'the quarterly audit scramble' },
		],
	},
	newsroom: {
		title: 'A newsroom',
		agents: 7,
		runRateUsdPerDay: 241,
		cycleTime: '38m',
		roles: [
			{ role: 'Desk Agent', tools: 'wire feeds, CMS', tokensPerDay: '1.4M', standsInFor: 'the night desk' },
			{ role: 'Reporter Squad (x4)', tools: 'research tools, CMS', tokensPerDay: '6.3M', standsInFor: '22 reporters' },
			{ role: 'Subeditor Agent', tools: 'style guide, CMS', tokensPerDay: '0.8M', standsInFor: '5 subeditors' },
			{ role: 'Legal Read Agent', tools: 'case corpus, flagging', tokensPerDay: '0.5M', standsInFor: 'a lawyer on retainer' },
		],
	},
	generic: {
		title: 'Your organisation',
		agents: 7,
		runRateUsdPerDay: 287,
		cycleTime: '5h 20m',
		roles: [
			{
				role: 'Principal Agent',
				tools: 'repo write, CI, deploy keys',
				tokensPerDay: '2.4M',
				standsInFor: 'whoever says "let us circle back"',
			},
			{ role: 'Delivery Squad (x4)', tools: 'repo write, test runner', tokensPerDay: '6.0M', standsInFor: 'most of the delivery team' },
			{ role: 'Reviewer Agent', tools: 'read-only, policy gates', tokensPerDay: '1.8M', standsInFor: 'the review bottleneck' },
			{ role: 'Operations Agent', tools: 'logs, alerts, rollback', tokensPerDay: '0.6M', standsInFor: 'the on-call rotation' },
		],
	},
};

const FALLBACK_HINTS: Array<[RegExp, keyof typeof FALLBACK_ORGS]> = [
	[/saas|software|startup|app/i, 'saas'],
	[/agency|studio|marketing|design/i, 'agency'],
	[/bank|finance|insur|fintech/i, 'bank'],
	[/news|paper|media|journal|publish/i, 'newsroom'],
];

export function pickFallback(query: string): Org {
	for (const [re, key] of FALLBACK_HINTS) if (re.test(query)) return { ...FALLBACK_ORGS[key], title: query };
	return { ...FALLBACK_ORGS.generic, title: query };
}

// ---------------------------------------------------------------------------
// Model call
// ---------------------------------------------------------------------------

const SYSTEM = `You are the restructuring desk at Macrohard, a software company operated entirely by AI agents.
Given a short description of an organisation, propose the agent org chart that would replace it.

Tone: dry, precise, corporate-deadpan. The humour comes from taking it completely seriously. No jokes that announce themselves. No exclamation marks.

Rules:
- 3 to 6 roles. Each role is one agent or a small squad ("Build Squad (x4)").
- "tools" lists what the agent can touch, e.g. "repo write, CI, deploy keys" or "ticket queue, docs corpus".
- "tokensPerDay" is a short figure like "2.4M".
- "standsInFor" names the human function it replaces — a role, a team, or a ritual ("the quarterly audit scramble"). Never a real person's name. Never a real company.
- "agents" is the total agent count. "runRateUsdPerDay" is a plausible whole-dollar daily token spend. "cycleTime" is a short duration like "4h 11m".
- "title" restates the organisation in a few words.
- Never include URLs, email addresses, real people or real companies. Do not mention Microsoft, xAI, Tesla or any named product.
Return only JSON matching the schema.`;

const JSON_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		agents: { type: 'integer' },
		runRateUsdPerDay: { type: 'integer' },
		cycleTime: { type: 'string' },
		roles: {
			type: 'array',
			minItems: 3,
			maxItems: 6,
			items: {
				type: 'object',
				properties: {
					role: { type: 'string' },
					tools: { type: 'string' },
					tokensPerDay: { type: 'string' },
					standsInFor: { type: 'string' },
				},
				required: ['role', 'tools', 'tokensPerDay', 'standsInFor'],
			},
		},
	},
	required: ['title', 'agents', 'runRateUsdPerDay', 'cycleTime', 'roles'],
};

export function buildInput(query: string): Record<string, unknown> {
	return {
		messages: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: `Organisation: ${query}` },
		],
		response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
		max_tokens: 700,
		temperature: 0.7,
	};
}

/** Pull a JSON object out of whatever shape the model returned. */
export function extractJson(result: unknown): unknown {
	if (result && typeof result === 'object' && 'response' in result) {
		const r = (result as { response: unknown }).response;
		if (typeof r === 'string') return parseLoose(r);
		return r;
	}
	if (typeof result === 'string') return parseLoose(result);
	return result;
}

function parseLoose(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		const m = text.match(/\{[\s\S]*\}/);
		if (!m) throw new Error('model returned no JSON');
		return JSON.parse(m[0]);
	}
}

export async function generateOrg(ai: AiLike, model: string, query: string): Promise<Org> {
	const raw = await ai.run(model, buildInput(query));
	const parsed = OrgSchema.parse(extractJson(raw));
	return scrub(parsed);
}
