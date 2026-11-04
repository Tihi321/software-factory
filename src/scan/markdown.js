// Small markdown helpers: sections, tables, checkboxes, dated log lines.

export function sections(body) {
  const out = {};
  let cur = null;
  for (const line of body.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { cur = m[1].toLowerCase(); out[cur] = []; continue; }
    if (cur) out[cur].push(line);
  }
  return out;
}

function cells(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

/** Parse a pipe table into rows keyed by lower-cased header text. */
export function parseTable(lines) {
  const rows = lines.filter((l) => l.trim().startsWith('|'));
  if (rows.length < 2) return [];
  const head = cells(rows[0]).map((h) => h.toLowerCase());
  const out = [];
  for (const r of rows.slice(1)) {
    const c = cells(r);
    if (c.every((x) => /^:?-{2,}:?$/.test(x) || x === '')) continue;
    const row = {};
    head.forEach((h, i) => { row[h] = c[i] ?? null; });
    out.push(row);
  }
  return out;
}

export function countCheckboxes(text) {
  let done = 0;
  let open = 0;
  for (const line of text.split('\n')) {
    const m = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]/.exec(line);
    if (!m) continue;
    if (m[1] === ' ') open++; else done++;
  }
  return { done, open };
}

/** Local date (YYYY-MM-DD) and optional HH:MM to a UTC ISO string, or null. */
export function localToIso(date, time) {
  if (!date) return null;
  const d = new Date(`${date}T${time && /^\d{2}:\d{2}$/.test(time) ? time : '00:00'}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lines of a section that start with "- <date> [time] text" -> [{ ts, text }]. */
export function parseLog(lines) {
  const out = [];
  for (const line of lines) {
    const m = /^-\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}|--:--))?\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const text = m[3].replace(/^\((?:time not given|no time)\)\s*/i, '');
    out.push({ ts: localToIso(m[1], m[2]), text });
  }
  return out;
}

export function maxIso(...values) {
  let best = null;
  for (const v of values) {
    const t = v ? Date.parse(v) : NaN;
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}
