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

  // Фотоохота: автор получает ровно то, что ему наставили зрители.
  for (const r of db.prepare('SELECT photo_user_id, SUM(score) AS pts FROM hunt_votes GROUP BY photo_user_id').all())
    add(r.photo_user_id, r.pts);

  // «Угар»: приз за день получает каждый, кто набрал максимум — ничья
  // не делит бонус, а раздаёт его всем лидерам.
  const funnyByDay = db.prepare(`
    SELECT date, photo_user_id, SUM(funny) AS c FROM hunt_votes
    GROUP BY date, photo_user_id HAVING c > 0
  `).all();
  const maxByDay = new Map();
  for (const r of funnyByDay) maxByDay.set(r.date, Math.max(maxByDay.get(r.date) ?? 0, r.c));
  for (const r of funnyByDay) {
    if (r.c === maxByDay.get(r.date)) add(r.photo_user_id, cfg.hunt.funnyBonus);
  }

  // «Слабо»: цена берётся по тиру, а тир зашит в префикс dare_id — поэтому
  // правки пулов в админке не ломают уже начисленное.
  const darePoints = {
    food: cfg.dares.foodPoints,
    courage: cfg.dares.couragePoints,
    extreme: cfg.dares.extremePoints,
  };
  for (const r of db.prepare('SELECT user_id, dare_id FROM dare_photos').all())
    add(r.user_id, darePoints[r.dare_id.split(':')[0]] ?? 0);

  for (const r of db.prepare('SELECT user_id, marks FROM bingo_cards').all()) {
    try { add(r.user_id, cardScore(JSON.parse(r.marks), cfg.bingo)); } catch { /* битая строка не валит топ */ }
  }

  return users
    .map((u) => ({ id: u.id, name: u.name, score: scores.get(u.id) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
}
