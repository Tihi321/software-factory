import { readdir, stat } from 'node:fs/promises';
import { parseFrontMatter } from './frontmatter.js';
import { countCheckboxes, localToIso, maxIso } from './markdown.js';
import { readText } from './discover.js';

const STATUSES = ['draft', 'approved', 'planned', 'in-progress', 'blocked', 'implemented', 'done', 'dropped'];

function str(v) { return typeof v === 'string' && v !== '' ? v : null; }

/** Keyword map for a free-text "Status:" line in an old plan.md. */
export function mapStatusLine(raw) {
  const t = raw.toLowerCase();
  if (/^(plan|not|agreed)\b/.test(t) || /\bnot (yet )?started\b/.test(t)) return 'planned';
  if (/\bin[- ]progress\b/.test(t)) return 'in-progress';
  if (/\b(done|implemented|complete[d]?|merged)\b/.test(t)) return 'done';
  return 'unknown';
}

function statusLine(plan) {
  for (const line of plan.split('\n')) {
    const m = /^\s*(?:[-*]\s*)?\**status\**\s*:\s*\**\s*(.+?)\s*$/i.exec(line);
    if (m) return m[1].replace(/\*+/g, '').trim();
  }
  return null;
}

export function parseAttention(text) {
  const items = [];
  let cur = null;
  let lastKey = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^##\s+(A-\d+)\s*(.*)$/.exec(line);
    if (h) {
      cur = { id: h[1], what: h[2].trim() || null, status: null, asked: null, by: null, why: null,
        options: [], recommendation: null, default: null, answer: null, open: false };
      items.push(cur); lastKey = null; continue;
    }
    if (!cur) continue;
    const opt = /^\s{2,}-\s+(.*)$/.exec(line);
    if (opt && lastKey === 'options') { cur.options.push(opt[1].trim()); continue; }
    const kv = /^-\s+([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      const k = kv[1].toLowerCase();
      const v = kv[2].trim();
      lastKey = k;
      if (k === 'options') { if (v) cur.options.push(v); continue; }
      if (k === 'asked') { const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(v); cur.asked = m ? localToIso(m[1], m[2]) : null; continue; }
      if (k in cur && k !== 'id' && k !== 'what' && k !== 'open') cur[k] = v === '' ? null : v;
    }
  }
  for (const it of items) { it.status = it.status?.toLowerCase() ?? null; it.open = it.status === 'open'; }
  return items;
}

export function parseEvents(text) {
  let count = 0;
  let badLines = 0;
  let last = null;
  const recent = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let o;
    try { o = JSON.parse(line); } catch { badLines++; continue; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) { badLines++; continue; }
    count++;
    last = { ts: str(o.ts), actor: str(o.actor), type: str(o.type), request: str(o.request),
      ticket: str(o.ticket), detail: str(o.detail), data: o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : null };
    recent.push(last);
    if (recent.length > 10) recent.shift();
  }
  return { count, badLines, last, recent: recent.reverse() };
}

async function readTicket(repo, harness, name, dir, errors) {
  const files = { plan: false, changelog: false, handoff: false, research: false, attention: false, events: false, discoveries: false };
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }
  let mtime = null;
  await Promise.all(entries.filter((e) => e.isFile()).map(async (e) => {
    const n = e.name.toLowerCase();
    if (n === 'plan.md') files.plan = true;
    else if (n === 'changelog.md') files.changelog = true;
    else if (n === 'handoff.md') files.handoff = true;
    else if (n.startsWith('research')) files.research = true;
    else if (n === 'attention.md') files.attention = true;
    else if (n === 'events.jsonl') files.events = true;
    else if (n === 'discoveries.md') files.discoveries = true;
    try { mtime = maxIso(mtime, (await stat(`${dir}/${e.name}`)).mtime.toISOString()); } catch { /* vanished */ }
  }));

  const plan = files.plan ? await readText(`${dir}/plan.md`) : null;
  let front = null;
  if (plan !== null) {
    const fm = parseFrontMatter(plan);
    if (fm.error) errors.push({ file: `${dir}/plan.md`, message: fm.error });
    else if (fm.data) {
      front = { status: str(fm.data.status), request: str(fm.data.request),
        repos: Array.isArray(fm.data.repos) ? fm.data.repos : null,
        branch: str(fm.data.branch), updated: str(fm.data.updated) };
    }
  }
  const checkbox = plan ? countCheckboxes(plan) : { done: 0, open: 0 };

  let status = 'unknown';
  let statusSource = 'none';
  let statusRaw = null;
  const fs = front?.status?.toLowerCase();
  const line = plan ? statusLine(plan) : null;
  if (fs) {
    statusSource = 'front-matter';
    if (STATUSES.includes(fs)) status = fs; else statusRaw = front.status;
  } else if (line) {
    statusSource = 'status-line'; statusRaw = line; status = mapStatusLine(line);
  } else if (files.changelog) {
    statusSource = 'changelog';
    status = checkbox.done > 0 && checkbox.open === 0 ? 'done' : 'implemented';
  } else if (checkbox.done > 0) {
    statusSource = 'checkboxes'; status = 'in-progress';
  } else if (files.plan) {
    statusSource = 'none'; status = 'planned';
  }

  let attention = [];
  if (files.attention) {
    const t = await readText(`${dir}/attention.md`);
    if (t !== null) attention = parseAttention(t);
  }
  let events = { count: 0, badLines: 0, last: null, recent: [] };
  if (files.events) {
    const t = await readText(`${dir}/events.jsonl`);
    if (t !== null) events = parseEvents(t);
  }
  let discoveries = 0;
  if (files.discoveries) {
    const t = await readText(`${dir}/discoveries.md`);
    if (t !== null) discoveries = t.split('\n').filter((l) => /^\s*-\s+\S/.test(l)).length;
  }
  return {
    key: `${repo.repo}#${harness === 'codex' ? 'codex:' : ''}${name}`, repo: repo.repo, name, dir, harness,
    front, status, statusSource, statusRaw, checkbox, files,
    request: null, // resolved in the index (front matter or a request's links)
    attention, events, discoveries,
    lastActivity: maxIso(mtime, events.last?.ts),
    stale: false, staleReason: null,
  };
}

export async function scanTickets(repo) {
  const tickets = [];
  const errors = [];
  for (const harness of ['claude', 'codex']) {
    const base = `${repo.path}/.${harness}/tickets`;
    let entries;
    try { entries = await readdir(base, { withFileTypes: true }); } catch { continue; }
    await Promise.all(entries.filter((e) => e.isDirectory()).map(async (e) => {
      try {
        const t = await readTicket(repo, harness, e.name, `${base}/${e.name}`, errors);
        if (t) tickets.push(t);
      } catch (err) { errors.push({ file: `${base}/${e.name}`, message: String(err.message ?? err) }); }
    }));
  }
  tickets.sort((a, b) => a.key.localeCompare(b.key) || a.harness.localeCompare(b.harness));
  return { tickets, errors };
}
