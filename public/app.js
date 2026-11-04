'use strict';
// Read-only view. All data is rendered with textContent / createElement; never innerHTML.
const TABS = [['needs', 'Needs you'], ['requests', 'Requests'], ['tickets', 'Tickets'], ['stale', 'Stale'], ['sessions', 'Sessions'], ['settings', 'Settings']];
const state = { tab: 'needs', repo: '', q: '', index: null, error: null };

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function chip(text, cls) { return el('span', 'chip' + (cls ? ' ' + cls : ''), text); }
function pathBtn(p) {
  if (!p) return null;
  const b = el('button', 'path', p);
  b.type = 'button';
  b.title = 'Click to copy';
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(p); b.title = 'Copied'; } catch { b.title = 'Copy failed'; }
  });
  return b;
}
function ago(iso) {
  if (!iso) return 'unknown';
  const d = (Date.now() - Date.parse(iso)) / 86400000;
  if (Number.isNaN(d)) return 'unknown';
  if (d < 1 / 24) return 'just now';
  if (d < 1) return Math.floor(d * 24) + 'h ago';
  return Math.floor(d) + 'd ago';
}
function matches(...vals) {
  const q = state.q.trim().toLowerCase();
  return !q || vals.some((v) => v != null && String(v).toLowerCase().includes(q));
}
const repoOk = (r) => !state.repo || r === state.repo;

function card(title, sub, cls) {
  const c = el('div', 'card' + (cls ? ' ' + cls : ''));
  c.appendChild(el('div', 'title', title));
  if (sub) c.appendChild(el('div', 'sub', sub));
  return c;
}
function row(c, ...nodes) {
  const r = el('div', 'row');
  nodes.filter(Boolean).forEach((n) => r.appendChild(n));
  c.appendChild(r);
  return r;
}

function renderInbox(out, ix) {
  const items = ix.inbox.filter((i) => repoOk(i.repo) && matches(i.title, i.detail, i.repo, i.key));
  if (!items.length) return out.appendChild(el('div', 'empty', 'Nothing is waiting on you.'));
  for (const i of items) {
    const c = card(i.title || i.key, `${i.repo} - ${i.kind} - since ${ago(i.since)}`, 'waiting');
    if (i.detail) c.appendChild(el('div', 'sub', i.detail));
    row(c, chip(i.kind, 'attention'), chip(i.key));
    out.appendChild(c);
  }
}

function renderRequests(out, ix, onlyStale) {
  const items = ix.requests.filter((r) => repoOk(r.repo) && (!onlyStale || r.stale) && matches(r.title, r.id, r.repo, r.status));
  if (!items.length) out.appendChild(el('div', 'empty', 'No requests.'));
  for (const r of items) {
    const c = card(`${r.id} ${r.title || ''}`, `${r.repo} - active ${ago(r.lastActivity)}`, r.status === 'waiting-on-user' ? 'waiting' : '');
    row(c, chip(r.status || 'unknown', r.status), r.stale ? chip(r.staleReason || 'stale', 'stale') : null,
      r.pieces.length ? chip(r.pieces.length + ' pieces') : null);
    (r.warnings || []).forEach((w) => c.appendChild(el('div', 'sub', 'warning: ' + w)));
    (r.logTail || []).slice(-2).forEach((l) => c.appendChild(el('div', 'sub', `${l.ts || ''} ${l.text || ''}`)));
    row(c, pathBtn(r.path));
    out.appendChild(c);
  }
}

function ticketRow(t) {
  const c = card(t.name, `${t.repo} - ${t.harness} - active ${ago(t.lastActivity)}`, t.status === 'blocked' ? 'waiting' : '');
  const total = t.checkbox.done + t.checkbox.open;
  const bar = el('div', 'bar');
  const fill = el('span');
  fill.style.width = (total ? Math.round((t.checkbox.done / total) * 100) : 0) + '%';
  bar.appendChild(fill);
  row(c, chip(t.status, t.status), chip('from ' + t.statusSource), t.stale ? chip(t.staleReason || 'abandoned?', 'stale') : null,
    total ? bar : null, total ? el('span', 'sub', `${t.checkbox.done}/${total}`) : null);
  const badges = Object.entries(t.files).filter(([, v]) => v).map(([k]) => chip(k, 'file'));
  if (t.discoveries) badges.push(chip(t.discoveries + ' discoveries', 'file'));
  if (badges.length) row(c, ...badges);
  const open = t.attention.filter((a) => a.open).length;
  if (open) row(c, chip(open + ' open attention', 'attention'));
  if (t.events.last) c.appendChild(el('div', 'sub', `last event: ${t.events.last.type || ''} ${t.events.last.detail || ''} (${ago(t.events.last.ts)})`));
  if (t.events.recent.length > 0) {
    const d = el('details', 'timeline');
    d.appendChild(el('summary', null, `events (${t.events.count})${t.events.badLines > 0 ? `, ${t.events.badLines} bad lines` : ''}`));
    for (const e of t.events.recent) {
      d.appendChild(el('div', 'sub', [e.ts, e.actor, e.type, e.detail].map((v) => v ?? '-').join('  ')));
    }
    c.appendChild(d);
  }
  if (t.request) c.appendChild(el('div', 'sub', 'request ' + t.request));
  row(c, pathBtn(t.dir));
  return c;
}
function renderTickets(out, ix, onlyStale) {
  const items = ix.tickets.filter((t) => repoOk(t.repo) && (!onlyStale || t.stale) && matches(t.name, t.repo, t.status, t.request));
  if (!items.length) out.appendChild(el('div', 'empty', 'No tickets.'));
  items.forEach((t) => out.appendChild(ticketRow(t)));
}

