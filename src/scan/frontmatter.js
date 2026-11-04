// Flat front-matter subset: `key: value` lines, scalars and `[a, b]` lists. No YAML library.

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseValue(raw) {
  const t = raw.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map(unquote).filter((x) => x !== '');
  }
  return unquote(t);
}

/**
 * Split a markdown file into front matter and body.
 * Returns { data, body, error }. `data` is null when the file has no front matter;
 * on a malformed block `data` holds the lines that did parse and `error` says what was wrong.
 */
export function parseFrontMatter(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!src.startsWith('---\n')) return { data: null, body: src, error: null };
  const lines = src.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') { end = i; break; }
  }
  if (end === -1) return { data: null, body: src, error: 'front matter is not closed with ---' };
  const data = {};
  let error = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) { error ??= `front matter line ${i + 1} is not "key: value": ${line.slice(0, 60)}`; continue; }
    data[m[1]] = parseValue(m[2]);
  }
  return { data, body: lines.slice(end + 1).join('\n'), error };
}
