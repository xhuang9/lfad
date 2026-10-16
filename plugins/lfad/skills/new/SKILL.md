---
name: new
summary: Create a ticket and let the agent pick the step it starts in.
description: Create an agent-dashboard ticket from the user's intent and choose its starting step from the board's entry steps, by matching the intent against each step's `entryWhen` in board.yml. Works for any pipeline, including steps added later, because it reads the live steps. Writes the ticket body by the lfad:idea contract, writes context.md when the ticket skips earlier steps, and creates it in the chosen step. Auto-invoke when the user says "new ticket", "add a ticket and put it where it belongs", "create a ticket at the right stage", "start this at <step>", or runs /lfad:new. For creating a ticket that always starts at the idea step, use lfad:idea.
---

# lfad:new: create a ticket in the right step

Resolve the board, daemon and CLI exactly as `lfad:move` describes. Write every file by `../move/wording.md`, which layers the board's `writing`, `guidance` and `localRules` over the plugin defaults.

## 1. Read the entry steps

`GET /api/steps` and keep the steps with `entry: true`, in pipeline order. Each one may carry `entryWhen`: one line saying when a new ticket should start there. With the daemon down, read the same fields from `board.yml`.

Read the steps live every time. A step added with `lfad:add-step` or marked as an entry step later is a valid choice as soon as `board.yml` says so.

## 2. Pick the step

1. If the user named a step ("start this at todo"), use it when it is an entry step. If it is not, say so and pick by the rules below.
2. Otherwise, match the intent against each step's `entryWhen`. Pick the **latest** entry step whose `entryWhen` the intent fully meets, judged by what the user said and what you can check in the code now.
3. When in doubt between two steps, pick the earlier one. Earlier steps add research and questions. A wrong late start skips them.
4. An entry step with no `entryWhen` is a fallback. Pick it only when the user names it, or when it is the first entry step and no other step fits.
5. A step with `skipUnless: <flag>` applies only when that ticket flag is true. Starting there means the ticket needs the flag, so set it (for `needsDesign`, see the lfad:idea contract).

Name the chosen step and the `entryWhen` line it meets in one sentence. Ask the user only when two steps fit equally and the choice changes what a person must do next.

## 3. Write the ticket

Write the title, category, tags, `needsDesign` flag and the four-section body exactly as the **ticket contract** in `../idea/SKILL.md` describes. The Rough idea keeps the user's own words, whichever step the ticket starts in.

When the chosen step comes after the first entry step, the steps in between never run for this ticket. Their outputs do not exist. Write `context.md` so the starting step's skill has what it needs:

- the CURRENT-STATE block from `lfad:move`, naming the starting step and the steps skipped;
- the files and code the work touches, as exact paths;
- every decision the user has already settled, in their words;
- anything the skipped steps would normally have checked that you have not checked, marked unverified.

Starting at the first entry step needs no `context.md`. That step's skill writes it.

## 4. Create it

REST, with the chosen step:

```bash
curl -fsS -X POST "$BASE/api/tickets" -H 'content-type: application/json' \
  -d '{"title":"<title>","category":"<category>","tags":["<tag>"],"body":"<the body>","entryStep":"<step>"}'
```

Add `"needsDesign": true` when the flag applies. The daemon rejects an `entryStep` that is not an entry step, with a 400.

Daemon down: `FLOW create "<title>" --category <category> --tags <a,b> --body "<the body>" --step <step>`. Add `needsDesign: true` to the new `ticket.md` frontmatter afterwards when it applies.

Then write `context.md` into the new ticket folder, if step 3 called for one.

## 5. Stop and report

Leave the ticket in its starting step. Do not run the step's work. The user starts it with Next (`/lfad:next <id>`), which runs that step's skill.

Report in one or two lines: the id, the title, the starting step, and the `entryWhen` line it met. When you skipped steps, name them.
