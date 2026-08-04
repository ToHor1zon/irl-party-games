import { db } from './db.js';
import { MISSIONS, BINGO_WORDS, HUNT_ITEMS } from './content.js';

// Конфиг игр: дефолты из content.js, переопределения — в таблице config (одна строка JSON).
// Меняется через админку; кэшируется в памяти процесса.
export const DEFAULT_CONFIG = {
  photo: { enabled: true, submitPoints: 5, votePoints: 7, missions: MISSIONS },
  chain: { enabled: true, maxPoints: 30 },
  bingo: { enabled: true, cellPoints: 2, linePoints: 10, cardPoints: 40, words: BINGO_WORDS },
  hunt: { enabled: true, itemPoints: 8, items: HUNT_ITEMS },
  phrase: { enabled: true, wordPoints: 3, photoPoints: 12 },
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
    photo: {
      enabled: bool(r.photo?.enabled, d.photo.enabled),
      submitPoints: num(r.photo?.submitPoints, d.photo.submitPoints),
      votePoints: num(r.photo?.votePoints, d.photo.votePoints),
      missions: list(r.photo?.missions, d.photo.missions),
    },
    chain: {
      enabled: bool(r.chain?.enabled, d.chain.enabled),
      maxPoints: num(r.chain?.maxPoints, d.chain.maxPoints, 1),
    },
    bingo: {
      enabled: bool(r.bingo?.enabled, d.bingo.enabled),
      cellPoints: num(r.bingo?.cellPoints, d.bingo.cellPoints),
      linePoints: num(r.bingo?.linePoints, d.bingo.linePoints),
      cardPoints: num(r.bingo?.cardPoints, d.bingo.cardPoints),
      words: list(r.bingo?.words, d.bingo.words),
    },
    hunt: {
      enabled: bool(r.hunt?.enabled, d.hunt.enabled),
      itemPoints: num(r.hunt?.itemPoints, d.hunt.itemPoints),
      items: list(r.hunt?.items, d.hunt.items),
    },
    phrase: {
      enabled: bool(r.phrase?.enabled, d.phrase.enabled),
      wordPoints: num(r.phrase?.wordPoints, d.phrase.wordPoints),
      photoPoints: num(r.phrase?.photoPoints, d.phrase.photoPoints),
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
