# software-factory

A read-only local dashboard for workflow state. A zero-dependency Node scanner builds one JSON
index of requests, tickets, attention items, factory jobs and recent sessions across your project
folders; a tiny HTTP server on `127.0.0.1` serves it with one static page. Screens: Needs you,
Requests, Tickets, Stale, Sessions, Settings.

## Run

```
fnm exec --using default node src/server.js
```

Then open http://127.0.0.1:4317/. Requires Node >= 20 (on this machine:
`fnm exec --using default node src/server.js`; the npm scripts below exist, but `fnm exec ... npm` may not resolve here). No `npm install` is needed; there are no dependencies.

## Read-only promise

- The scanner and server only read. They never write to any scanned repo or to `~/.claude`.
- Only `GET` routes exist; there is no way to act on anything from the UI.
- The server binds to a loopback address only and rejects foreign `Host` headers.
- Session message bodies, prompts and tool output are never read into the index; only titles,
  `cwd` and branch.
- The one write in the code is `cli.js scan --out <path>`, which you ask for explicitly.

## config.json

| Key | Meaning | Default |
|---|---|---|
| `roots` | folders searched for repos | `["C:/projects"]` |
| `maxDepth` | how deep to walk each root | `3` |
| `sessionsDir` | Claude Code session folder | `"~/.claude/projects"` |
| `sessionsPerRepo` | newest sessions kept per repo | `5` |
| `staleDays` | idle days before an open request is stale | `3` |
| `abandonDays` | idle days before an unfinished ticket is "abandoned?" | `14` |
| `host` | listen address (must be loopback) | `"127.0.0.1"` |
| `port` | listen port | `4317` |
| `cacheSeconds` | how long `/api/index` is cached | `15` |
| `exclude` | glob patterns of repos to skip (see Choosing folders) | `[]` |

## Choosing folders

`roots` is an array of folders to scan. Three ways to set it, highest priority first:

1. CLI: `node src/cli.js scan --roots "C:/projects/Personal;~/work"` (also `node src/server.js --roots "..."`).
2. Environment: `DASHBOARD_ROOTS="C:/projects/Personal;~/work"` (`;`-separated).
3. `config.local.json` in the repo root (git-ignored, optional; same keys as `config.json`, shallow-merged over it).
   Copy `config.local.example.json`. Without any of these, `config.json` applies.

```json
{
  "roots": ["C:/projects/Personal", "~/work"],
  "exclude": ["Cowork/**", "Local/*"]
}
```

`~` expands to your home folder; backslashes are fine. A missing root is reported under errors and the
scan continues. `exclude` patterns are matched case-insensitively against a repo's path relative to its
root and against its absolute path: `*` is one path segment, `**` is any depth. Excluded repos are not
scanned. With more than one root, repo keys are prefixed with the root's last folder name
(`Personal/creative-hub`); with one root they are unchanged.

The config is re-read on every rescan (so edits to `config.local.json` apply on the next refresh or
after `cacheSeconds`, no restart). `host` and `port` are read once and need a restart. The Settings
tab shows the active roots, patterns and where each came from.

## Scripts

| Script | Command |
|---|---|
| `npm start` | `node src/server.js` |
| `npm run scan` | `node src/cli.js scan [--out <path>] [--stats]` |
| `npm run sweep` | `node src/cli.js sweep` (stale-request report, markdown) |
| `npm test` | `node --test` (run as `fnm exec --using default node --test`) |

## State conventions

The files the dashboard reads (plan.md front matter, attention.md, events.jsonl, discoveries.md,
request files) are defined in [docs/conventions.md](docs/conventions.md), which is canonical.
