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

Writers: the planner (`draft`), director-scribe (`approved` on the user's yes), implement
(`in-progress` plus `branch` at branch cut, `blocked`, `done` at changelog).

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
| `asked` | `YYYY-MM-DD HH:MM` |
| `by` | the actor that asks |
| `why` | why the user is needed |
| `options` | nested `  - ` lines, one per option |
| `recommendation` | what the asker suggests |
| `default` | what happens with no answer |
| `answer` | empty until answered; then the user's words and date |

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

Append-only, one JSON object per line, UTF-8. Never rewrite earlier lines; append with one line
per write.

Required fields: `ts` (UTC ISO), `actor` (skill or agent name, or `user`), `type`, `ticket`,
`detail`. `request` may be `null`. `data` is an optional object.

Types: `plan.created`, `plan.approved`, `implement.started`, `slice.started`, `slice.done`,
`slice.failed`, `verify.passed`, `verify.failed`, `attention.opened`, `attention.answered`,
`checker.verdict`, `changelog.written`, `ticket.done`, `ticket.dropped`, `note`. Unknown types
are kept and shown.

One writer per ticket at a time: the orchestrator, or the scribe for director events.

Example (one line):

```json
{"ts":"2026-11-04T14:02:11Z","actor":"implement","type":"slice.done","request":"REQ-0007","ticket":"HUB-09-x","detail":"short text"}
```

## 4. discoveries.md

Out-of-scope defects or oddities found while working. Not ideas; ideas stay under `Extra ideas`.
One line per finding:

`- YYYY-MM-DD <actor>: <finding> (<path:line>) - suggested: <action>`

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
  recommendation, default, answer, open`), `events` (`count, badLines, last, recent[]`; `recent` = last 10 valid events, newest first), `discoveries`
  (count), `lastActivity, stale, staleReason`
- `factory[]`: `repo, file, jobs[]` (`id, title, branch, stage, round, decision, note, updated`)
- `sessions[]`: `id, repo, cwd, title, branch, lastActivity, sizeBytes`
- `inbox[]`: `kind` (`request`, `attention`, `ticket`, `factory`), `key, repo, title, since, detail`
- `errors[]`: `file, message`
