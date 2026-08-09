import { db } from './db.js';
import { BINGO_WORDS, HUNT_ITEMS, DARE_FOOD, DARE_COURAGE, DARE_EXTREME } from './content.js';

// Конфиг игр: дефолты из content.js, переопределения — в таблице config (одна строка JSON).
// Меняется через админку; кэшируется в памяти процесса.
export const DEFAULT_CONFIG = {
  bingo:{ enabled: true, cellPoints: 2, linePoints: 10, cardPoints: 40, words: BINGO_WORDS },
  // Очки за охоту дают только оценки зрителей; funnyBonus — приз за «угар».
  hunt: { enabled: true, funnyBonus: 5, items: HUNT_ITEMS },
  // «Слабо»: цена челленджа растёт с риском, поэтому пулы разнесены по тирам.
  dares: {
    enabled: true,
    foodPoints: 10,
    couragePoints: 15,
    extremePoints: 25,
    food: DARE_FOOD,
    courage: DARE_COURAGE,
    extreme: DARE_EXTREME,
  },
};

let cache = null;

const bool = (v, fb) => (typeof v === 'boolean' ? v : fb);
const num = (v, fb, min = 0) => (Number.isFinite(Number(v)) ? Math.max(min, Math.round(Number(v))) : fb);
const list = (v, fb) => {
  if (!Array.isArray(v)) return fb;
  const items = v.map((s) => String(s).trim()).filter(Boolean).slice(0, 500);
  return items.length > 0 ? items : fb;
};

// Любой вход приводится к валидной форме: кривые значения заменяются дефолтами,
// пустой пул невозможен — выбор дня всегда имеет из чего выбирать.
function normalize(raw) {
  const r = raw ?? {};
  const d = DEFAULT_CONFIG;
  return {
    bingo: {
      enabled: bool(r.bingo?.enabled, d.bingo.enabled),
      cellPoints: num(r.bingo?.cellPoints, d.bingo.cellPoints),
      linePoints: num(r.bingo?.linePoints, d.bingo.linePoints),
      cardPoints: num(r.bingo?.cardPoints, d.bingo.cardPoints),
      words: list(r.bingo?.words, d.bingo.words),
    },
    hunt: {
      enabled: bool(r.hunt?.enabled, d.hunt.enabled),
      funnyBonus: num(r.hunt?.funnyBonus, d.hunt.funnyBonus),
      items: list(r.hunt?.items, d.hunt.items),
    },
    dares: {
      enabled: bool(r.dares?.enabled, d.dares.enabled),
      foodPoints: num(r.dares?.foodPoints, d.dares.foodPoints),
      couragePoints: num(r.dares?.couragePoints, d.dares.couragePoints),
      extremePoints: num(r.dares?.extremePoints, d.dares.extremePoints),
      food: list(r.dares?.food, d.dares.food),
      courage: list(r.dares?.courage, d.dares.courage),
      extreme: list(r.dares?.extreme, d.dares.extreme),
    },
  };
}

export function getConfig() {
  if (!cache) {
    const row = db.prepare('SELECT json FROM config WHERE id = 1').get();
    let stored = null;
    if (row) {
      try { stored = JSON.parse(row.json); } catch { stored = null; }
    }
    cache = normalize(stored);
  }
  return cache;
}

export function saveConfig(raw) {
  const cfg = normalize(raw);
  db.prepare('INSERT INTO config (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json')
    .run(JSON.stringify(cfg));
  cache = cfg;
  return cfg;
}
