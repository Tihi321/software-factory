#!/usr/bin/env node
import * as fsp from 'node:fs/promises';
import { loadConfig, parseRoots, scanAll, sweepReport } from './scan/index.js';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  if (cmd !== 'scan' && cmd !== 'sweep') {
    console.error('usage: node src/cli.js scan [--out <path>] [--stats] [--config <path>] [--roots "<a>;<b>"]\n       node src/cli.js sweep [--config <path>]');
    process.exit(2);
  }
  const config = await loadConfig(value('--config'), { roots: parseRoots(value('--roots')) });
  const index = await scanAll(config);
  if (cmd === 'sweep') { process.stdout.write(sweepReport(index)); return; }
  if (flag('--stats')) {
    const open = index.inbox.length;
    console.log(JSON.stringify({ scanMs: index.scanMs, repos: index.repos.length, requests: index.requests.length,
      tickets: index.tickets.length, factoryBoards: index.factory.length, sessions: index.sessions.length,
      inbox: open, staleRequests: index.requests.filter((r) => r.stale).length,
      staleTickets: index.tickets.filter((t) => t.stale).length, errors: index.errors.length }, null, 2));
    for (const e of index.errors.slice(0, 10)) console.log(`error: ${e.file}: ${e.message}`);
  }
  const out = value('--out');
  if (out) await fsp.writeFile(out, JSON.stringify(index, null, 2)); // the only write in src/
  else if (!flag('--stats')) console.log(JSON.stringify(index, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
