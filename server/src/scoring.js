import { db } from './db.js';
import { getConfig } from './config.js';
import { cardScore } from './bingo.js';

// Очки считаются на лету из исходных таблиц — без леджера.
// Стоимость каждого действия берётся из конфига админки, поэтому смена очков
// пересчитывает в том числе прошлые дни.
export function leaderboard() {
  const cfg = getConfig();
  const users = db.prepare('SELECT id, name FROM users').all();
  const scores = new Map(users.map((u) => [u.id, 0]));
  const add = (id, pts) => scores.has(id) && scores.set(id, scores.get(id) + pts);

  for (const r of db.prepare('SELECT user_id FROM photos').all())
    add(r.user_id, cfg.photo.submitPoints);

  for (const r of db.prepare('SELECT photo_user_id FROM photo_votes').all())
    add(r.photo_user_id, cfg.photo.votePoints);

  for (const r of db.prepare('SELECT n, user_id FROM chain_entries').all())
    add(r.user_id, Math.min(r.n, cfg.chain.maxPoints));

  for (const r of db.prepare('SELECT user_id, COUNT(*) AS c FROM hunt_photos GROUP BY user_id').all())
    add(r.user_id, r.c * cfg.hunt.itemPoints);

  for (const r of db.prepare('SELECT user_id, marks FROM bingo_cards').all()) {
    try { add(r.user_id, cardScore(JSON.parse(r.marks), cfg.bingo)); } catch { /* битая строка не валит топ */ }
  }

  return users
    .map((u) => ({ id: u.id, name: u.name, score: scores.get(u.id) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
}
