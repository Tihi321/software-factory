import { readdir } from 'node:fs/promises';
import { parseFrontMatter } from './frontmatter.js';
import { sections, parseTable, parseLog, maxIso } from './markdown.js';
import { readText } from './discover.js';

const PIECE_COLS = { n: ['#'], piece: ['piece'], role: ['role / department', 'role', 'department'],
  tier: ['tier'], effort: ['effort'], agent: ['agent or session id', 'agent'], status: ['status'] };

function pick(row, names) {
  for (const n of names) {
    const v = row[n];
    if (v != null && v !== '' && v !== '-') return v;
  }
  return null;
}

function str(v) { return typeof v === 'string' && v !== '' ? v : null; }

/** Parse one request file. Returns { request, errors }. */
export function parseRequest(repo, file, text, fileName) {
  const errors = [];
  const { data, body, error } = parseFrontMatter(text);
  const warnings = [];
  if (error) { errors.push({ file, message: error }); warnings.push(error); }
  const fm = data ?? {};
  const idFromName = /^(REQ-\d+)/i.exec(fileName)?.[1]?.toUpperCase() ?? null;
  const id = str(fm.id) ?? idFromName ?? fileName.replace(/\.md$/, '');
  const heading = /^#\s+(.+)$/m.exec(body)?.[1] ?? null;
  const sec = sections(body);
  const pieces = parseTable(sec.pieces ?? []).map((r) => {
    const o = {};
    for (const [k, names] of Object.entries(PIECE_COLS)) o[k] = pick(r, names);
    return o;
  });
  const log = parseLog(sec.log ?? []);
  const links = Array.isArray(fm.links) ? fm.links : (str(fm.links) ? [fm.links] : []);
  const updated = str(fm.updated);
  const request = {
    key: `${repo.repo}#${id}`, repo: repo.repo, id,
    title: str(fm.title) ?? heading ?? fileName.replace(/\.md$/, ''),
    status: str(fm.status)?.toLowerCase() ?? null,
    path: file, created: str(fm.created), updated, file: fileName,
    links, pieces,
    logTail: log.slice(-5),
    lastActivity: maxIso(updated, log.at(-1)?.ts), // linked tickets are folded in by the index
    stale: false, staleReason: null, warnings,
  };
  return { request, errors };
}

export async function scanRequests(repo) {
  const dir = `${repo.path}/.claude/director/requests`;
  let names;
  try { names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort(); } catch { return { requests: [], errors: [] }; }
  const requests = [];
  const errors = [];
  await Promise.all(names.map(async (name) => {
    const file = `${dir}/${name}`;
    const text = await readText(file);
    if (text === null) { errors.push({ file, message: 'could not read file' }); return; }
    try {
      const r = parseRequest(repo, file, text, name);
      requests.push(r.request);
      errors.push(...r.errors);
    } catch (e) { errors.push({ file, message: String(e.message ?? e) }); }
  }));
  requests.sort((a, b) => a.file.localeCompare(b.file));
  return { requests, errors };
}
