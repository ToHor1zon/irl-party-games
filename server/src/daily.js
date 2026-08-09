import { db } from './db.js';
import { fnv1a } from './content.js';
import { getConfig } from './config.js';

const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? 8);

// Из пула берём два задания: третье у каждого игрока своё, из чужих слов.
export const POOL_ITEMS_PER_DAY = 2;
export const PERSONAL_ITEM_IDX = POOL_ITEMS_PER_DAY;

// Игровая дата YYYY-MM-DD по времени Китая (UTC+8 по умолчанию).
export function gameDate(ts = Date.now()) {
  return new Date(ts + TZ_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

// Задания дня — детерминированно из хеша даты, коллизии разрешаются
// линейным сдвигом по пулу.
function pickHuntItems(date, pool) {
  const n = Math.min(POOL_ITEMS_PER_DAY, pool.length);
  const used = new Set();
  for (let i = 0; used.size < n; i++) {
    let idx = fnv1a(`${date}:hunt:${i}`) % pool.length;
    while (used.has(idx)) idx = (idx + 1) % pool.length;
    used.add(idx);
  }
  return [...used].map((idx) => pool[idx]);
}

// Гарантирует строку дня: задания фиксируются при первом обращении, чтобы
// правки пула в админке не меняли их на лету.
export function ensureDay(date) {
  const cfg = getConfig();
  let day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  if (!day) {
    db.prepare('INSERT OR IGNORE INTO days (date, hunt_items) VALUES (?, ?)')
      .run(date, JSON.stringify(pickHuntItems(date, cfg.hunt.items)));
    day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  }
  if (!day.hunt_items) {
    db.prepare('UPDATE days SET hunt_items = ? WHERE date = ? AND hunt_items IS NULL')
      .run(JSON.stringify(pickHuntItems(date, cfg.hunt.items)), date);
    day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  }
  return day;
}

// Дни, выданные до перехода на два задания, хранят три — лишнее отсекаем
// на чтении, чтобы не переписывать уже сыгранные дни.
export function poolItemsOf(day) {
  try {
    return JSON.parse(day.hunt_items ?? '[]').slice(0, POOL_ITEMS_PER_DAY);
  } catch {
    return [];
  }
}
