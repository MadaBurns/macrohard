# Editorial direction — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sharpen macrohard.nz's annual-report voice: a nervier hero, five new receipted notes, a risks note and cautionary statement, a share card and 404 that carry the bit, and the removal of every line that hedges, winks, or claims something the site cannot prove.

**Architecture:** Every change is in `public/` (HTML, CSS, `app.js`, a new `404.js`), `test/assets.spec.ts`, `scripts/`, and docs. Nothing in `src/` changes: every new figure on the page comes from fields `/api/receipts` already returns (`repos[]`, `agentIdentities`, totals). The share image `og.png` is a static asset rendered once from `og.html` with headless Chrome via a new script.

**Tech Stack:** Static HTML/CSS/vanilla JS (no framework, no build step), vitest inside the Workers runtime for content assertions, prettier (tabs, single quotes, printWidth 140), headless Google Chrome for the PNG.

**Spec:** `docs/superpowers/specs/2026-09-12-macrohard-nz-design.md` (project rules) plus the editorial brief this plan encodes. The copy in this plan is the copy; there is no separate copy document.

## Global Constraints

- Every published sentence must be true and every figure reproducible by a stranger from the public GitHub API (design spec, "Constraints"). No new figure may be hard-coded if the API can supply it.
- Never claim agents review pull requests: measured at zero reviews (`docs/superpowers/2026-09-12-receipts-scope-adjudication.md`, "Also checked").
- Parody only. Do not name Microsoft, xAI or Tesla anywhere new; the footer disclaimer and the Note 9 offer are the only places they appear.
- Framework-free, no build step. Keep the existing palette and type scale in `public/styles.css`; new CSS uses the existing custom properties only.
- The CSP in `public/_headers` is `script-src 'self'`: **no inline `<script>`** anywhere. Scripts are separate files under `public/`.
- `wrangler.jsonc` `assets.run_worker_first` is not touched: every new file under `public/` is a plain static asset.
- Tests stay hermetic: `test/` never touches the network. Front-end behaviour is verified by content assertions through `SELF.fetch` plus a manual `npm run dev` look.
- Formatting: `npm run format` before every commit; CI runs `format:check` over the whole tree, including this plan file and every `.md` you touch.
- **Every commit carries the trailer** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on its own line at the end of the message. This repository counts itself; a commit without the trailer is published as not agent-authored.
- Do not deploy. `npm run deploy` is operator-run. Do not merge the PR.
- Baseline chain, run before every commit and pasted into the PR body at the end: `npm run typecheck && npm test && npm run format:check`.

## Decisions taken in this plan

Two of the brief's options had alternatives. This plan builds the recommended one; the alternates are in the appendix so a swap is a copy-paste.

| Choice     | Built here                  | Alternates (Appendix)              |
| ---------- | --------------------------- | ---------------------------------- |
| Hero       | V3 "Headcount: one."        | V1 "runs itself", V2 "git log"     |
| Share card | B "Headcount" (two numbers) | A "Cover" with a four-figure strip |

Note numbering after this plan: 1 Work performed · 2 Proposed restructuring (unchanged, because `src/og.ts` prints "Note 2") · 3 Segment information · 4 Basis of preparation · 5 Related parties · 6 Key management personnel · 7 Off-balance-sheet arrangements · 8 Principal risks · 9 Subsequent events. The 404 page stops calling itself "Note 4".

## File map

| File                                           | Responsibility after this plan                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `public/index.html`                            | Hero V3, corrected claims, Notes 3–9, cautionary band, templates for new rows         |
| `public/styles.css`                            | Existing styles + `.seg-row`, `.notes-*`, `.nnote`, `.risk-list`, `.caution`          |
| `public/app.js`                                | Existing + `renderSegments`, `renderSelf`, `renderIdentities`; four string fixes      |
| `public/method.html`                           | Four repos; provable headcount; "not agent-authored"; refresh guarantee; new sections |
| `public/404.html` + `public/404.js`            | Auditor's qualified opinion; path filled by external script                           |
| `public/og.html` + `public/og.css`             | Share card B source                                                                   |
| `public/og.png`                                | Rendered from the above by `scripts/og-png.sh`                                        |
| `scripts/og-png.sh`                            | Headless-Chrome render of `og.html` → `og.png`, 1200×630                              |
| `test/assets.spec.ts`                          | Content assertions for every copy change                                              |
| `scripts/e2e.sh`                               | 404 marker string updated                                                             |
| `README.md`, design spec, backlog, `CLAUDE.md` | Docs brought in line; backlog Done lines                                              |

---

### Task 1: Hero V3 and the corrected front-page claims

**Files:**

- Modify: `public/index.html` (the `<meta name="description">`, `<meta property="og:description">`, `.hero-copy`, `.note-aside` in Note 1, the offer paragraph)
- Test: `test/assets.spec.ts`

**Interfaces:**

- Produces: nothing programmatic. Later tasks assume the hero `<h1>` is `Headcount: <em>one</em>.` and that the string `runs itself` still appears in the `<title>` and `og:title` meta (Task 7 and `test/share.spec.ts` rely on that).

- [ ] **Step 1: Write the failing test**

Prettier re-wraps prose inside HTML at 140 columns, so a sentence can straddle a line break in the source. Every prose assertion in this plan goes through `flat`, which collapses whitespace. Add it once, under `const ORIGIN` in `test/assets.spec.ts`:

