---
name: idea
summary: Turn raw intent into a structured, well-formed ticket.
description: >-
  The Idea step playbook — create an agent-dashboard ticket from the user's raw intent (concise title, category ui|bug|logic|business|refactor|hotfix, tags) with a structured body of four sections: Rough idea (the user's words preserved), Scope, Risks, Dependencies. Sets needsDesign: true on ui-category tickets (or when the user says the work needs design) so the mock/design gates apply. Choose the entry step from the board's entry-enabled steps, and optionally "sharpen" the intent with at most 3 clarifying questions, applied only after the user approves the rewrite. Auto-invoke when the user says "create a ticket", "add this to the board", "ticket this", "new flow ticket", "log this idea", describes work they want on the agent dashboard, or runs /lfad:idea. Movement mechanics defer to lfad:move.
---

# lfad:idea — capture intent as a ticket

This step turns what the user said into a ticket other steps can trust. The one invariant: **the Rough idea section carries the user's intent in their own words** — lfad:research grounds it in evidence and lfad:interview reasons from it, so capture faithfully and let the interview do the interrogating. The other three sections structure your honest first reading; thin-but-true beats padded.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes (health probe → REST is the primary path; the `FLOW()` CLI helper when the daemon is down). That skill owns all movement grammar; this one owns what a good ticket contains.

**Honor the board's guidance and word every file by `../move/wording.md`** per `lfad:move` in the human-facing ticket body — language, format, tone (the Rough idea stays in the user's own words either way). Title, category, tags, frontmatter, and filenames stay English.

## The ticket contract

| Field | Rule |
|---|---|
| `title` | Concise and imperative, ≤ ~10 words, states the outcome ("Fix login redirect loop"), free of implementation detail. Prefer the original prompt's distinctive nouns and product terms so the author recognizes it; recompose them rather than preserving a verbatim phrase, and clean up vague, misspelled, sensitive, or misleading terms when correctness or safety requires it. |
| `category` | Exactly one of `ui` · `bug` · `logic` · `business` · `refactor` · `hotfix`. Pick by the *nature of the change*: visible-surface work → `ui`; broken behavior → `bug`; internal behavior change → `logic`; product/pricing/policy → `business`; behavior-preserving restructure → `refactor`; urgent production fix → `hotfix`. |
| `tags` | 1–4 short lowercase topics (subsystem, feature area) that help the human scan the board. |
| `body` | The four structured sections below. |

Category edge calls: something *looks wrong* on screen but behavior is correct → `ui`; behavior is wrong regardless of surface → `bug`; a `bug` that is burning production right now → `hotfix`; a change to what the product charges/allows/promises → `business` even when it ships as UI.

## The body structure

```markdown
## Rough idea
<The user's intent, their words, examples, and "why" preserved — quote them;
trim nothing meaningful. Their phrasing is interview-step gold.>

## Scope
- In: <what this ticket plausibly delivers>
- Out: <adjacent work explicitly not this ticket>

## Risks
- <what could make this harder or riskier than it looks — one line each, or "None spotted yet">

## Dependencies
- <tickets, systems, decisions, or access this work waits on — or "None known">
```

Rough idea is verbatim territory; Scope, Risks, and Dependencies are your structured reading of it — write what you actually know at capture time and mark the rest unknown. lfad:research and lfad:interview deepen all three with evidence.

**The `needsDesign` flag.** When the ticket's category is `ui` — or the user says the work needs visual design — set `needsDesign: true` on the ticket. It is the frontmatter flag the `mock` and `design` gate steps key their `skipUnless` on: without it those steps are skipped for the ticket. A `ui`-categorized ticket that is honestly design-free (e.g. copy-only) may omit it — say so in one line when you do.

The ticket body IS this step's artifact — it renders first in the board's content rail (as `Idea`). When the intent comes with screenshots or mockups, save them into the ticket's shared image store at `<ticket>/images/` and reference them from the body with plain relative markdown (`![](images/name.png)`) — the board renders them inline, and later steps reference the same store from their step subfolders as `../images/name.png`.

## A worked example

> User: "when I import a CSV twice the entries show up doubled, pretty sure we said imports dedupe. this bit me on my phone today"

