import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, scanAll, sweepReport } from '../src/scan/index.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const NOW = new Date('2026-11-04T12:00:00Z');
let index;
let tmp;

before(async () => {
  // The session fixture holds a __ROOT__ placeholder; fill it into a temp copy (the scanner never writes).
  tmp = await mkdtemp(`${tmpdir()}/sf-scan-`);
  await cp(`${FIX}/sessions`, tmp, { recursive: true });
  const f = `${tmp}/C--x/11111111-1111-1111-1111-111111111111.jsonl`;
  const text = (await readFile(f, 'utf8')).replaceAll('__ROOT__', `${FIX}/projects`);
  await writeFile(f, text);
  const config = { ...(await loadConfig()), roots: [`${FIX}/projects`], sessionsDir: tmp };
  index = await scanAll(config, { now: NOW });
});
after(() => rm(tmp, { recursive: true, force: true }));

const req = (key) => index.requests.find((r) => r.key === key);
const tic = (key) => index.tickets.find((t) => t.key === key);

test('requests: front matter, pieces, log tail; malformed front matter goes to errors and the scan continues', () => {
  const r = req('Grp/new-style#REQ-0001');
  assert.equal(r.status, 'waiting-on-user');
  assert.equal(r.title, 'Waiting request');
  assert.equal(r.pieces.length, 2);
  assert.deepEqual(r.pieces[1], { n: '2', piece: 'implement', role: 'implement department', tier: 'standard',
    effort: null, agent: 'agent-1', status: 'running' });
  assert.equal(req('Grp/new-style#REQ-0002').logTail.length, 5);
  assert.equal(req('Grp/new-style#REQ-0002').logTail.at(-1).text, 'last line here');

  const bad = req('Grp/old-style#REQ-0002');
  assert.ok(bad, 'malformed request is still listed');
  assert.equal(bad.status, 'open');
  assert.ok(index.errors.some((e) => e.file.endsWith('REQ-0002-malformed.md')));
  assert.equal(bad.warnings.length, 1);
  assert.ok(req('Grp/old-style#REQ-0001'), 'scan continued past the bad file');
});

test('tickets: front matter wins; old plans derive status; .codex tickets included; requests linked', () => {
  const n = tic('Grp/new-style#NEW-01-feature');
  assert.equal(n.status, 'in-progress');
  assert.equal(n.statusSource, 'front-matter');
  assert.deepEqual(n.front.repos, ['new-style', 'other']);
  assert.equal(n.request, 'Grp/new-style#REQ-0001');
  assert.equal(n.discoveries, 2);
  assert.deepEqual(n.checkbox, { done: 1, open: 1 });
  assert.equal(n.events.last.type, 'attention.opened');
  assert.deepEqual(n.events.recent.map((e) => e.type), ['attention.opened', 'implement.started']);

  const line = tic('Grp/old-style#OLD-01-status-line');
  assert.deepEqual([line.status, line.statusSource], ['done', 'status-line']);
  assert.match(line.statusRaw, /^implemented/);
  assert.equal(line.request, 'Grp/old-style#REQ-0001'); // via the request's links
  const log = tic('Grp/old-style#OLD-02-changelog-only');
  assert.deepEqual([log.status, log.statusSource, log.files.changelog], ['implemented', 'changelog', true]);
  const codex = tic('Grp/old-style#codex:x');
  assert.deepEqual([codex.harness, codex.status, codex.statusSource], ['codex', 'in-progress', 'checkboxes']);
});

test('inbox: attention, unlinked waiting request and needs-human job appear; answered item and request covered by an open attention do not', () => {
  const kinds = index.inbox.map((i) => `${i.kind}:${i.key}`);
  assert.deepEqual(kinds.sort(), [
    'attention:Grp/new-style#NEW-01-feature/A-001',
    'factory:Grp/fact#factory/001-a',
    'request:Grp/new-style#REQ-0003',
  ]);
  const sinces = index.inbox.map((i) => i.since);
  assert.deepEqual(sinces, [...sinces].sort(), 'oldest first');
});

test('stale: idle in-progress request is flagged at a fixed now, done request is not, sweep lists it', () => {
  const idle = req('Grp/new-style#REQ-0002');
  assert.equal(idle.stale, true);
  assert.match(idle.staleReason, /idle 10 days/);
  assert.equal(req('Grp/old-style#REQ-0001').stale, false);
  const md = sweepReport(index);
  assert.match(md, /REQ-0002/);
  assert.match(md, /Idle in-progress request/);
  assert.doesNotMatch(md, /Done request/);
});

test('sessions and privacy: title and repo matched, no message bodies in the index, bad event lines counted', () => {
  assert.equal(index.sessions.length, 1);
  const s = index.sessions[0];
  assert.deepEqual([s.repo, s.title, s.branch], ['Grp/new-style', 'Fixture title', 'NEW-01_feature']);
  assert.equal(JSON.stringify(index).includes('SECRET-BODY'), false);
  assert.equal(tic('Grp/new-style#NEW-01-feature').events.badLines, 1);
  assert.equal(tic('Grp/new-style#NEW-01-feature').events.count, 2);
  assert.equal(index.repos.find((r) => r.repo === 'Grp/new-style').sessionCount, 1);
});

test('index shape: three repos discovered and every C3 key present, unknowns are null', () => {
  assert.deepEqual(index.repos.map((r) => r.repo), ['Grp/fact', 'Grp/new-style', 'Grp/old-style']);
  assert.equal(index.version, 1);
  for (const k of ['generatedAt', 'scanMs', 'roots', 'repos', 'requests', 'tickets', 'factory', 'sessions', 'inbox', 'errors']) {
    assert.ok(k in index, k);
  }
  const reqKeys = ['key', 'repo', 'id', 'title', 'status', 'path', 'created', 'updated', 'file', 'links', 'pieces',
    'logTail', 'lastActivity', 'stale', 'staleReason', 'warnings'];
  for (const r of index.requests) assert.deepEqual(Object.keys(r), reqKeys);
  const tKeys = ['key', 'repo', 'name', 'dir', 'harness', 'front', 'status', 'statusSource', 'statusRaw', 'checkbox',
    'files', 'request', 'attention', 'events', 'discoveries', 'lastActivity', 'stale', 'staleReason'];
  for (const t of index.tickets) assert.deepEqual(Object.keys(t), tKeys);
  assert.equal(tic('Grp/old-style#OLD-02-changelog-only').front, null);
  assert.equal(index.factory[0].jobs[0].stage, 'needs-human');
});
