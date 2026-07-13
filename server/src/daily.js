import { db } from './db.js';
import { fnv1a } from './content.js';
import { getConfig } from './config.js';

const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? 8);
const HUNT_ITEMS_PER_DAY = 3;

// Игровая дата YYYY-MM-DD по времени Китая (UTC+8 по умолчанию).
export function gameDate(ts = Date.now()) {
  return new Date(ts + TZ_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

// 3 разные цели охоты на день — детерминированно из хеша даты,
// коллизии разрешаются линейным сдвигом по пулу.
function pickHuntItems(date, pool) {
  const n = Math.min(HUNT_ITEMS_PER_DAY, pool.length);
  const used = new Set();
  for (let i = 0; used.size < n; i++) {
    let idx = fnv1a(`${date}:hunt:${i}`) % pool.length;
    while (used.has(idx)) idx = (idx + 1) % pool.length;
    used.add(idx);
  }
  return [...used].map((idx) => pool[idx]);
}

// Гарантирует строку дня: миссия и цели охоты выбираются из хеша даты
// и фиксируются, чтобы правки пулов в админке не меняли задания на лету.
export function ensureDay(date) {
  const cfg = getConfig();
  let day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  if (!day) {
    db.prepare('INSERT OR IGNORE INTO days (date, mission_idx, hunt_items) VALUES (?, ?, ?)')
      .run(
        date,
        fnv1a(`${date}:mission`) % cfg.photo.missions.length,
        JSON.stringify(pickHuntItems(date, cfg.hunt.items)),
      );
    day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  }
  if (!day.hunt_items) {
    // день выдан до появления охоты — дозаполняем цели
    db.prepare('UPDATE days SET hunt_items = ? WHERE date = ? AND hunt_items IS NULL')
      .run(JSON.stringify(pickHuntItems(date, cfg.hunt.items)), date);
    day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  }
  return day;
}
