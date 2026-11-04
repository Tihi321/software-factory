# Workflow state conventions

Canonical definition of the state files that skills write and the dashboard reads. Skill-side
copies (for example the director's `state-files.md`) must match this document field for field.

All files live in the ticket folder `.claude/tickets/<ticket>/` (or `.codex/tickets/<ticket>/`).
Every file is optional; readers must cope with its absence. Old files without these conventions
keep working: the scanner falls back to heuristics and shows how it guessed (`statusSource`,
`statusRaw`).

## 1. plan.md front matter

First lines of `plan.md`, fenced by `---`, flat keys only (scalars and `[a, b]` lists).

| Key | Values |
|---|---|
| `status` | `draft`, `approved`, `in-progress`, `blocked`, `done`, `dropped` |
| `request` | `REQ-nnnn` (same repo), `<repo-folder>/REQ-nnnn` (other repo), or `none` |
| `repos` | `[<folder>, ...]` |
| `branch` | `<name>` or `none` |
| `updated` | `YYYY-MM-DD` |

Every write to the front matter block sets `updated` to today's local date. Write the front
matter first, then append the matching event.

Writers: the planner (`draft`), director-scribe (`approved` on the user's yes; `done` after a PASS
checker verdict (or on the user's word after a 2nd re-check FAIL); `dropped` on the user's word), implement (`in-progress` plus `branch` at branch
cut, `blocked`; `done` at changelog only when `request` is `none`). A `request` that is a REQ id marks
the ticket director-managed: implement stays `in-progress` after `changelog.written`, appends no
`ticket.done`, and the director closes it.

Example:

```markdown
---
status: in-progress
request: REQ-0007
repos: [software-factory, claude-mods]
branch: workflow-dashboard
updated: 2026-11-04
---
# Plan: workflow dashboard
```

## 2. attention.md

One `## A-<nnn> <what, one line>` heading per item, then `- key: value` lines.

| Key | Meaning |
|---|---|
| `status` | `open`, `answered`, `withdrawn` |
| `asked` | `YYYY-MM-DD HH:MM` (local time) |
| `by` | the actor that asks (not necessarily the one that writes the item) |
| `why` | why the user is needed |
| `options` | nested `  - ` lines, one per option |
| `recommendation` | what the asker suggests |
| `default` | what happens with no answer |
| `answer` | empty until answered; then the user's words and date (local time) |

Items are never deleted; answering sets `status: answered`. Writers: director-scribe, implement
orchestrator.

Example:

```markdown
## A-001 Which port should the dashboard use?
- status: open
- asked: 2026-11-04 14:10
- by: implement
- why: 4317 may clash with another local service
- options:
  - 4317
  - 8787
- recommendation: 4317
- default: 4317
- answer:
```

## 3. events.jsonl

Append-only, one JSON object per line, UTF-8. Each event is one line; several lines may be
appended in one write when they happened together; never rewrite or reorder earlier lines.

Required fields: `ts`, `actor`, `type`, `ticket`, `detail`. `request` may be `null`. `data` is an
optional object.

- `ts` is when the event happened (UTC ISO). Append each event when it happens, not in a batch at
  the end. A writer without a clock uses the time its brief gives.
- `actor`: `planner`, `director`, `director-scribe`, `implement`, `implementer`, `director-checker` or
  `user`.
- `detail`: one line, at most ~80 characters; counts and lists go in `data`.
- A slice is one child launch; list the plan tasks it covers in `data.tasks`, e.g.
  `["T1","T2"]`.
- Date-times in `attention.md` (`asked`, `answer`) are local time; event `ts` is UTC.

Types and their writer (unknown types are kept and shown):

| type | writer | when |
|---|---|---|
| `plan.created` | director-scribe | after the planner returns the plan |
| `plan.approved` | director-scribe | on the user's yes |
| `implement.started` | implement | at branch cut |
| `slice.started` | implement | when a child is launched |
| `slice.done` | implement | when the child reports success |
| `slice.failed` | implement | when the child reports failure |
| `verify.passed` | implement | when verification finishes and passes |
| `verify.failed` | implement | when verification finishes and fails |
| `attention.opened` | the writer of the item: implement for its own, else director-scribe | when the item is added |
| `attention.answered` | whoever relays the answer (director-scribe under a director, implement standalone) | when the answer is recorded |
| `checker.verdict` | director-scribe | after director-checker returns |
| `changelog.written` | implement | when `changelog.md` is written |
| `ticket.done` | director-scribe under a director; implement standalone | on done (see `status` writers) |
| `ticket.dropped` | director-scribe | on the user's word |
| `note` | the current owner | any time |

Handover: the scribe writes until `plan.approved`; implement owns the ticket from
`implement.started` until `changelog.written` or `blocked`; then the scribe again. On resume
after `blocked`, the scribe records the answer (`attention.answered`), then implement sets
`in-progress` and owns the ticket until `changelog.written`. Exactly one writer per ticket at a
time: while implement owns the ticket the scribe writes none of its state files; a director
attention item or a drop in that window waits until implement hands back (or the director stops
implement first). `blocked` is written by implement: front matter `status: blocked` first, then
`attention.opened`.

Example (one line):

```json
{"ts":"2026-11-04T14:02:11Z","actor":"implement","type":"slice.done","request":"REQ-0007","ticket":"HUB-09-x","detail":"scan slice done","data":{"tasks":["T1","T2"]}}
```

## 4. discoveries.md

Out-of-scope defects or oddities found while working. Not ideas; ideas stay under `Extra ideas`.
One line per finding:

`- YYYY-MM-DD <actor>: <finding> (<path>[:line]) - suggested: <action>` (one parenthesised group only)

Never acted on without the user. The dashboard shows the count. Writers: the implement
orchestrator for work run through `implement`; director-scribe only for workers the director runs
directly (roles), never re-copying a department's discoveries.

Example:

```markdown
- 2026-11-04 implementer: config loader ignores a trailing comma silently (src/scan/index.js:42) - suggested: report it in errors
```

## 5. Stale rule and read-only promise

Read-only: the scanner and server only read, never write to any scanned repo or `~/.claude`; only
GET routes exist; the sweep only reports. Nothing is closed or edited automatically.

Request stale: status `open` or `in-progress` and `lastActivity` older than `staleDays`; or status
`waiting-on-user` older than `staleDays` (reason "waiting N days").

Ticket stale ("abandoned?"): status not `done` or `dropped` and `lastActivity` older than
`abandonDays`.

`lastActivity`: max of file mtimes in the ticket dir and the last event `ts`; for requests, max of
`updated`, the last Log line and the linked tickets' `lastActivity`.

Ticket status precedence: front matter `status`, then a `Status:` line in plan.md (done,
implemented, complete, merged map to done; not started, plan, agreed map to planned; else unknown
with `statusRaw`), then changelog.md exists (all boxes checked means done, else implemented), then
any checked box means in-progress, then plan.md only means planned, else unknown.

Inbox ("Needs you"): requests `waiting-on-user` (omitted when a linked ticket has an open attention item); open attention items; tickets with status
`blocked`; factory jobs with stage `needs-human`. Sorted oldest `since` first.

Sessions: newest `sessionsPerRepo` per repo by file mtime; only `cwd`, `gitBranch` and the last
`custom-title` (else last `agent-name`) are read. No message bodies or prompts are ever copied.

## C3 index summary

`GET /api/index` returns one JSON object. All paths are absolute with forward slashes; times are
ISO 8601 strings or `null`; `repo` is the path relative to its root (for example
`Personal/creative-hub`; with more than one root it is prefixed with the root's last folder name, with one root it is not); unknown values are `null`, never omitted.

- `Event` = `{ts, actor, type, request, ticket, detail, data}`; unknown strings and absent `data` are `null`
- `version` (1), `generatedAt`, `scanMs`, `roots` (existing roots actually scanned)
- `settings`: `{ roots[], exclude[], sources: { roots, exclude } }`; `roots` are the configured folders (expanded,
  forward slashes), `sources` each one of `cli`, `env`, `config.local.json`, `config.json`
- `repos[]`: `repo, path, ticketCount, requestCount, sessionCount, lastActivity`
- `requests[]`: `key` (`<repo>#REQ-0004`), `repo, id, title, status, path, created, updated, file,
  links[], pieces[]` (`n, piece, role, tier, effort, agent, status`), `logTail[]` (`ts, text`; last
  5 Log lines), `lastActivity, stale, staleReason, warnings[]`
- `tickets[]`: `key` (`<repo>#<folder>`; codex tickets `<repo>#codex:<folder>`), `repo, name, dir`, `harness` (`claude` or `codex`),
  `front` (`status, request, repos, branch, updated` or `null`), `status` (`draft`, `approved`,
  `planned`, `in-progress`, `blocked`, `implemented`, `done`, `dropped`, `unknown`), `statusSource`
  (`front-matter`, `status-line`, `changelog`, `checkboxes`, `none`), `statusRaw`,
  `checkbox` (`done, open`), `files` (booleans: `plan, changelog, handoff, research, attention,
  events, discoveries`), `request`, `attention[]` (`id, what, status, asked, by, why, options[],
  recommendation, default, answer, open`), `events` (`count, badLines, last, recent[]`; `last` and `recent` items are `Event`; `recent` = last 10 valid events, newest first), `discoveries`
  (count), `lastActivity, stale, staleReason`
- `factory[]`: `repo, file, jobs[]` (`id, title, branch, stage, round, decision, note, updated`)
- `sessions[]`: `id, repo, cwd, title, branch, lastActivity, sizeBytes`
- `inbox[]`: `kind` (`request`, `attention`, `ticket`, `factory`), `key, repo, title, since, detail`
- `errors[]`: `file, message`