function renderStale(out, ix) {
  out.appendChild(el('h2', null, 'Requests'));
  renderRequests(out, ix, true);
  out.appendChild(el('h2', null, 'Tickets (abandoned?)'));
  renderTickets(out, ix, true);
}

function renderSessions(out, ix) {
  const items = ix.sessions.filter((s) => repoOk(s.repo || '') && matches(s.title, s.repo, s.cwd, s.branch));
  if (!items.length) out.appendChild(el('div', 'empty', 'No sessions.'));
  for (const s of items) {
    const c = card(s.title || '(untitled)', `${s.repo || 'no repo'} - ${ago(s.lastActivity)}`);
    row(c, s.branch ? chip(s.branch) : null, chip(Math.round(s.sizeBytes / 1024) + ' KB'));
    row(c, pathBtn(s.cwd));
    out.appendChild(c);
  }
}

function renderSettings(out, ix) {
  const s = ix.settings;
  const list = (title, items, src) => {
    const c = card(title, 'source: ' + src);
    if (!items.length) c.appendChild(el('div', 'sub', '(none)'));
    items.forEach((v) => row(c, pathBtn(v)));
    out.appendChild(c);
  };
  list('Scanned roots', s.roots, s.sources.roots);
  list('Excluded patterns', s.exclude, s.sources.exclude);
  const how = card('How to change this', 'Read-only here. Changes apply on the next refresh; host and port need a restart.');
  how.appendChild(el('div', 'sub', '1. Edit config.local.json in the repo root (keys roots and exclude).'));
  how.appendChild(el('div', 'sub', '2. Or set the DASHBOARD_ROOTS environment variable, folders separated by ;'));
  how.appendChild(el('div', 'sub', '3. Or start with --roots "<a>;<b>". Precedence: --roots, DASHBOARD_ROOTS, config.local.json, config.json.'));
  out.appendChild(how);
}

const RENDERERS = {
  settings: renderSettings,
  needs: renderInbox,
  requests: (o, i) => renderRequests(o, i, false),
  tickets: (o, i) => renderTickets(o, i, false),
  stale: renderStale,
  sessions: renderSessions,
};

function count(ix, id) {
  if (id === 'needs') return ix.inbox.length;
  if (id === 'requests') return ix.requests.length;
  if (id === 'tickets') return ix.tickets.length;
  if (id === 'stale') return ix.requests.filter((r) => r.stale).length + ix.tickets.filter((t) => t.stale).length;
  if (id === 'settings') return ix.settings.roots.length;
  return ix.sessions.length;
}
function renderTabs(ix) {
  const nav = $('tabs');
  nav.replaceChildren();
  for (const [id, label] of TABS) {
    const b = el('button', null, `${label} (${count(ix, id)})`);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.tab === id));
    b.addEventListener('click', () => { state.tab = id; render(); });
    nav.appendChild(b);
  }
}

function render() {
  const view = $('view');
  view.replaceChildren();
  const ix = state.index;
  $('generated').textContent = ix ? 'Generated ' + ago(ix.generatedAt) + ' (' + ix.scanMs + ' ms)' : (state.error || 'loading...');
  const ec = $('errors');
  ec.textContent = ix ? ix.errors.length + ' errors' : '';
  ec.className = 'chip' + (ix && ix.errors.length ? ' bad' : '');
  ec.title = ix ? ix.errors.slice(0, 10).map((e) => e.file + ': ' + e.message).join('\n') : '';
  if (!ix) return;
  if (state.error) view.appendChild(el('div', 'card', 'Refresh failed: ' + state.error));
  const sel = $('repo');
  const repos = ix.repos.map((r) => r.repo).sort();
  if (sel.options.length !== repos.length + 1) {
    sel.replaceChildren(new Option('All repos', ''), ...repos.map((r) => new Option(r, r)));
    sel.value = state.repo;
  }
  renderTabs(ix);
  RENDERERS[state.tab](view, ix);
}

async function load(refresh) {
  try {
    const res = await fetch('/api/index' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.index = await res.json();
    state.error = null;
  } catch (e) {
    state.error = String(e.message || e);
  }
  render();
}

$('repo').addEventListener('change', (e) => { state.repo = e.target.value; render(); });
$('search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('refresh').addEventListener('click', () => load(true));
load(false);
setInterval(() => load(false), 20000);
