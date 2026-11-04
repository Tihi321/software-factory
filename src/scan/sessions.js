import { open, readdir, stat } from 'node:fs/promises';
import { toPosix } from './discover.js';

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
const UNMATCHED_KEEP = 10;

async function readWindow(fh, size, from, len) {
  const n = Math.min(len, size - from);
  const buf = Buffer.alloc(n);
  await fh.read(buf, 0, n, from);
  return buf.toString('utf8');
}

/**
 * Privacy: only `cwd`, `gitBranch`, `custom-title` and `agent-name` are ever read out of a session
 * file, and only from the first 64 KB and last 256 KB. No other record is parsed.
 */
async function inspect(file, size) {
  const fh = await open(file, 'r');
  try {
    let cwd = null;
    let branch = null;
    const headLines = (await readWindow(fh, size, 0, HEAD_BYTES)).split('\n');
    if (size > HEAD_BYTES) headLines.pop(); // partial last line
    for (const line of headLines) {
      if (!line.includes('"cwd"')) continue;
      try {
        const o = JSON.parse(line);
        if (typeof o.cwd === 'string' && cwd === null) cwd = toPosix(o.cwd);
        if (typeof o.gitBranch === 'string' && branch === null) branch = o.gitBranch;
        if (cwd !== null && branch !== null) break;
      } catch { /* skip */ }
    }
    const from = Math.max(0, size - TAIL_BYTES);
    const tailLines = (await readWindow(fh, size, from, TAIL_BYTES)).split('\n');
    if (from > 0) tailLines.shift(); // partial first line
    let custom = null;
    let agent = null;
    for (const line of tailLines) {
      const isCustom = line.includes('"type":"custom-title"');
      if (!isCustom && !line.includes('"type":"agent-name"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'custom-title' && typeof o.customTitle === 'string') custom = o.customTitle;
        else if (o.type === 'agent-name' && typeof o.agentName === 'string') agent = o.agentName;
      } catch { /* partial line */ }
    }
    return { cwd, branch, title: custom ?? agent };
  } finally { await fh.close(); }
}

export async function scanSessions(config, sessionsDir, repos) {
  const errors = [];
  let folders;
  try { folders = await readdir(sessionsDir, { withFileTypes: true }); } catch { return { sessions: [], counts: new Map(), errors }; }
  const files = [];
  await Promise.all(folders.filter((d) => d.isDirectory()).map(async (d) => {
    let names;
    try { names = await readdir(`${sessionsDir}/${d.name}`); } catch { return; }
    await Promise.all(names.filter((n) => n.endsWith('.jsonl')).map(async (n) => {
      const file = `${sessionsDir}/${d.name}/${n}`;
      try { const st = await stat(file); files.push({ file, id: n.slice(0, -6), size: st.size, mtime: st.mtimeMs }); } catch { /* gone */ }
    }));
  }));
  files.sort((a, b) => b.mtime - a.mtime);

  const lowered = repos.map((r) => ({ repo: r.repo, lp: r.path.toLowerCase() }));
  const matchRepo = (cwd) => {
    if (!cwd) return null;
    const c = cwd.toLowerCase();
    let best = null;
    for (const r of lowered) {
      if ((c === r.lp || c.startsWith(`${r.lp}/`)) && (!best || r.lp.length > best.lp.length)) best = r;
    }
    return best?.repo ?? null;
  };

  const kept = new Map();
  const counts = new Map();
  const sessions = [];
  let unmatched = 0;
  const infos = await Promise.all(files.map(async (f) => {
    try { return await inspect(f.file, f.size); } catch (e) { errors.push({ file: f.file, message: String(e.message ?? e) }); return null; }
  }));
  files.forEach((f, i) => {
    const info = infos[i];
    if (!info) return;
    const repo = matchRepo(info.cwd);
    if (repo !== null) counts.set(repo, (counts.get(repo) ?? 0) + 1);
    const n = repo === null ? unmatched : (kept.get(repo) ?? 0);
    if (repo === null ? n >= UNMATCHED_KEEP : n >= config.sessionsPerRepo) return;
    if (repo === null) unmatched++; else kept.set(repo, n + 1);
    sessions.push({ id: f.id, repo, cwd: info.cwd, title: info.title, branch: info.branch,
      lastActivity: new Date(f.mtime).toISOString(), sizeBytes: f.size });
  });
  return { sessions, counts, errors };
}
