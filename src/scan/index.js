// Read-only scanner. Builds the C3 index. Never writes to disk.
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { discoverRepos, expandHome, statOrNull, toPosix } from './discover.js';
import { scanRequests } from './requests.js';
import { scanTickets } from './tickets.js';
import { scanFactory } from './factory.js';
import { scanSessions } from './sessions.js';
import { requestStale, ticketStale } from './stale.js';
import { maxIso } from './markdown.js';

export { sweepReport } from './stale.js';

const DEFAULTS = { roots: ['C:/projects'], maxDepth: 3, sessionsDir: '~/.claude/projects', sessionsPerRepo: 5,
  staleDays: 3, abandonDays: 14, host: '127.0.0.1', port: 4317, cacheSeconds: 15 };

const splitList = (s) => String(s).split(';').map((x) => x.trim()).filter(Boolean);

/**
 * Precedence for roots (highest first): options.roots (CLI) > env DASHBOARD_ROOTS > config.local.json > config.json.
 * config.local.json (next to the base config, optional) is shallow-merged over it. exclude: local over base.
 * Each call re-reads the files, so edits apply on the next rescan.
 */
export async function loadConfig(path, { roots: cliRoots, env = process.env, localPath } = {}) {
  const file = path ?? fileURLToPath(new URL('../../config.json', import.meta.url));
  const base = JSON.parse(await readFile(file, 'utf8'));
  let local = {};
  try { local = JSON.parse(await readFile(localPath ?? file.replace(/config.json$/, 'config.local.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const merged = { ...DEFAULTS, exclude: [], ...base, ...local };
  const sources = { roots: 'config.json', exclude: 'config.json' };
  for (const k of ['roots', 'exclude']) if (k in local) sources[k] = 'config.local.json';
  const envRoots = env.DASHBOARD_ROOTS ? splitList(env.DASHBOARD_ROOTS) : [];
  if (cliRoots?.length) { merged.roots = cliRoots; sources.roots = 'cli'; }
  else if (envRoots.length) { merged.roots = envRoots; sources.roots = 'env'; }
  return { ...merged, sources };
}

/** Parse a "--roots a;b" value. */
export const parseRoots = (s) => (s ? splitList(s) : undefined);

const TICKET_LINK = /(?:^|\/)\.(claude|codex)\/tickets\/([^/]+)/;

function linkedTicketKeys(req, repos, ticketKeys) {
  const keys = [];
  for (const raw of req.links) {
    const link = toPosix(raw);
    const m = TICKET_LINK.exec(link);
    if (!m || link.includes('/worktrees/')) continue;
    let repoName = req.repo;
    if (/^[A-Za-z]:\//.test(link) || link.startsWith('/')) {
      const owner = repos.filter((r) => link.toLowerCase().startsWith(`${r.path.toLowerCase()}/`))
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (!owner) continue;
      repoName = owner.repo;
    }
    const key = `${repoName}#${m[1] === 'codex' ? 'codex:' : ''}${m[2]}`;
    if (ticketKeys.has(key)) keys.push(key);
  }
  return keys;
}

function resolveFrontRequest(value, ticketRepo, repos) {
  if (!value || value.toLowerCase() === 'none') return null;
  const m = /^(?:(.+)\/)?(REQ-\d+)$/i.exec(value.trim());
  if (!m) return null;
  const id = m[2].toUpperCase();
  if (!m[1]) return `${ticketRepo}#${id}`;
  const folder = m[1].toLowerCase();
  const owner = repos.find((r) => r.path.toLowerCase().endsWith(`/${folder}`) || r.repo.toLowerCase() === folder);
  return owner ? `${owner.repo}#${id}` : null;
}

export async function scanAll(config, { now = new Date() } = {}) {
  const t0 = performance.now();
  const errors = [];
  const exclude = (config.exclude ?? []).map((p) => toPosix(p));
  const configured = config.roots.map((r) => expandHome(r));
  const roots = [];
  for (const r of configured) {
    if (await statOrNull(r)) roots.push(r);
    else errors.push({ file: r, message: 'root folder not found' });
  }
  const repos = await discoverRepos(roots, config.maxDepth, exclude);

  const perRepo = await Promise.all(repos.map(async (repo) => {
    const [rq, tk, fc] = await Promise.all([scanRequests(repo), scanTickets(repo), scanFactory(repo)]);
    return { repo, rq, tk, fc };
  }));
  const requests = perRepo.flatMap((p) => p.rq.requests);
  const tickets = perRepo.flatMap((p) => p.tk.tickets);
  const factory = perRepo.flatMap((p) => p.fc.factory);
  for (const p of perRepo) errors.push(...p.rq.errors, ...p.tk.errors, ...p.fc.errors);

  const sess = await scanSessions(config, expandHome(config.sessionsDir), repos);
  errors.push(...sess.errors);

  // Link tickets and requests.
  const ticketByKey = new Map(tickets.map((t) => [t.key, t]));
  const requestKeys = new Set(requests.map((r) => r.key));
  const linked = new Map();
  for (const r of requests) {
    const keys = linkedTicketKeys(r, repos, ticketByKey);
    linked.set(r.key, keys);
    for (const k of keys) {
      const t = ticketByKey.get(k);
      if (t.request === null && !t.front?.request) t.request = r.key;
    }
  }
  for (const t of tickets) {
    const fromFront = resolveFrontRequest(t.front?.request, t.repo, repos);
    if (fromFront) t.request = fromFront;
    Object.assign(t, ticketStale(t, now, config));
  }
  // A request is also linked to a ticket whose front matter names it.
  for (const t of tickets) {
    if (t.request && requestKeys.has(t.request) && !linked.get(t.request).includes(t.key)) linked.get(t.request).push(t.key);
  }
  for (const r of requests) {
    r.lastActivity = maxIso(r.lastActivity, ...linked.get(r.key).map((k) => ticketByKey.get(k).lastActivity));
    Object.assign(r, requestStale(r, now, config));
  }

  // Inbox.
  const inbox = [];
  // A waiting request whose linked ticket already has an open attention item is covered by that
  // (more specific) item, so it gets no entry of its own.
  const hasOpenAttention = (r) => linked.get(r.key).some((k) => ticketByKey.get(k).attention.some((a) => a.open));
  for (const r of requests) {
    if (r.status === 'waiting-on-user' && !hasOpenAttention(r)) {
      inbox.push({ kind: 'request', key: r.key, repo: r.repo, title: r.title,
        since: maxIso(r.updated, r.logTail.at(-1)?.ts) ?? r.lastActivity, detail: r.logTail.at(-1)?.text ?? null });
    }
  }
  for (const t of tickets) {
    for (const a of t.attention) {
      if (a.open) inbox.push({ kind: 'attention', key: `${t.key}/${a.id}`, repo: t.repo, title: a.what ?? a.id,
        since: a.asked ?? t.lastActivity, detail: a.why ?? a.recommendation });
    }
    if (t.status === 'blocked') {
      inbox.push({ kind: 'ticket', key: t.key, repo: t.repo, title: t.name, since: t.lastActivity, detail: t.statusRaw ?? 'blocked' });
    }
  }
  for (const f of factory) {
    for (const j of f.jobs) {
      if (j.stage === 'needs-human') inbox.push({ kind: 'factory', key: `${f.repo}#factory/${j.id}`, repo: f.repo,
        title: j.title ?? j.id, since: maxIso(j.updated), detail: j.note });
    }
  }
  inbox.sort((a, b) => (a.since === null) - (b.since === null) || String(a.since).localeCompare(String(b.since)));

  const repoRows = repos.map(({ repo, path }) => {
    const rt = tickets.filter((t) => t.repo === repo);
    const rr = requests.filter((r) => r.repo === repo);
    const rs = sess.sessions.filter((s) => s.repo === repo);
    return { repo, path, ticketCount: rt.length, requestCount: rr.length, sessionCount: sess.counts.get(repo) ?? 0,
      lastActivity: maxIso(...rt.map((t) => t.lastActivity), ...rr.map((r) => r.lastActivity), ...rs.map((s) => s.lastActivity)) };
  });

  return {
    version: 1, generatedAt: now.toISOString(), scanMs: Math.round(performance.now() - t0), roots,
    settings: { roots: configured, exclude, sources: config.sources ?? { roots: 'config.json', exclude: 'config.json' } },
    repos: repoRows, requests, tickets, factory, sessions: sess.sessions, inbox, errors,
  };
}