```ts
const flat = (s: string) => s.replace(/\s+/g, ' ');
```

Then add to the `describe` block:

```ts
it('hero claims only what the receipts support', async () => {
	const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
	expect(html).toContain('Headcount: <em>one</em>.');
	expect(html).not.toContain('review each other');
	expect(html).not.toContain('mostly watches');
	expect(html).not.toContain('Every figure on this page links to the public commit');
	expect(html).toContain('every line of the ledger links to the commit that proves it');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/assets.spec.ts -t 'hero claims'`
Expected: FAIL on `Headcount: <em>one</em>.`

- [ ] **Step 3: Replace the hero copy**

In `public/index.html`, replace the `<h1>` and `<p class="lede">` inside `.hero-copy` with:

```html
<h1>Headcount: <em>one</em>.</h1>
<p class="lede">
	Macrohard is an engineering organisation run by AI agents. They write the code, sign for it, and open every release. The one human on the
	books holds the deploy key and presses it when the tests are green. No meetings are held; there is no one to hold them with. Every figure
	on this page is live from the public GitHub API, and every line of the ledger links to the commit that proves it.
</p>
```

- [ ] **Step 4: Fix the two meta descriptions**

Replace the `content` of `<meta name="description">` with:

```
Macrohard is an engineering organisation operated by AI agents. Every figure is live from the public GitHub API and every line of the ledger links to the commit that proves it. Annual Report, FY2026.
```

Leave `og:description` as it is ("Receipts included." makes no false claim).

- [ ] **Step 5: Fix the Note 1 aside and the offer sentence**

Note 1 aside: replace `No screenshots, no dashboards we control. Click any hash and you land on GitHub.` with:

```
Click any hash; you land on GitHub.
```

Offer paragraph (`.offer-p`): replace the last sentence `If you would rather talk about the agents that built this page instead, that works too.` with:

```
If you would rather talk about the agents that built this page, the address is the same.
```

- [ ] **Step 6: Run the test, then the whole file**

Run: `npx vitest run test/assets.spec.ts`
Expected: all PASS, including the existing `serves the front page` (the `<title>` still contains `runs itself`).

- [ ] **Step 7: Format and commit**

