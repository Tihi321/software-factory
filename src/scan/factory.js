import { readText } from './discover.js';

function s(v) { return v == null || v === '' ? null : String(v); }

export async function scanFactory(repo) {
  const file = `${repo.path}/factory/board.json`;
  const text = await readText(file);
  if (text === null) return { factory: [], errors: [] };
  let board;
  try { board = JSON.parse(text); } catch (e) { return { factory: [], errors: [{ file, message: `invalid JSON: ${e.message}` }] }; }
  const list = Array.isArray(board) ? board : Array.isArray(board?.jobs) ? board.jobs : [];
  const jobs = list.filter((j) => j && typeof j === 'object').map((j) => ({
    id: s(j.id), title: s(j.title), branch: s(j.branch), stage: s(j.stage),
    round: typeof j.round === 'number' ? j.round : null,
    decision: s(j.decision), note: s(j.note), updated: s(j.updated),
  }));
  return { factory: [{ repo: repo.repo, file, jobs }], errors: [] };
}
