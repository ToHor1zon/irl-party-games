import { db } from './db.js';
import { fnv1a } from './content.js';
import { getConfig } from './config.js';

const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? 8);

// Игровая дата YYYY-MM-DD по времени Китая (UTC+8 по умолчанию).
export function gameDate(ts = Date.now()) {
  return new Date(ts + TZ_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

// Тайное слово игрока на день: детерминированно из даты и id, пул — из конфига.
export function secretWordFor(date, userId) {
  const words = getConfig().word.words;
  return words[fnv1a(`${date}:word:${userId}`) % words.length];
}

// Гарантирует строку дня; импостер назначается лениво, когда игроков достаточно.
export function ensureDay(date) {
  const cfg = getConfig();
  let day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  if (!day) {
    db.prepare('INSERT OR IGNORE INTO days (date, mission_idx, imposter_word_idx) VALUES (?, ?, ?)')
      .run(
        date,
        fnv1a(`${date}:mission`) % cfg.photo.missions.length,
        fnv1a(`${date}:imposter-word`) % cfg.imposter.words.length,
      );
    day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  }
  if (cfg.imposter.enabled && day.imposter_user_id == null && !day.closed) {
    const players = db.prepare('SELECT id FROM users ORDER BY id').all();
    if (players.length >= cfg.imposter.minPlayers) {
      const pick = players[fnv1a(`${date}:imposter`) % players.length].id;
      db.prepare('UPDATE days SET imposter_user_id = ? WHERE date = ? AND imposter_user_id IS NULL')
        .run(pick, date);
      day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
    }
  }
  return day;
}

// Импостер пойман, если у него единоличное большинство голосов.
function imposterCaught(day) {
  if (day.imposter_user_id == null) return null;
  const tally = db.prepare(`
    SELECT target_user_id, COUNT(*) AS votes
    FROM imposter_votes WHERE date = ?
    GROUP BY target_user_id ORDER BY votes DESC
  `).all(day.date);
  if (tally.length === 0) return 0;
  const top = tally[0];
  const soleTop = top.target_user_id === day.imposter_user_id
    && (tally.length === 1 || top.votes > tally[1].votes);
  return soleTop ? 1 : 0;
}

// Закрывает все прошедшие незакрытые дни (вызов при запросах + фоном раз в 10 минут).
export function closePastDays() {
  const today = gameDate();
  const open = db.prepare('SELECT * FROM days WHERE closed = 0 AND date < ?').all(today);
  const close = db.prepare('UPDATE days SET closed = 1, imposter_caught = ? WHERE date = ?');
  for (const day of open) close.run(imposterCaught(day), day.date);
  return open.length;
}
