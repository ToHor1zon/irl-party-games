// Раздача словосочетаний для «Фотофразы».
// В отличие от контента дня здесь не нужна детерминированность: раунд
// разыгрывается один раз, результат сразу фиксируется в phrase_assignments.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Сдвиг по перемешанному кругу гарантирует, что никто не получит своё слово,
// а разные сдвиги для прилагательных и существительных не дают собрать
// чью-то исходную пару целиком. Нужно минимум двое игроков.
export function assignPairs(entries) {
  const order = shuffle(entries);
  const n = order.length;
  const shiftAdj = 1 + Math.floor(Math.random() * (n - 1));
  let shiftNoun = 1 + Math.floor(Math.random() * (n - 1));
  if (n > 2 && shiftNoun === shiftAdj) shiftNoun = 1 + (shiftNoun % (n - 1));

  return order.map((e, i) => ({
    userId: e.userId,
    adjective: order[(i + shiftAdj) % n].adjective,
    noun: order[(i + shiftNoun) % n].noun,
  }));
}
