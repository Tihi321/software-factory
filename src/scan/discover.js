import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';

/** Absolute path with forward slashes, no trailing slash (except a drive root). */
export function toPosix(p) {
  let s = String(p).replaceAll('\\', '/');
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Glob to case-insensitive RegExp over forward-slash paths: * is one segment, ** is anything. */
export function globToRegExp(glob) {
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = toPosix(glob).split('**').map((part) => part.split('*').map(esc).join('[^/]*')).join('.*');
  return new RegExp(`^${body}$`, 'i');
}

function rootName(root) {
  return root.split('/').filter(Boolean).pop() || root;
}

export function expandHome(p) {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return toPosix(homedir()) + p.slice(1).replaceAll('\\', '/');
  return toPosix(p);
}

export async function readText(file) {
  try { return await readFile(file, 'utf8'); } catch { return null; }
}

export async function statOrNull(file) {
  try { return await stat(file); } catch { return null; }
}

async function isRepo(dir) {
  const marks = ['.git', '.claude/tickets', '.claude/director', '.codex/tickets', 'factory/board.json'];
  const hits = await Promise.all(marks.map((m) => statOrNull(`${dir}/${m}`)));
  return hits.some(Boolean);
}

/**
 * Walk each root down to maxDepth. A directory that is a repo is recorded and not entered.
 * node_modules, dot-dirs (so .git, .claude/worktrees) are skipped. Roots themselves are not repos.
 * Returns [{ repo (path relative to its root), path, root }] sorted by repo.
 */
export async function discoverRepos(roots, maxDepth, exclude = []) {
  const found = [];
  const excluders = exclude.map(globToRegExp);
  const prefixKeys = roots.length > 1;
  const isExcluded = (rel, abs) => excluders.some((re) => re.test(rel) || re.test(abs));
  async function walk(dir, root, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    const subs = entries.filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'));
    await Promise.all(subs.map(async (e) => {
      const p = `${dir}/${e.name}`;
      if (await isRepo(p)) {
        const rel = p.slice(root.length + 1);
        if (isExcluded(rel, p)) return;
        found.push({ repo: prefixKeys ? `${rootName(root)}/${rel}` : rel, path: p, root });
      } else if (depth + 1 < maxDepth) {
        await walk(p, root, depth + 1);
      }
    }));
  }
  for (const r of roots) await walk(r, r, 0);
  return found.sort((a, b) => a.repo.localeCompare(b.repo));
}
