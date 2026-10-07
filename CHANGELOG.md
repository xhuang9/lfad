# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-12

### Added

- fast-pass note endpoint so daemon-up skips land in stepNotes
- global command-prefix toggle (#9) + archive Category column (#13)
- archive/reactivate REST routes + CLI fallback; playbook routes through the daemon
- sidebar reshuffle + live version footer via /api/info (#11)
- dark mode — OS default + System/Light/Dark toggle (#7)
- running-lease + dynamic prompt-file label + open-question card bar
- live ticket-count badge on the Board nav item (#14)
- click-to-copy inline file paths in rendered markdown

### Changed

- Merge bugfix/30-38-ui-wave-a (#30 #38)
- Merge docs/skills-consistency-batch (#35 #36 #39 #41)
- Merge feature/40-fastpass-rest (#40)
- derive step behavior from /api/steps metadata instead of hardcoded keys
- reference flow:move's canonical guidance/CURRENT-STATE definitions instead of restating
- todo/build produce the buildStages marker review consumes
- review routes on the real Approve/Reject answer values
- extend the running-claim requirement to interview/mock/design/absorb/prompt
- Merge refactor/17-b5-locate-once (#17 batch 5)
- Merge bugfix/17-b5-app-hardening (#17 batch 5)
- thread located ticket dirs through mutations and per-line run logging
- target-repo error-observability contract — build adds, review verifies (#19)
- Merge feature/29-readme-operating-loop (#29)
- Merge feature/27-archive-rest-surface (#27)
- document the flow:next operating loop, review gate, and prompt escape hatch
- Merge feature/28-engine-respect-leases (#28)
- Merge bugfix/24-kill-process-tree (#24)
- Merge bugfix/25-seed-wipe-guard (#25)
- Merge bugfix/20-unify-default-boards (#20)
- Merge bugfix/21-history-validation (#21)
- Merge bugfix/23-relocate-crash-safety (#23)
- Merge bugfix/22-surface-unreadable-tickets (#22)
- replace the nonexistent /flow:input with the input-mode affordance in next and review
- extract the triplicated md-path click-to-copy into useMdPathCopy
- mock/design approval templates use the canonical approve type
- dedupe the crash-safe atomic write into fs-atomic and fsync the counter
- fix factual drift — nine-step default, missing REST routes, example-board lineup, adapter placeholders
- add always-current CURRENT-STATE handoff block to every step
- agent may chain idea -> interview in one pass; questions go on the ticket, not a chat modal
- document archive browsing
- Merge branch 'flow/6-next-all-button'
- Show runnable ticket count in Run action (#6)
- update
- Merge branch 'flow/2-archive-tab'
- cover archive listing API
- Rename Next-all board action to Run (#6)
- Add Archive sidebar tab + searchable archive page (#2)
- Merge branch 'flow/3-prompt-buttons'
- Merge branch 'flow/4-move-via-prompt'
- Add board-level Next-all button copying a process-all-unblocked prompt (#6)
- Add context-aware Prompt File and Prompt Ticket drawer buttons (#3)
- flow:prompt may move a ticket to any step, forward or backward (#4)
- Allow comment-only answers in board input mode (#5)
- Input-mode question UI + flow skill pipeline refactor
- The single plan step fans out into four skills — research (agent step, structures and investigates the raw idea), interview (gate, converges Goal/Constraints/Success Criteria through a short evidence-first Q&A into decision slots), and the design-only pair mock + design (gates, each skipUnless: needsDesign, approving layout then visual polish before todo) — plus a new input skill (the one-question-at-a-time chat-side answer collector every gate points to), and setup.mjs's DEFAULT_BOARD_YML now writes the resulting eight-step two-row default pipeline (idea → research → interview → mock → design → todo → doing → done; rows agents = research/todo/doing/done, needs-you = idea/interview/mock/design) with matching step folders, verified by a smoke bootstrap that serves the fresh board and lists all eight steps over the API; add-step, build, idea, move, todo, and up SKILL.md plus README.md and docs/board.example.yml are updated in lockstep so the grammar, gate rules, and pipeline diagram stay consistent with the new shape, and the retired plan skill is removed (migrate-board.mjs's own reference is left as-is — it documents the legacy numbered-folder migration path, not the plan step).
- Board cards and the ticket drawer gain a one-question-at-a-time input mode (a new amber "? n" badge deep-links into /t/:id/input) that surfaces every open fenced question block and bare Decision line in file/rail order with its context markdown and a progress counter, answers choice questions via buttons and confirm/text questions via a form, and writes back ONLY the matching Decision line with a today-stamped answer, guarded by a server-side optimistic-concurrency precondition on the artifact PUT (a baseContent mismatch now 409s instead of silently overwriting a concurrent edit), a fresh re-fetch-and-relocate of the question before every write to dodge stale-file and duplicate-id/ask/context ambiguity, a hold on the drawer's live refetch while a draft answer is dirty so a board tick never clobbers typing, and a dirty-input-mode reset on ticket-id change so a stale hold can never misdirect a submit to the wrong ticket; the board's steps and manual API responses also now carry step- and board-level guidance text, surfaced in the completion state's copyable next-skill commands and the in-app manual.
- Frontmatter extras preserve unknown ticket.md keys through move/serialize round trips so custom skipUnless flags survive, question-block YAML parser adds openInputs/questions[] to board and ticket API payloads with recount on artifact write, html artifacts serve sandboxed with a Content-Security-Policy header, and board+step guidance flows through /api/steps, /api/manual, and the agent prompt
- Full-height shortcut settles on f (YouTube-style primary) + cmd-shift-F alias, both drawer-scoped and typing-guarded; hold-modifier hint badges now cover every shortcut — expand and close get floated kbd badges, the id pill reveals c
- ⌃F toggles the drawer's full height (drawer-scoped, matches the ⌃-shortcut convention; ⌘F stays browser find); button tooltips + Manual Keys line updated
- Markdown rendering on markdown-it (VS Code's preview engine): full CommonMark + GFM tables, task lists, nested lists, autolinks; heading anchors keep the existing slugify so deep links survive; relative image/link resolution moves into renderer rules via env; clickable heading outline column beside docs with 2+ headings; mermaid fences render to SVG via a lazy-loaded chunk (only fetched when a fence exists, main bundle +~50KB gzip); drawer gains a full-height toggle beside close — opens at 50vh, slides to 100vh
- UI redesign — 'instrument panel': cool porcelain ground with a faint dot grid replaces the ivory paper + grain, Bricolage Grotesque / IBM Plex Sans / IBM Plex Mono replace Fraunces / Hanken / JetBrains, mono microlabels drop to a 12-13px label tier (reading text stays 16px), all ink tiers now pass WCAG AA (ink-3 was ~3:1), crisp flat shadows + tighter radii, flat primary button, rail widens to 200px with a 16px SVG group chevron and a real hover target
- Drawer polish: markdown joins hard-wrapped lines into whole paragraphs/list items/quotes (CommonMark soft-break behavior, matching editor previews) and flows full-width (64ch cap removed); Edit/Save/Cancel move up into the header action row; rail step-groups collapse — headers toggle, current step + deep-linked group start open
- Remove the Copy agent prompt affordance: the copy-command skill buttons are the sole hand-off (drawer button, ⌃C shortcut, move-prompt builder, getInfo/BoardInfo client plumbing, manual entry, README + up-skill mentions all removed)
- Viewer shift: the UI goes view-only — drawer action buttons copy /flow:<skill> <id> to the clipboard instead of spawning runs (run engine kept headless + dormant, banner says so), the content rail becomes the ticket folder's markdown grouped Idea → root files → step subfolders in pipeline order (new core listTicketFiles + runtime canonical ordering, natural NN-prefix sort), images render via a new traversal-guarded GET /api/tickets/:id/files/* allowlist route and relative-path resolution in the markdown renderer, PUT artifact accepts nested relative names with the same guard, TicketDrawer split into a folder (hooks + section components, run surface stripped), deep links /t/:id/<path>, live drawer refetch on board-changed; lifecycle skills now write per-step file sets (plan/, todo/, doing/ + images/) and docs/.env.example reframe the engine as dormant.
- Per-step actions lists own the drawer buttons (board.yml actions: []; POST run {skill} resolves pull-as-step vs in-place, in-place action runs never auto-advance); new flow:add-skill authors a project-local skill from natural language and binds it; hold ctrl/cmd reveals shortcut badges
- Drawer run actions become skill buttons: the current step's skill (entry steps excluded) + the next step's pull, ctrl+1..9 shortcuts + ctrl+C copy-prompt; /api/steps exposes skill; POST run accepts {step} to pull the ticket in before running
- Headless runs load the flow skills: built-in adapter passes --plugin-dir {pluginDir} (claude -p ignores user-level plugin registration); empty-resolving flag pairs are dropped from argv. Run log renders stream-json readably (agent text, tool calls, collapsible results, dimmed session events)
- Sentinel scanning is output-mode aware and line-anchored: stream-json runs scan ONLY the assistant's own text (tool results quoting the sentinel docs no longer false-block); fake agent emits claude-shaped events + trap regression tests
- Ticket drawer becomes a bottom sheet: full width, 50vh, slides up from the bottom (was a fixed-width right panel)
- Steps reshape: stage→step full rename (legacy aliases kept), new 5-step default pipeline (idea/plan/todo/doing/done), skill library reshape (add-step/up renames; idea/plan/todo/build/archive/move rewrites; add-test/checks/design/doc/shape removed)
- Board gitignore covers .hitloop/ (BOARD_IGNORES + bootstrap writes .gitignore before the first board snapshot)
- bootstrap detects the in-board install (.hitloop dir name -> board = parent) and scaffolds .env with HITLOOP_BOARD=.. accordingly
- Standalone product + per-project clone installs: demo sandbox moves inside the tool (.demo-flow, gitignored); README + /flow:setup document install-by-clone (origin = product repo, update = git pull + rebuild)
- In-board install layout: tool lives at <board>/.hitloop; watcher ignores dot-entries generically (stage keys can never start with a dot); demo board two levels up; docs + setup/board skills document in-board (canonical) vs sibling layouts
- Phases D-G: CLI ticket commands, flow:move + stage-skill library, flow:stage + minimal setup, docs sync
- Config-driven stages (phases A-C): board.yml loader + agent adapters + worktree primitives + engine/UI rework + board migration script
- Serve UI from <board>/.ui (gitignored, copied from tool on serve) so .flow is self-contained; HITLOOP_UI_DIR now an override; vertical sidebar footer; updated skills + README + .env.example + tests
- /flow:board auto-detects $PWD/hitloop when HITLOOP_HOME unset; README documents plugin install commands + skill-vs-command
- Manual redesign: collapsed accordion skills (short summary, expand for detail) + bold bulleted board actions; add summary frontmatter to skills
- Add comprehensive README + in-app Manual (sidebar button → modal of skills & board actions, generated live from plugin SKILL.md via GET /api/manual)
- Install consolidated into /flow:setup skill + idempotent scripts/setup.mjs (pnpm bootstrap): build, ensure+git-init board, scaffold .env, verify; reproducible by any agent
- Phase 3: agent-execution runner (claude -p spawn, queue cap1, dry-run, timeout, FLOW_BLOCK sentinel, env-gated worktree, autopilot) + UI Run/Stop/log-tail; tested with a fake agent
- Distribution (Option B): flow Claude plugin + /flow:board launch skill; daemon serves any external/empty project board (mkdir board root)
- .env-driven daemon (HITLOOP_PORT/BOARD/UI_DIR/DOCS_*), board defaults to ../.flow (sibling), relocatable doc dirs exposed via /api/info; demo board -> ../.demo-flow
- hide empty columns, show raw #id (not zero-padded), reframe move-prompt as 'start working / agent prompt'
- View-only board: deep-link URLs, copy-id, inline markdown editing (persisted), copy-move-prompt; remove user drag (agents move tickets)
- 5-digit ticket ids, 12px badges, numbered column headers; demo builds core first
- two-row board (Agents / Needs you), scrollable columns, 16px text floor, sidebar scroll + images
- enforce 14px minimum text size across all elements
- UI refresh: warm command-center aesthetic (Fraunces/Hanken/JetBrains, paper grain, depth, motion)
- Phase 1: @hitloop/runtime daemon + @hitloop/ui board + one-command demo
- Phase 0: @hitloop/core — schema, frontmatter, file-ops, tests

### Fixed

- drawer read-only derives from archive membership, not the opening view
- reserved-name guard on artifact writes, SVG sandbox CSP, honest image-save errors
- surface unreadable ticket folders as degraded board entries instead of dropping them
- make the nine-step bootstrap pipeline the one canonical default board
- write-then-rename in relocateTicket + reconcile status to the step folder on index rebuild
- kill the agent's whole process group on run stop/timeout
- refuse engine runs on tickets held by a running-registry lease
- refuse to seed over an existing board without --force, and back it up first
- validate ticket history and stepNotes keys as opaque strings so step removal cannot brick tickets
- reject start() readably on listen errors like EADDRINUSE
- recover a failed step-list load on any board refresh
- keep in-document # anchors in-page instead of target=_blank
- show Copied only when the clipboard write succeeds
- refetch board state when the SSE stream reconnects
- reject path traversal in the /api/skills key lookup
- scan for orphaned ticket dirs before persisting a fresh board's default config
- send baseContent on inline-editor saves so a save cannot clobber an agent's concurrent write
- reconcile allocateId with the max ticket id on disk so a stale .counter never re-issues an id
- only git-snapshot a board that is its own repo, never the user's parent repo
