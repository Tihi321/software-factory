import { maxIso } from './markdown.js';

const DAY = 86400000;

export function idleDays(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

export function requestStale(req, now, config) {
  const d = idleDays(req.lastActivity, now);
  if (d === null || d <= config.staleDays) return { stale: false, staleReason: null };
  if (req.status === 'waiting-on-user') return { stale: true, staleReason: `waiting ${d} days` };
  if (req.status === 'open' || req.status === 'in-progress') return { stale: true, staleReason: `idle ${d} days` };
  return { stale: false, staleReason: null };
}

export function ticketStale(t, now, config) {
  const d = idleDays(t.lastActivity, now);
  if (d !== null && d > config.abandonDays && t.status !== 'done' && t.status !== 'dropped') {
    return { stale: true, staleReason: `no activity for ${d} days (abandoned?)` };
  }
  return { stale: false, staleReason: null };
}

const cell = (s) => String(s ?? '-').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '-';

/** Markdown table of stale requests. Pure: reads the index only. */
export function sweepReport(index) {
  const now = new Date(index.generatedAt);
  const stale = index.requests.filter((r) => r.stale);
  const out = [`# Stale requests (${stale.length})`, '', `Generated ${index.generatedAt}. Report only: nothing is closed or edited.`, ''];
  if (stale.length === 0) return `${out.join('\n')}No stale requests.\n`;
  out.push('| repo | id | title | status | updated | days idle | last Log line | linked-ticket activity | action |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of stale) {
    const last = r.logTail.at(-1);
    const linked = index.tickets.filter((t) => t.request === r.key);
    const linkedAct = maxIso(...linked.map((t) => t.lastActivity));
    out.push(`| ${[r.repo, r.id, r.title, r.status, r.updated,
      idleDays(r.lastActivity, now), last ? `${(last.ts ?? '').slice(0, 10)} ${last.text}`.trim() : null,
      linkedAct ? linkedAct.slice(0, 10) : null, 'close or resume?'].map(cell).join(' | ')} |`);
  }
  return `${out.join('\n')}\n`;
}