```json
{
  "title": "Dedupe entries from repeated CSV imports",
  "category": "bug",
  "tags": ["import", "csv"],
  "body": "## Rough idea\nwhen I import a CSV twice the entries show up doubled, pretty sure we said imports dedupe. this bit me on my phone today\n\n## Scope\n- In: repeated imports of the same CSV produce no duplicate entries\n- Out: dedupe across different files, import UI changes\n\n## Risks\n- What counts as \"the same entry\" may be undecided (row hash vs natural key)\n\n## Dependencies\n- None known"
}
```

The title recomposes the outcome while retaining the prompt's distinctive `entries`, `CSV`, `imports`, and `dedupe` terms instead of swapping in abstract synonyms or preserving a phrase verbatim. The category follows the broken-promise nature of the report, and Rough idea keeps the user's exact words — "pretty sure we said" and "on my phone" are signals a summary would destroy.

## Choose the entry step

1. `GET /api/steps` and collect the steps with `entry: true` (in pipeline order). On the default board that is `idea`.
2. One entry step → use it (or simply omit `entryStep`; the board's default entry applies).
3. Several entry steps → route by readiness: **fuzzy or unshaped intent enters at the earliest entry step** (it needs the upstream steps); **an already-specified, directly actionable task may enter at a later entry step** (e.g. a `todo`-style queue) — confirm that choice with the user in one line before creating.

## Create it

Primary path — REST:

```bash
curl -fsS -X POST "$BASE/api/tickets" -H 'content-type: application/json' \
  -d '{"title":"Dedupe repeated CSV imports","category":"bug","tags":["import","csv"],
       "body":"<the structured body>","entryStep":"idea"}'
```

Add `"needsDesign": true` to the payload for design-flagged tickets (see above).

Daemon down — CLI fallback:

```bash
FLOW create "Dedupe repeated CSV imports" --category bug --tags import,csv --body "<the structured body>" --step idea
```

(The CLI has no needsDesign flag: for a design-flagged ticket on the daemon-down path, add `needsDesign: true` to the new ticket's `ticket.md` frontmatter after creating — custom frontmatter flags round-trip safely through moves.)

Report the created id and step back to the user (`Created ticket <id> in step 'idea'`).

## Sharpen mode (optional, user-approved)

Offer sharpening when the intent is ambiguous enough that the interview would burn its rounds on basics — and keep it lightweight:

1. Ask **at most 3** clarifying questions (one message), each targeting a real fork in the work (what outcome, which surface, what's out of scope).
2. Propose a **rewritten body**: Rough idea keeps the verbatim intent, and the answers land in Scope / Risks / Dependencies (or a short "Sharpened" note under Rough idea when they refine the intent itself).
3. Apply the rewrite **only after the user approves it** — on any hesitation, keep the initial body and let lfad:interview carry the open points as question blocks.

Persist an approved rewrite as the ticket body: at creation time pass it as `body`; on an existing ticket, `PUT /api/tickets/:id/artifact` with `{"name":"Idea","content":"<new body>"}` (the `Idea` artifact IS the ticket body, and the daemon snapshots the board before the edit).

## Board mode (headless run on the idea step)

When a daemon run lands here (no human available), structure conservatively: put the verbatim intent under Rough idea, fill Scope / Risks / Dependencies only with what the intent itself supports, and refine title/category/tags if they are clearly off. A question that genuinely forks the work escalates via the blocked mechanics in lfad:move (`FLOW_BLOCK: <one-line question>`); everything milder is left for the interview to surface as question blocks. Signal completion per the run prompt's sentinel protocol (`FLOW_DONE`).

## Finish: push-stop

The ticket is done here once it is well-formed in its entry step. Apply the **push-stop** rule from `lfad:move`: on the default board the next step is `research`, an `agent` step → move the ticket forward with a reason (`"idea structured — sending to research"`); the research worker (or autopilot) picks it up there.

## Optional: chain straight to the interview (the agent's call)

Stopping at `research` is the **default, not a rule**. When the operator is driving fast and the intent is well-formed, the agent **may keep going in the same pass** — run `research` and draft the `interview` gate (exactly the `lfad:next` chain) so the ticket lands at the interview with its questions **already listed on the board**, no second invocation needed. This is a permitted agent decision:

- **Chain forward** when the idea is clear and the operator wants momentum. Do **not** surface a scoping / clarifying question in chat — let it become an **interview question on the ticket** instead.
- **Stop early** (at idea/research) when the intent is fuzzy, the operator asked to review first, or the tree/board is busy.

Either way the human's decision surface stays the **gates**: questions belong on the ticket, never in a chat modal.
