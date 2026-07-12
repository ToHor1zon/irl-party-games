import { db } from './db.js';
import { getConfig } from './config.js';

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

  for (const r of db.prepare("SELECT user_id FROM word_statuses WHERE status = 'done'").all())
    add(r.user_id, cfg.word.points);

  for (const r of db.prepare(`
    SELECT imposter_user_id AS id FROM days
    WHERE closed = 1 AND imposter_caught = 0 AND imposter_user_id IS NOT NULL
  `).all()) add(r.id, cfg.imposter.survivePoints);

  for (const r of db.prepare(`
    SELECT iv.voter_id AS id FROM imposter_votes iv
    JOIN days d ON d.date = iv.date
    WHERE d.closed = 1 AND iv.target_user_id = d.imposter_user_id
  `).all()) add(r.id, cfg.imposter.guessPoints);

  for (const r of db.prepare('SELECT n, user_id FROM chain_entries').all())
    add(r.user_id, Math.min(r.n, cfg.chain.maxPoints));

  return users
    .map((u) => ({ id: u.id, name: u.name, score: scores.get(u.id) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
}