```bash
npm run format
git add public/index.html test/assets.spec.ts
git commit -m "copy(hero): Headcount: one — drop the unmeasured review claim and the hedges

Reviews were sampled at zero on every recent PR (receipts-scope adjudication),
so the hero no longer says agents review each other. 'Every figure links to a
commit' is now 'every line of the ledger links', which is what is true.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The four strings in `app.js` that break character

**Files:**

- Modify: `public/app.js` (`setBusy`, the network-error branch of `submit`, the `renderReceipts` empty-ledger string; `tpl-org` footnote is in `public/index.html`)
- Modify: `public/index.html` (`#tpl-org` `[data-f="note"]` text)
- Test: `test/assets.spec.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

```ts
it('the generator never convenes a board in a company with no meetings', async () => {
	const js = await (await SELF.fetch(`${ORIGIN}/app.js`)).text();
	expect(js).not.toContain('Convening the board');
	expect(js).not.toContain('reconvene');
	expect(js).not.toContain('That would be news');
	expect(js).toContain('Costing the proposal');
	const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
	expect(html).not.toContain("staff's morale");
	expect(html).toContain('They were produced by a language model from your description.');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/assets.spec.ts -t 'convenes'`
Expected: FAIL on `Convening the board`.

- [ ] **Step 3: Make the four replacements**

In `public/app.js`:

```js
if (on) out.innerHTML = '<div class="staff-empty">Costing the proposal…</div>';
```

```js
out.innerHTML = '<div class="staff-empty">Network trouble. Try again.</div>';
```

```js
rows.innerHTML = '<div class="ledger-empty">No agent-authored commits in the window.</div>';
```

In `public/index.html`, inside `#tpl-org`:

```html
<span data-f="note">Figures are illustrative. They were produced by a language model from your description.</span>
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/assets.spec.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add public/app.js public/index.html test/assets.spec.ts
git commit -m "copy(generator): no board to convene; footnote stops announcing the joke

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Method page — true sentences, and the rules behind the new notes

**Files:**

- Modify: `public/method.html` (`#scope`, `#commits`, `#human`; add `#segments` and `#notes`)
- Test: `test/assets.spec.ts`

**Interfaces:**

- Produces: anchors `/method#segments` and `/method#notes` that Task 4 links to.

- [ ] **Step 1: Write the failing test**

```ts
it('method page states only provable scope and headcount', async () => {
	const html = flat(await (await SELF.fetch(`${ORIGIN}/method`)).text());
	expect(html).toContain('Four public repositories');
	expect(html).not.toContain('Three public repositories');
	expect(html).not.toContain('one human maintainer with commit access');
	expect(html).toContain('One human has committed to these repositories in the window');
	expect(html).not.toContain('counted as human');
	expect(html).toContain('counted as not agent-authored');
	expect(html).toContain('id="segments"');
	expect(html).toContain('id="notes"');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/assets.spec.ts -t 'provable scope'`
Expected: FAIL on `Four public repositories`.

- [ ] **Step 3: Rewrite `#scope`'s first paragraph**

```html
<p>
	Four public repositories, last 90 days. The snapshot is refreshed every 30 minutes by schedule, and again on the first visit after it is
	45 minutes old:
</p>
```

- [ ] **Step 4: Rewrite the last sentence of `#commits`'s first paragraph**

Replace `A commit without the trailer is counted as human even if an agent helped.` with:

```
A commit without the trailer is counted as not agent-authored, even if an agent helped and even if a bot made it.
```

- [ ] **Step 5: Rewrite `#human`**

```html
<h2 id="human">Headcount, human</h2>
<p>
	One. One human has committed to these repositories in the window. That person holds the deploy keys and runs every production deploy by
	hand; the agents open the release and do not press the button.
</p>
```

- [ ] **Step 6: Add `#segments` after `#median` and `#notes` after `#meetings`**

```html
<h2 id="segments">Segment information</h2>
<p>
	Note 3 shows the same counts per repository. They come from the same two calls, grouped by repository before summing. The share column is
	agent-authored commits divided by all commits in that repository, to one decimal place, computed in your browser from the published
	figures. A repository with two commits is shown; the rule has no minimum.
</p>
```

```html
<h2 id="notes">Notes without figures</h2>
<p>
	Notes 4, 7 and 8 contain no numbers. They describe the rule and its consequences, and the rule is in <code>src/receipts.ts</code>. Note 5
	uses this repository's own row from Note 3. Note 6 lists the identities counted under Headcount, agent, exactly as they signed.
</p>
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run test/assets.spec.ts`
Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
npm run format
git add public/method.html test/assets.spec.ts
git commit -m "copy(method): four repositories, a provable headcount sentence, and the rules behind Notes 3-8

Closes backlog T1, T2 (copy branch), T5 and T9.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Notes 3–7 — segment table, basis, related parties, personnel, off-balance-sheet

**Files:**

- Modify: `public/index.html` (new sections between `#staff` and `#contact`; a new `<template id="tpl-segment-row">`)
- Modify: `public/styles.css` (append the notes block)
- Modify: `public/app.js` (three render functions called from `renderReceipts`)
- Test: `test/assets.spec.ts`

**Interfaces:**

- Consumes: `/api/receipts` fields `repos[] {name, url, totalCommits, agentCommits, prsMerged}`, `totalCommits`, `agentCommits`, `agentShare`, `prsMerged`, `agentIdentities[]`. All already returned by `src/receipts.ts` `aggregate()`.
- Produces: `data-r` hooks `segTotal`, `segAgent`, `segShare`, `segPrs`, `selfAgent`, `selfTotal`, `selfRest`; element ids `segment-rows`, `tpl-segment-row`, `note-self`, `kmp-list`, `kmp-bare`. Task 5 places its sections after these.

- [ ] **Step 1: Write the failing test**

```ts
it('carries Notes 3 to 7 with their live hooks', async () => {
	const html = await (await SELF.fetch(`${ORIGIN}/`)).text();
	for (const s of [
		'Note 3 — Segment information',
		'Note 4 — Basis of preparation',
		'Note 5 — Related parties',
		'Note 6 — Key management personnel',
		'Note 7 — Off-balance-sheet arrangements',
		'id="segment-rows"',
		'id="tpl-segment-row"',
		'data-self="macrohard"',
		'id="kmp-list"',
		'data-r="segShare"',
	]) {
		expect(html).toContain(s);
	}
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/assets.spec.ts -t 'Notes 3 to 7'`
Expected: FAIL on `Note 3 — Segment information`.

- [ ] **Step 3: Add the markup**

Insert directly after the closing `</section>` of `<section id="staff" …>` and before `<section id="contact" …>`:

```html
<section id="segments" class="note">
	<div class="note-head">
		<div>
			<p class="eyebrow">Note 3 — Segment information</p>
			<h2>Four repositories. One of them is most of the company.</h2>
		</div>
		<p class="note-aside">Segments are public repositories. A segment with two commits is still reported; the rule has no minimum.</p>
	</div>
	<div class="panel">
		<div class="ledger-row ledger-head seg-row">
			<span>Segment</span><span class="r">Commits</span><span class="r">Agent-authored</span><span class="r">Share</span
			><span class="r">PRs merged</span>
		</div>
		<div id="segment-rows" aria-live="polite"></div>
		<div class="ledger-row seg-row seg-total">
			<span>Total, 90 days</span><span class="n" data-r="segTotal">—</span><span class="n" data-r="segAgent">—</span
			><span class="n" data-r="segShare">—</span><span class="n" data-r="segPrs">—</span>
		</div>
		<div class="ledger-foot">
			The repository that publishes this report is one of the segments. See Note 5. <a href="/method#segments">How counted →</a>
		</div>
	</div>
</section>

<section class="notes-wrap" aria-label="Notes 4 to 7">
	<div class="notes-grid">
		<div class="nnote">
			<p class="eyebrow">Note 4 — Basis of preparation</p>
			<h3>The figures are a floor.</h3>
			<p>
				A commit is agent-authored when an agent signed it, and not otherwise. A commit an agent wrote and a human signed is not
				agent-authored. A commit a dependency bot made is not agent-authored. The share is therefore understated, and the ceiling is not
				estimated, because an estimate is not a receipt.
			</p>
			<p>
				A refresh that counts no commits at all is discarded and the previous figures stand. A stale truth is preferred to a fresh zero.
			</p>
		</div>

		<div class="nnote" id="note-self" data-self="macrohard">
			<p class="eyebrow">Note 5 — Related parties</p>
			<h3>This report was prepared by the parties it reports on.</h3>
			<p>
				The repository that publishes this page is a segment and is counted like the others:
				<span class="mono accent" data-r="selfAgent">—</span> of its <span class="mono accent" data-r="selfTotal">—</span> commits in the
				period carry an agent's signature. <span data-r="selfRest"></span> No independent review of this arrangement has been sought. There
				is no one independent to ask.
			</p>
		</div>

		<div class="nnote">
			<p class="eyebrow">Note 6 — Key management personnel</p>
			<h3>The following identities signed work during the period.</h3>
			<ul class="kmp" id="kmp-list"></ul>
			<dl class="kv">
				<dt>Remuneration</dt>
				<dd>nil</dd>
				<dt>Options granted</dt>
				<dd>none</dd>
				<dt>Board meetings attended</dt>
				<dd>none were held</dd>
			</dl>
			<p id="kmp-bare" hidden>One signatory gave no version number and is listed as it signed.</p>
		</div>

		<div class="nnote">
			<p class="eyebrow">Note 7 — Off-balance-sheet arrangements</p>
			<h3>The organisation also works where you cannot see.</h3>
			<p>
				Work in repositories that are not public does not appear in this report: not a total, not a share, not a footnote with a number in
				it. A figure you cannot check is a claim, not a receipt. The company's published activity is therefore smaller than its actual
				activity by an amount which, for the same reason, is not stated.
			</p>
		</div>
	</div>
</section>
```

Add the row template next to the other `<template>` elements at the bottom of `<body>`:

```html
<template id="tpl-segment-row">
	<div class="ledger-row seg-row">
		<a class="accent" data-f="name" href="#" rel="noopener"></a>
		<span class="n" data-f="total"></span>
		<span class="n" data-f="agent"></span>
		<span class="n" data-f="share"></span>
		<span class="n" data-f="prs"></span>
	</div>
</template>
```

Also make the notes reachable from the top nav. In `<nav class="topnav">`, insert `<a href="#segments">Notes</a>` directly after the existing `<a href="#ledger">Receipts</a>` line, so the nav reads Receipts · Notes · Staff your company · Contact.

- [ ] **Step 4: Append the styles**

Append to `public/styles.css` before the `/* Responsive */` block:

```css
/* Notes 3–7 */
.seg-row {
	grid-template-columns: minmax(0, 1fr) 110px 150px 90px 110px;
}
.seg-row .n {
	font-family: var(--mono);
	text-align: right;
}
.seg-total {
	border-top: 1px solid var(--ink);
	border-bottom: 0;
	font-weight: 500;
}
.notes-wrap {
	padding: clamp(48px, 6vw, 76px) var(--gutter) 0;
}
.notes-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1px;
	background: var(--rule);
	border: 1px solid var(--rule);
}
.nnote {
	background: var(--card);
	padding: 28px 30px 30px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.nnote h3 {
	font-family: var(--serif);
	font-weight: 400;
	font-size: 26px;
	line-height: 1.15;
	letter-spacing: -0.015em;
	text-wrap: pretty;
}
.nnote p:not(.eyebrow) {
	font-size: 15px;
	line-height: 1.62;
	color: var(--body);
	max-width: 520px;
}
.nnote .kmp {
	font-family: var(--mono);
	font-size: 13px;
	line-height: 1.7;
	color: var(--ink);
	columns: 2;
	column-gap: 24px;
	margin: 4px 0 2px;
	padding: 0;
	list-style: none;
}
.nnote .kv {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 4px 20px;
	font-size: 14px;
	color: var(--body);
	margin-top: 4px;
}
.nnote .kv dd {
	font-family: var(--mono);
	color: var(--ink);
}
```

And inside the existing `@media (max-width: 900px)` block add:

```css
.notes-grid {
	grid-template-columns: 1fr;
}
.seg-row {
	grid-template-columns: minmax(0, 1fr) 90px 90px;
}
.seg-row > :nth-child(3),
.seg-row > :nth-child(5) {
	display: none;
}
```

- [ ] **Step 5: Render the live figures in `app.js`**

Add after `fmtAgo` in the Formatting block:

```js
const fmtShare = (agent, total) => (total ? `${Math.round((agent / total) * 1000) / 10}%` : '—');
```

Add these three functions after `renderReceipts`, and call them as the last three lines inside `renderReceipts(d)`:

```js
renderSegments(d);
renderSelf(d);
renderIdentities(d);
```

```js
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
				: `The ${fmtInt(rest)} that do not are merges, performed by the human.`;
}

function renderIdentities(d) {
	const ul = $('#kmp-list');
	if (!ul) return;
	const names = d.agentIdentities || [];
	ul.replaceChildren(...names.map((n) => Object.assign(document.createElement('li'), { textContent: n })));
	const bare = $('#kmp-bare');
	if (bare) bare.hidden = !names.includes('Claude');
}
```

The "merges, performed by the human" sentence is true because of the rule added to `CLAUDE.md` in Task 8: in this repository every non-merge commit carries the trailer. Keep both in step.

- [ ] **Step 6: Run the test**

Run: `npx vitest run test/assets.spec.ts`
Expected: PASS.

- [ ] **Step 7: Look at it**

Run: `npm run dev` and open `http://127.0.0.1:8787/`. This calls the real GitHub API anonymously for the receipts (no Workers AI spend unless you use the generator). Check: the segment table has four rows sorted by commits with `macrohard` second; the total row matches the stats band; Note 5 reads "16 of its 18 … The 2 that do not are merges" (figures will have moved; the sentence must agree with the table row); Note 6 lists the identities in two columns and shows the bare-Claude line only if `Claude` is in the list. Resize to 800px wide: the notes stack, the table drops to three columns. Stop the dev server.

- [ ] **Step 8: Format and commit**

```bash
npm run format
git add public/index.html public/styles.css public/app.js test/assets.spec.ts
git commit -m "feat(notes): Notes 3-7 — segments, basis of preparation, related parties, personnel, off-balance-sheet

All figures come from fields /api/receipts already returns; nothing in src/ changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Note 8 (principal risks), the cautionary band, and Note 9 renumbering

**Files:**

- Modify: `public/index.html` (new `#risks` section after the notes grid; cautionary band after `#contact`; offer eyebrow → Note 9)
- Modify: `public/styles.css` (append `.risk-list`, `.caution`)
- Test: `test/assets.spec.ts`

**Interfaces:**

- Consumes: the notes grid from Task 4 (placement only).

- [ ] **Step 1: Write the failing test**

```ts
it('has principal risks, a cautionary statement, and subsequent events as Note 9', async () => {
	const html = await (await SELF.fetch(`${ORIGIN}/`)).text();
	expect(html).toContain('Note 8 — Principal risks and uncertainties');
	expect(html).toContain('Note 9 — Subsequent events');
	expect(html).not.toContain('Note 3 — Subsequent events');
	expect(html).toContain('This report contains none.');
	expect(html).toContain('data-n="8.7"');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/assets.spec.ts -t 'principal risks'`
Expected: FAIL on `Note 8 — Principal risks`.

- [ ] **Step 3: Add Note 8 after the `.notes-wrap` section**

```html
<section id="risks" class="note">
	<div class="note-head">
		<div>
			<p class="eyebrow">Note 8 — Principal risks and uncertainties</p>
			<h2>What could go wrong, in order of how much it would show.</h2>
		</div>
		<p class="note-aside">The directors have not met to consider these. They were committed.</p>
	</div>
	<ol class="risk-list">
		<li>
			<b data-n="8.1">Key person</b>
			One human holds the deploy key. Nothing ships without that person, by design: the agents open the release and cannot press the button.
			The company has no succession plan. The agents could write one; it would still need the person to deploy it.
		</li>
		<li>
			<b data-n="8.2">Supplier concentration</b>
			Every identity in Note 6 is a model from one vendor. If that vendor changes its pricing, its terms, or its mind, the agent headcount
			is zero. The human is not from that vendor, as far as we can establish.
		</li>
		<li>
			<b data-n="8.3">Measurement</b>
			The agent share is understated by construction (Note 4). It could be overstated by anyone who adds a signature to a commit they wrote
			themselves. We have not done this, and you need not take our word for it: the signatures are in the commits and the commits are
			public.
		</li>
		<li>
			<b data-n="8.4">Third-party data</b>
			Every figure is fetched from a public API that allows strangers sixty requests an hour. We are a stranger with a token. When the token
			is refused we carry on as a stranger, the figures may go stale, and the page says how old they are.
		</li>
		<li>
			<b data-n="8.5">Budget</b>
			The restructuring desk closes when the day's budget is spent and reopens at midnight UTC. On such a day, later visitors receive one of
			five standing proposals and are told so. This has not yet happened. For a company that exists to be noticed, that is also a risk.
		</li>
		<li>
			<b data-n="8.6">The name</b>
			It is not ours to keep, and we have said so (Note 9). Should it transfer, this report moves and the figures do not, because the
			figures are in the commits, not the domain.
		</li>
		<li>
			<b data-n="8.7">Satire</b>
			The organisations proposed in Note 2 are generated by a language model. Anyone who restructures a real organisation on the strength of
			one has misread the footnote, which says so.
		</li>
	</ol>
</section>
```

8.5's "This has not yet happened" is true while the restructured counter (`/api/stats`, 39 at the time of writing) is far below `STAFF_DAILY_CAP` (1,500). If the cap is ever hit, delete that sentence and the one after it.

- [ ] **Step 4: Renumber the offer and add the cautionary band**

In `<section id="contact">` change the eyebrow to:

```html
<p class="eyebrow offer-eyebrow">Note 9 — Subsequent events</p>
```

Directly after the closing `</section>` of `#contact` (still inside `<main>`), add:

```html
<section class="caution" aria-label="Forward-looking statements">
	<p class="eyebrow">Forward-looking statements</p>
	<p>
		This report contains none. Every figure describes work already committed, in the git sense. The company issues no guidance: it has no
		revenue to guide, no forecast, and no meeting at which a forecast could be agreed. Where this page appears to predict anything, refresh
		it. The figure will have changed, and the prediction will not have been ours.
	</p>
</section>
```

- [ ] **Step 5: Append the styles**

Append to `public/styles.css` after the Task 4 block:

```css
/* Note 8 and the cautionary statement */
.risk-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1px;
	background: var(--rule);
	border: 1px solid var(--rule);
}
.risk-list li {
	background: var(--card);
	padding: 24px 28px 26px;
	font-size: 15px;
	line-height: 1.6;
	color: var(--body);
}
.risk-list b {
	display: block;
	font-weight: 500;
	color: var(--ink);
	margin-bottom: 6px;
}
.risk-list b::before {
	content: attr(data-n) '  ';
	font-family: var(--mono);
	font-weight: 400;
	color: var(--accent);
	letter-spacing: 0.06em;
}
.caution {
	margin-top: clamp(48px, 6vw, 76px);
	border-top: 1px solid var(--rule);
	border-bottom: 1px solid var(--rule);
	background: var(--band);
	padding: 30px var(--gutter);
	display: grid;
	grid-template-columns: 220px minmax(0, 1fr);
	gap: 30px;
	align-items: start;
}
.caution p:not(.eyebrow) {
	font-size: 15px;
	line-height: 1.65;
	color: var(--body);
	max-width: 720px;
}
```

Inside `@media (max-width: 900px)` add:

```css
.risk-list,
.caution {
	grid-template-columns: 1fr;
}
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run test/assets.spec.ts`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
npm run format
git add public/index.html public/styles.css test/assets.spec.ts
git commit -m "feat(notes): Note 8 principal risks, a forward-looking statement that contains none, Note 9 subsequent events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The 404 as the auditor's qualified opinion

**Files:**

- Modify: `public/404.html`
- Create: `public/404.js` (the CSP forbids inline scripts)
- Modify: `test/assets.spec.ts` (existing 404 test), `scripts/e2e.sh:28`

**Interfaces:**

- Produces: `404.html` contains `<code data-path>` and loads `/404.js`, which sets its text to `location.pathname`.

- [ ] **Step 1: Change the existing test so it fails**

In `test/assets.spec.ts` replace the body of `returns the 404 page with a 404 status for unknown paths` with:

```ts
const res = await SELF.fetch(`${ORIGIN}/definitely-not-here`);
expect(res.status).toBe(404);
const html = await res.text();
expect(html).toContain('qualified opinion');
expect(html).toContain('<code data-path>');
expect(html).toContain('src="/404.js"');
expect(html).not.toContain('<script>');
```

And add:

```ts
it('serves the 404 path filler as a static asset', async () => {
	const res = await SELF.fetch(`${ORIGIN}/404.js`);
	expect(res.status).toBe(200);
	expect(await res.text()).toContain('location.pathname');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/assets.spec.ts -t '404'`
Expected: FAIL on `qualified opinion`, and the `/404.js` test FAILs with 404.

- [ ] **Step 3: Write `public/404.js`**

```js
/* Fills the requested path into the auditor's report. textContent only; nothing is injected. */
(() => {
	'use strict';
	const el = document.querySelector('[data-path]');
	if (el) el.textContent = location.pathname;
})();
```

- [ ] **Step 4: Rewrite `public/404.html`**

Replace the whole file with:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Not found — Macrohard</title>
		<meta name="robots" content="noindex" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link
			rel="stylesheet"
			href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
		/>
		<link rel="stylesheet" href="/styles.css" />
	</head>
	<body>
		<header class="top">
			<a class="wordmark" href="/">Macrohard</a>
		</header>
		<main class="prose">
			<p class="eyebrow">Independent auditor's report — qualified opinion</p>
			<h1>Insufficient evidence that this page <em>exists</em>.</h1>
			<p>
				<strong>Basis for qualified opinion.</strong> We were unable to obtain sufficient appropriate evidence that
				<code data-path>this page</code> was produced during the financial year. It is not held in the ledger, the method, or the source.
				Our procedures consisted of reading the file system, which is the whole company.
			</p>
			<p class="opinion">
				<strong>Opinion.</strong> Except for the matter described above, the report at <a href="/">macrohard.nz</a> presents fairly, in all
				material respects, the work performed.
			</p>
			<p class="nf-meta">
				<span>HTTP 404</span><span>Nothing was stored.</span><span>Signed: the agents, who also prepared the accounts.</span>
			</p>
			<p>
				<a href="/">Return to the report</a> &nbsp;·&nbsp; <a href="/method">Method</a> &nbsp;·&nbsp;
				<a href="https://github.com/MadaBurns/macrohard">Source</a>
			</p>
		</main>
		<script src="/404.js" defer></script>
	</body>
</html>
```

- [ ] **Step 5: Add the two small styles**

Append to `public/styles.css` (with the Method page block):

```css
/* 404 — auditor's report */
.opinion {
	border-left: 2px solid var(--ink);
	padding-left: 18px;
}
.nf-meta {
	font-family: var(--mono);
	font-size: 13px;
	color: var(--muted);
	display: flex;
	gap: 28px;
	flex-wrap: wrap;
}
```

- [ ] **Step 6: Update the e2e marker**

In `scripts/e2e.sh` line 28 change `grep -q 'Nothing here'` to `grep -q 'qualified opinion'`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/assets.spec.ts`
Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
npm run format
git add public/404.html public/404.js public/styles.css test/assets.spec.ts scripts/e2e.sh
git commit -m "feat(404): the auditor's qualified opinion; path filled by an external script under the CSP

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Share card B and the rendered `og.png`

**Files:**

- Modify: `public/og.html`, `public/og.css`
- Create: `scripts/og-png.sh`
- Modify: `public/og.png` (binary, re-rendered)
- Test: `test/assets.spec.ts`

**Interfaces:**

- Consumes: nothing. The per-permalink card in `src/og.ts` is untouched.
- Produces: `public/og.png`, 1200×630, referenced by the unchanged `og:image` meta.

- [ ] **Step 1: Write the failing test**

```ts
it('generic share card is the headcount card and ships as a 1200x630 PNG', async () => {
	const html = await (await SELF.fetch(`${ORIGIN}/og.html`)).text();
	expect(html).toContain('Headcount, human');
	expect(html).toContain('Headcount, agent');
	expect(html).toContain('href="og.css"');
	const png = await SELF.fetch(`${ORIGIN}/og.png`);
	expect(png.status).toBe(200);
	expect(png.headers.get('content-type')).toContain('image/png');
	const bytes = new Uint8Array(await png.arrayBuffer());
	// IHDR width/height are big-endian at bytes 16..23.
	const dv = new DataView(bytes.buffer);
	expect(dv.getUint32(16)).toBe(1200);
	expect(dv.getUint32(20)).toBe(630);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/assets.spec.ts -t 'share card'`
Expected: FAIL on `Headcount, human`.

- [ ] **Step 3: Rewrite `public/og.html`**

The `As at` date and the two numbers are the live glance-panel values on the day you render. Read them from `https://macrohard.nz/api/receipts` (`agentIdentities.length`) before rendering and put them in; they are dated, so they do not rot, they age.

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="robots" content="noindex" />
		<title>og</title>
		<link
			rel="stylesheet"
			href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
		/>
		<link rel="stylesheet" href="og.css" />
	</head>
	<body>
		<div class="card">
			<div class="top"><span class="wm">Macrohard</span><span class="eb">Annual Report — FY2026</span></div>
			<div class="pair">
				<div><b>1</b><span>Headcount, human</span></div>
				<div><b class="acc">10</b><span>Headcount, agent</span></div>
			</div>
			<div class="bot">
				<span class="tag">The software company that <em>runs itself</em>.</span>
				<span class="url">As at 12 Sep 2026 · macrohard.nz</span>
			</div>
		</div>
	</body>
</html>
```

- [ ] **Step 4: Rewrite `public/og.css`**

```css
body {
	margin: 0;
}
.card {
	width: 1200px;
	height: 630px;
	background: #f7f4ee;
	color: #16130f;
	font-family: 'IBM Plex Sans', sans-serif;
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	padding: 60px 72px 56px;
	box-sizing: border-box;
}
.top {
	display: flex;
	justify-content: space-between;
	align-items: center;
}
.wm {
	font-size: 20px;
	font-weight: 600;
	letter-spacing: 0.16em;
	text-transform: uppercase;
}
.eb {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 15px;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: #9c4a1a;
}
.pair {
	display: grid;
	grid-template-columns: 1fr 1fr;
	border-top: 1px solid #16130f;
	border-bottom: 1px solid #16130f;
}
.pair div {
	padding: 26px 0 22px;
}
.pair div + div {
	border-left: 1px solid #16130f;
	padding-left: 48px;
}
.pair b {
	display: block;
	font-family: 'IBM Plex Mono', monospace;
	font-weight: 500;
	font-size: 196px;
	letter-spacing: -0.05em;
	line-height: 0.9;
}
.pair b.acc {
	color: #9c4a1a;
}
.pair span {
	display: block;
	margin-top: 16px;
	font-size: 16px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #6b6459;
}
.bot {
	display: flex;
	justify-content: space-between;
	align-items: flex-end;
}
.tag {
	font-family: Newsreader, Georgia, serif;
	font-size: 40px;
	letter-spacing: -0.015em;
	line-height: 1.1;
}
.tag em {
	font-style: italic;
}
.url {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 18px;
	color: #6b6459;
}
```

- [ ] **Step 5: Write `scripts/og-png.sh`**

```bash
#!/usr/bin/env bash
# Render public/og.html -> public/og.png at 1200x630 with headless Chrome.
# Needs network for Google Fonts; the virtual-time budget lets them load first.
# Run from anywhere: `scripts/og-png.sh`. Set CHROME to point at another binary.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=...)" >&2; exit 1; }
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
	--virtual-time-budget=8000 --screenshot="$PWD/public/og.png" "file://$PWD/public/og.html" 2>/dev/null
sips -g pixelWidth -g pixelHeight public/og.png
```

Then: `chmod +x scripts/og-png.sh`.

- [ ] **Step 6: Render and inspect**

Run: `scripts/og-png.sh`
Expected: sips prints `pixelWidth: 1200` and `pixelHeight: 630`. Open `public/og.png` and check the fonts rendered (Newsreader serif in the tagline, mono numerals). If the fonts fell back to system faces, raise `--virtual-time-budget` to 15000 and re-run.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/assets.spec.ts`
Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
npm run format
git add public/og.html public/og.css public/og.png scripts/og-png.sh test/assets.spec.ts
git commit -m "feat(share): headcount share card, rendered by scripts/og-png.sh

Two numbers readable at thumbnail size; dated 'as at' because og.png is static.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Docs, the trailer rule, the baseline chain, and the PR

**Files:**

- Modify: `README.md` (first paragraph), `CLAUDE.md` (a new rule), `docs/superpowers/specs/2026-09-12-macrohard-nz-design.md` ("Copy decisions", "Constraints"), `docs/superpowers/2026-09-12-improvement-backlog.md` (a `## 5. Done` section)

**Interfaces:** none.

- [ ] **Step 1: README first paragraph**

Replace `Every figure on the front page is computed from the public GitHub API and links to the commit that proves it.` with:

```
Every figure on the front page is computed from the public GitHub API, and every line of the ledger links to the commit that proves it.
```

- [ ] **Step 2: `CLAUDE.md` rule**

Add to the `## Gotchas` list in the repository `CLAUDE.md`:

```markdown
- This repository counts itself, and Note 5 on the front page says its only non-agent commits are merges. Every non-merge commit
  must carry the `Co-Authored-By: Claude …` trailer; merges are the human's. Break this and Note 5 becomes false.
```

- [ ] **Step 3: Design spec**

In "Constraints that shaped it", change `scoped to the three public ones` to `scoped to the four public ones`. In "Copy decisions", replace the first bullet with:

```markdown
- Hero claims only what `git log` supports: agents write, sign, and _open the release_; **one human holds the deploy key**.
  "Review" was dropped 2026-09-12 after the reviews endpoint returned zero on every sampled PR. The hero is now "Headcount: one."
  with the glance panel supplying the agent count beside it.
- Notes 3–8 (segments, basis, related parties, personnel, off-balance-sheet, risks) and the cautionary statement were added
  2026-09-12. Every figure in them is a field `/api/receipts` already returned; the copy is in
  `docs/superpowers/plans/2026-09-12-editorial-direction.md`.
```

- [ ] **Step 4: Backlog Done lines**

Append to `docs/superpowers/2026-09-12-improvement-backlog.md`:

```markdown
## 5. Done

- 2026-09-12 — T1, T2 (copy branch), T4 (drop branch), T5, T6, T9 — editorial PR (link once opened). Verification: `test/assets.spec.ts` asserts each corrected sentence.
```

- [ ] **Step 5: Run the baseline chain from a cold start**

```bash
rm -f worker-configuration.d.ts && npm ci && npm run typecheck && npm test && npm run format:check
```

Expected: all green. Keep the tails for the PR body.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-12-macrohard-nz-design.md docs/superpowers/2026-09-12-improvement-backlog.md
git commit -m "docs: record the editorial changes; the trailer rule that keeps Note 5 true

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Push and open the PR (do not merge)**

```bash
git push
gh pr create --base main --title "Editorial: Headcount: one, Notes 3-9, the auditor's 404, and the headcount share card" --body "$(cat <<'EOF'
Implements docs/superpowers/plans/2026-09-12-editorial-direction.md.

- Hero V3 "Headcount: one." — drops the unmeasured "review" claim (reviews sampled at zero).
- Notes 3–7 from fields /api/receipts already returns; Note 8 risks; cautionary statement; Subsequent events → Note 9.
- 404 is the auditor's qualified opinion; path filled by /404.js (CSP forbids inline scripts).
- Share card B (1 human / 10 agents, dated) rendered by scripts/og-png.sh.
- Method page: four repos, provable headcount sentence, "not agent-authored", refresh guarantee. Closes backlog T1, T2, T4, T5, T6, T9.

No changes to src/ or wrangler.jsonc. Not deployed.

Baseline chain (cold clone):
<paste the tails of typecheck, test, format:check here>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then edit the backlog Done line with the PR link, amend the last commit (keep the trailer), and push again.

---

## Appendix — alternates not built

**Hero V1, Reported** (lowest nerve). h1: `The software company that <em>runs itself</em>.` Lede:

> Macrohard is an engineering organisation operated by AI agents. They write the code, sign for it, and open the release. One human holds the deploy key and presses it. Every figure on this page is live from the public GitHub API, and every line of the ledger links to the commit that proves it.

**Hero V2, Counted.** h1: `The org chart is a <em>git log</em>.` Lede, with `agentShare` and `medianPr` as `data-r` spans:

> Macrohard's engineers are AI agents. In the last 90 days they signed [56.3%] of all commits across our public repositories, and the median pull request was open for [30m]. One human holds the deploy key. There are no meetings. The figures are live from the public GitHub API and every hash in the ledger links to GitHub.

**Share card A, Cover.** Title `The software company that runs itself.` at 78px over a four-cell strip (`326` agent-authored commits · `56.3%` share of all commits · `30m` median PR open to merge · `0` meetings held), footer `As at 12 September 2026 · every line links to a public commit` / `macrohard.nz`. Styles are in the scratch mockup that accompanied the brief (`.strip`, 52px mono numerals, 14px uppercase labels).

**404 one-liner alternative.** Eyebrow `Note — Impairment`, h1 `This page has been written down to nil.`

**Spare note, Operating expenditure.** Built on `dailyCap` from `/api/config` and the counter from `/api/stats`: "Restructurings are limited to [1,500] a day. Past the limit, later visitors receive one of five standing proposals and are told so. The budget is enforced before the work is done, not reviewed after. To date: [39] organisations restructured."
