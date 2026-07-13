import { fnv1a } from './content.js';

export const BINGO_SIZE = 5;
export const BINGO_CELLS = BINGO_SIZE * BINGO_SIZE;

// 25 слов карточки: детерминированная тасовка пула от даты и игрока.
// Карточка записывается в БД при первом запросе, так что последующие правки
// пула админом уже созданные карточки не меняют.
export function generateCard(date, userId, pool) {
  const idx = pool.map((_, i) => i);
  let seed = fnv1a(`${date}:bingo:${userId}`);
  const rand = () => (seed = fnv1a(`${seed}`));
  for (let i = idx.length - 1; i > 0; i--) {
    const j = rand() % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  // Если слов в пуле меньше 25 — добиваем повторами, игра не ломается.
  const words = [];
  for (let i = 0; i < BINGO_CELLS; i++) words.push(pool[idx[i % idx.length]]);
  return words;
}

// Закрытые линии: 5 строк + 5 столбцов + 2 диагонали.
export function countLines(marks) {
  const at = (r, c) => marks[r * BINGO_SIZE + c];
  let lines = 0;
  for (let r = 0; r < BINGO_SIZE; r++) {
    if ([0, 1, 2, 3, 4].every((c) => at(r, c))) lines++;
  }
  for (let c = 0; c < BINGO_SIZE; c++) {
    if ([0, 1, 2, 3, 4].every((r) => at(r, c))) lines++;
  }
  if ([0, 1, 2, 3, 4].every((i) => at(i, i))) lines++;
  if ([0, 1, 2, 3, 4].every((i) => at(i, BINGO_SIZE - 1 - i))) lines++;
  return lines;
}

// Очки карточки по текущему конфигу: клетки + линии + бонус за всю карту.
export function cardScore(marks, cfg) {
  const marked = marks.filter(Boolean).length;
  return marked * cfg.cellPoints
    + countLines(marks) * cfg.linePoints
    + (marked === BINGO_CELLS ? cfg.cardPoints : 0);
}
