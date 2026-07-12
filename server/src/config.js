import { db } from './db.js';
import { MISSIONS, SECRET_WORDS, IMPOSTER_WORDS } from './content.js';

// Конфиг игр: дефолты из content.js, переопределения — в таблице config (одна строка JSON).
// Меняется через админку; кэшируется в памяти процесса.
export const DEFAULT_CONFIG = {
  photo: { enabled: true, submitPoints: 5, votePoints: 7, missions: MISSIONS },
  word: { enabled: true, timesToSay: 5, points: 15, words: SECRET_WORDS },
  imposter: { enabled: true, minPlayers: 3, survivePoints: 30, guessPoints: 10, words: IMPOSTER_WORDS },
  chain: { enabled: true, maxPoints: 30 },
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
    word: {
      enabled: bool(r.word?.enabled, d.word.enabled),
      timesToSay: num(r.word?.timesToSay, d.word.timesToSay, 1),
      points: num(r.word?.points, d.word.points),
      words: list(r.word?.words, d.word.words),
    },
    imposter: {
      enabled: bool(r.imposter?.enabled, d.imposter.enabled),
      minPlayers: num(r.imposter?.minPlayers, d.imposter.minPlayers, 3),
      survivePoints: num(r.imposter?.survivePoints, d.imposter.survivePoints),
      guessPoints: num(r.imposter?.guessPoints, d.imposter.guessPoints),
      words: list(r.imposter?.words, d.imposter.words),
    },
    chain: {
      enabled: bool(r.chain?.enabled, d.chain.enabled),
      maxPoints: num(r.chain?.maxPoints, d.chain.maxPoints, 1),
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
