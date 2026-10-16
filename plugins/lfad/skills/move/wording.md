# Wording rules

The plugin's default way of writing: **short, easy to read and informative**. Every sentence tells the reader something they need, in plain words, and nothing more.

## How the rules stack

Each layer overrides the one above it. Read them in this order before writing:

1. **Plugin defaults**: this file, and English for every file.
2. **Board settings** in `board.yml`, read from `GET /api/steps` (or `board.yml` itself when the daemon is down):
   - `writing.humanLanguage` sets the language of files a person reads (the reviewer's files below).
   - `writing.agentLanguage` sets the language of files an agent reads (the next agent's and the developer's files below).
   - `guidance`, at board level, adds rules for every step.
   - `localRules` names a project rules file (`/api/steps` returns its absolute path). Read it after this file. Where the two conflict, the project file wins, for wording and for anything else it covers.
3. **Step `guidance`** on the step being worked, which is the most specific.

An unset setting inherits the layer above it. If `localRules` names a missing file, say so in your output and continue with the layers that exist.

When the human-facing language is not English, apply these rules in that language. The English word lists below are examples of the habits to avoid in any language.

## Pick the reader

Each file has one reader, which also decides its language. Apply the rules below for every reader, then that reader's section.

| Reader | Language setting | Files |
| --- | --- | --- |
| **The reviewer**, the person working the board | `humanLanguage` | Ticket artifacts: `research/`, `interview/`, `mock/`, `design/`, `todo/` summaries, `doing/` notes, `review/` packets, `prompt/` replies, `blocked.md`, question blocks, the ticket body |
| **The next agent** | `agentLanguage` | `context.md`, the CURRENT-STATE block, the `todo/` breakdown chunks, project-local `SKILL.md` files written by `lfad:add-skill` |
| **A developer** | `agentLanguage` | Commit messages, branch descriptions, code comments |

Code, identifiers, frontmatter keys and filenames stay English whatever the settings say.

## What never changes

Leave these exactly as they are: code, identifiers, file paths, command output, configuration values, error strings, URLs, and anything quoted from a person, document or system. Rewording them changes meaning or breaks them. They also keep their own spelling (`color`, `initialize`), whatever variant the prose uses.

## Sentences and paragraphs

- One idea per sentence, with a verb. About 25 words. If the reader has to backtrack to parse it, split it.
- A paragraph holds 60 words and four sentences at most. Past that, split at the change of idea.
- The first sentence of any unit carries its point: heading, paragraph, bullet, section, file.
- Headings carry the point, in sentence case. Write "Pick the mode first" in place of "Modes".
- Active voice. Name the actor: "queries are validated" becomes "the compiler validates queries". Passive is fine only when the actor is unknown or does not matter.
- Condition before the instruction, warning before the step it guards. "To delete the document, click Delete."
- Common case first, exceptions after.

## Precision

These silently produce a wrong reading. Check them every time.

- Put "only" and "not" next to the word they change. "Only fails on growth" and "fails only on growth" differ.
- Every "it", "they" and "this" points at one obvious thing. Repeat the noun when in doubt. Never let "this" or "which" point at a whole clause.
- One name per thing, everywhere. Never cycle synonyms for variety.
- Break up long noun strings. "The proto import budget check script" becomes "the script that checks the proto-import budget".
- Keep the verb in a parallel clause. "Phase 1 moves the converters and Phase 2 the runtime" leaves Phase 2 without one.
- Keep "the" and "a" where they disambiguate. "Remove backup file" reads two ways. "Remove the backup file" reads one.
- Write the real symbol, file, flag or command name. A description of it sends the reader searching.
- Link text says where it goes. Never "click here".
- No slashes (`a/b`, `and/or`). Write "a, b, or both". No "(s)" plurals.
- Never "simply", "easy" or "quickly" in a procedure.
- Do not widen scope with a word. "Every page fails" is false when the evidence covers three pages.

## Banned constructions

- **Preamble.** No opener that announces or restates the task: "Let me...", "This document describes...". Start with the content.
- **Throat-clearing.** "It is worth noting that", "It is important to note that". Delete.
- **Closing recap** of what the reader has just read, and **closing pleasantries**. Stop when the content stops.
- **Contrast framing.** "It is not X, it is Y", "not X but Y", "not just X, but Y", "X rather than Y", "X, not Y". State Y. When X is itself a fact the reader needs, write two plain statements: "Reading is confirmed. Writing is untested."
- **A restating sentence** that repeats the one before it for emphasis.
- **A word repeated in consecutive sentences.** Restructure or use a pronoun. Never swap in a synonym.
- **Rule of three.** Use the natural number of items.
- **Generic conclusions.** "This lays a solid foundation." State the plan or the fact.
- **Confirmation questions.** Never ask the reviewer to confirm your own reading ("Is this right?", "Shall I proceed?"). Ask only what has two real answers.

## Words

- **AI vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry, testament, underscore, vibrant. Use the plain word.
- **Puffery.** "Seamless", "powerful", "robust", "groundbreaking", "best-in-class". State what it does.
- **Superficial -ing tails.** "...highlighting...", "...ensuring...", "...reflecting...". Delete, or expand into a sentence with a fact.
- **Fancy "is".** "Serves as", "stands as", "boasts", "features". Write "is" or "has".
- **Plain words.** `use` over `utilise` or `leverage`, `help` over `facilitate`, `many` over `numerous`, `if` over `in the event that`, `start` over `commence`, `about` over `approximately`.
- **Filler.** "In order to" becomes "to". "Due to the fact that" becomes "because".
- **Abstract metaphor nouns.** Substrate, wedge, vector, locus, nexus, primitive (as a noun), harness (as a metaphor), surface (as in "API surface"), scaffolding (as a metaphor), paradigm, north star, flywheel. Use the concrete word.
- **Idioms.** "Circle back", "move the needle", "on the same page". Write the literal action.
- **Adjectives and adverbs carrying no fact.** `significant`, `comprehensive`, `critical` when nothing measures them. "Runs quickly" becomes the number.
- **Hedging.** Cut stacked hedges: "could potentially possibly" becomes "may". Keep a hedge that separates proven from inferred. Deleting it manufactures confidence.

## Say what it does

Name the mechanism or a number. "The data stays close at hand" names a feeling. "`.toSQL()` returns the exact string sent to the database" names a mechanism.

Anchor every claim to a named thing: this file, this route, this field, this command. A sentence that could appear unchanged in another project's ticket says nothing about this one, so cut it.

## Punctuation and formatting

- **No em dashes.** Use a full stop or a comma. Parentheses, en dashes and spaced hyphens used as dashes are the same tell.
- **Colons** before a list or an example only, never as a mid-sentence connector.
- **Bold** sparingly.
- **Inline-header lists.** A bold label and colon that restates its line ("**Performance:** Performance improved...") becomes prose.
- **No decorative emojis or icons.**

## Compression keeps every fact

Cut filler, repetition, contrast framing, empty adjectives and restating sentences freely. They lose nothing.

Drop information only under a stated limit, such as the `context.md` line cap. Then drop background the reader already has first, then alternatives not chosen, then extra examples, then detail behind a conclusion (keeping the conclusion). Never drop a number the reader may act on, a hedge that separates proven from inferred, a caveat that changes a decision, a stated exclusion, or a safety or cost warning. Name what was left out.

## Reader: the reviewer

A busy person deciding from the board. They read the first line and the left edge of each bullet, and act on what is in front of them.

- **Short, easy to read, informative.** Say what the reviewer needs to know or decide, in everyday words, and stop. Leave out process narration ("I read the files, then…") and anything they would not miss. Short never means vague: keep every number, name and fact they may act on.
- **Lead with what they must do, then the answer.** The first line of a review packet, a `blocked.md` or a step note says what is needed from them, or what is now true when nothing is.
- **Show what now works.** Name the changed behaviour and how to see it: "Exports now include archived rows. Open `/reports`, tick Archived, export." A list of edited files is evidence, and goes last.
- **Errors as location, cause, fix.** "Test fails at `auth.spec.ts:42`: expected 200, got 401. Cause: missing auth header. Fix: send the `Authorization` header."
- **Define a term on first use.** Never assume the reviewer read another file in the ticket.
- **Explain systems, not lines.** Lead with what and why, then how. Reference code as `path:line`; never paste more than a few lines.
- **Group past four.** More than four points go under headings. Grouping is the fix, never cutting real points.
- **Proven and inferred, labelled.** "Reproduced locally" and "likely on production too, not reproduced" are different claims.

## Reader: the next agent

It reads every word literally and shares no memory of this session. Anything not on the page does not exist for it.

- **Terse and impersonal.** No voice, no opinion, no first person.
- **Self-contained.** No "as discussed", "see above", "the earlier fix". Name the file, the commit, the decision.
- **Exact identifiers.** The real file, symbol, flag, command and version.
- **Every rule checkable, with its why.** "Keep components under 200 lines, because the lint gate fails above that" beats "keep components small".
- **Structure over prose.** Tables for facts that share dimensions, numbered lists for procedures, short declarative sentences for single facts.
- **Write what is true now.** When rewriting `context.md`, state the current state. No "previously", no "no longer".
- **Mark anything unverified as unverified.**

## Reader: a developer

- Commit subject under 72 characters, imperative, saying what the change does. The body says why, and anything a reviewer would otherwise have to ask.
- Commit messages, code comments and anything the project ships never say an agent or AI wrote them. No attribution trailer, footer, link or emoji.

## Before writing a file

- The reader is named and that reader's section was applied.
- The first sentence of each unit carries its point. No preamble, recap or pleasantries.
- No em dashes, no contrast framing, no paragraph over the limit, no repeated word in consecutive sentences.
- The file is in the language its reader's setting names, and any `localRules` file was applied.
- Every number, path and name unchanged, and every hedge in the source still a hedge.
- Anything dropped is named.
