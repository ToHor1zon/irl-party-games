import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const TABS = [
  { id: 'today', label: 'Сегодня', icon: '🏮' },
  { id: 'dares', label: 'Слабо', icon: '😤' },
  { id: 'bingo', label: 'Бинго', icon: '🎯' },
  { id: 'feed', label: 'Лента', icon: '🖼️' },
  { id: 'mine', label: 'Моё', icon: '📅' },
  { id: 'top', label: 'Топ', icon: '🏆' },
];
const ADMIN_TAB = { id: 'admin', label: 'Админ', icon: '⚙️' };

export default function App() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!getToken()) { setBooted(true); return; }
    api('/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setBooted(true));
  }, []);

  if (!booted) return <div className="boot">🏮</div>;
  if (!user) return <Join onJoin={setUser} />;
  return <Main user={user} />;
}

function Join({ onJoin }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api('/auth/join', { method: 'POST', body: { name, pin } });
      setToken(d.token);
      onJoin(d.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="join">
      <div className="join-lantern">🏮</div>
      <h1>Китай-Квест</h1>
      <p className="join-sub">Одна поездка. Куча очков. Ноль достоинства.</p>
      <form onSubmit={submit} className="ticket ticket-lantern join-card">
        <label>
          Имя
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Как тебя зовут в этой банде"
            maxLength={20}
            required
          />
        </label>
        <label>
          PIN
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="4–8 цифр, не забудь"
            inputMode="numeric"
            maxLength={8}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? '…' : 'В игру 🐉'}</button>
        <p className="hint">Новое имя — регистрация. Своё имя + PIN — вход.</p>
      </form>
    </div>
  );
}

function Main({ user }) {
  const [tab, setTab] = useState('today');
  const [bingo, setBingo] = useState(null);
  const [hunt, setHunt] = useState(null);
  const [vote, setVote] = useState(null);
  const [dares, setDares] = useState(null);
  const [top, setTop] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [b, h, v, d, l] = await Promise.all([
        api('/bingo'), api('/hunt'), api('/hunt/vote'), api('/dares'), api('/leaderboard'),
      ]);
      setBingo(b); setHunt(h); setVote(v); setDares(d); setTop(l.leaderboard);
    } catch {
      // тихо: поллинг повторит через 30 секунд
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = useCallback(async (fn, successMsg) => {
    try {
      await fn();
      if (successMsg) notify(successMsg);
      await refresh();
    } catch (e) {
      notify(e.message);
    }
  }, [notify, refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar-title">🏮 Китай-Квест</span>
        <span className="topbar-user">{user.name}</span>
      </header>
      <main className="content">
        {tab === 'today' && <TodayTab hunt={hunt} vote={vote} act={act} />}
        {tab === 'dares' && <DaresTab dares={dares} act={act} />}
        {tab === 'bingo' && <BingoTab bingo={bingo} act={act} />}
        {tab === 'feed' && <FeedTab />}
        {tab === 'mine' && <MyGalleryTab />}
        {tab === 'top' &&<TopTab top={top} user={user} hunt={hunt} dares={dares} />}
        {tab === 'admin' && <AdminTab notify={notify} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
      <nav className="tabbar">
        {(user.isAdmin ? [...TABS, ADMIN_TAB] : TABS).map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// Автор снимка намеренно не показывается: оценка должна достаться кадру,
// а не тому, кто его принёс.
function VoteCard({ vote, act }) {
  const [funny, setFunny] = useState(false);
  const [score, setScore] = useState(null);
  const photo = vote.photo;

  // Оценка уходит только по кнопке: цифра — это выбор, который ещё можно
  // передумать, а отправка необратима (второй раз тот же снимок не оценить).
  const send = () => act(
    () => api('/hunt/vote', {
      method: 'POST',
      body: { itemIdx: photo.itemIdx, photoUserId: photo.photoUserId, score, funny },
    }),
    funny ? '😂 Засчитано вместе с угаром' : 'Оценка принята',
  );

  return (
    <section className="ticket vote-card">
      <div className="ticket-tag">Чужой снимок · на оценке · осталось {vote.remaining}</div>
      <h2 className="vote-task">{photo.itemText}</h2>
      <img className="vote-photo" src={photo.url} alt={photo.itemText ?? 'Снимок на оценку'} />
      <p className="hint center">Насколько это отвечает заданию?</p>
      <div className="vote-scores">
        {[0, 1, 2, 3].map((s) => (
          <button
            key={s}
            className={score === s ? 'btn vote-score on' : 'btn vote-score'}
            onClick={() => setScore(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <button
        className={funny ? 'btn vote-funny on' : 'btn vote-funny'}
        onClick={() => setFunny((v) => !v)}
      >
        {funny ? '😂 Угар отмечен' : '😂 Угар'}
      </button>
      <button className="btn vote-send" disabled={score === null} onClick={send}>
        {score === null ? 'Выбери оценку' : `Подтвердить: ${score}${funny ? ' + 😂' : ''}`}
      </button>
      <p className="hint center">
        0 — вообще мимо, 3 — точно в цель. «Угар» ставится отдельно от оценки
        и уходит вместе с ней по кнопке подтверждения.
      </p>
    </section>
  );
}

const FEED_SOURCES = {
  hunt: { label: 'Фотоохота', cls: 'ticket-jade' },
  bingo: { label: 'Бинго', cls: 'ticket-brass' },
  dares: { label: 'Слабо', cls: 'ticket-lantern' },
};

// Лента поездки: группировка по теме, а не по дню — один и тот же сюжет,
// снятый в разные дни разными людьми, интереснее смотреть рядом.
function FeedTab() {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(null);
  const [viewer, setViewer] = useState(null); // {theme, source, photo} — открытый кадр

  useEffect(() => {
    api('/gallery').then(setFeed).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="empty"><div className="empty-icon">😵</div><p>{error}</p></div>;
  if (!feed) return <div className="loading">Проявляем плёнку…</div>;
  if (feed.groups.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🖼️</div>
        <p>Пока пусто. Снимки попадают в ленту, когда охота подтверждена, клетка бинго закрыта или челлендж сдан.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="ticket ticket-lantern">
        <div className="ticket-tag">
          Лента поездки · {feed.totals.photos} фото · {feed.totals.themes} тем · {feed.totals.days} дн.
        </div>
        <p className="hint">Снимки сгруппированы по теме — дни перемешаны специально.</p>
      </section>

      {feed.groups.map((g) => {
        const meta = FEED_SOURCES[g.source] ?? { label: g.source, cls: '' };
        return (
          <section key={`${g.source}:${g.theme}`} className={`ticket ${meta.cls}`}>
            <div className="ticket-tag">{meta.label} · {g.count} фото</div>
            <h3 className="feed-theme">{g.theme}</h3>
            <div className="feed-grid">
              {g.photos.map((p) => (
                <figure key={p.url} className="feed-card">
                  <button
                    type="button"
                    className="feed-photo"
                    onClick={() => setViewer({ theme: g.theme, source: g.source, photo: p })}
                  >
                    <img src={p.url} alt={g.theme} loading="lazy" />
                    {g.source === 'hunt' && p.score > 0 && <span className="feed-score">⭐ {p.score}</span>}
                    {p.funny > 0 && <span className="feed-funny">😂 {p.funny}</span>}
                  </button>
                  <figcaption><b>{p.name}</b> · {p.date}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        );
      })}

      {/* Чужой кадр можно только рассмотреть: тема, автор и обе плашки —
          удалять или переснимать здесь нечего, поэтому кнопка одна. */}
      {viewer && (
        <div className="modal-backdrop" onClick={() => setViewer(null)}>
          <div className="shot-viewer feed-viewer" onClick={(e) => e.stopPropagation()}>
            <h3 className="shot-word">{viewer.theme}</h3>
            <img className="shot-photo" src={viewer.photo.url} alt={viewer.theme} />
            <div className="feed-viewer-meta">
              <span className="feed-viewer-author">{viewer.photo.name}</span>
              <span>{viewer.photo.date}</span>
              {viewer.source === 'hunt' && <span className="feed-badge">⭐ {viewer.photo.score}</span>}
              <span className="feed-badge">😂 {viewer.photo.funny}</span>
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn-ghost" onClick={() => setViewer(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Личная галерея по дням. Опрашивается чаще общего поллинга: оценки капают,
// пока остальные голосуют, и смотреть на застывшие цифры неинтересно.
function MyGalleryTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () => api('/hunt/gallery').then(setData).catch((e) => setError(e.message));
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <div className="empty"><div className="empty-icon">😵</div><p>{error}</p></div>;
  if (!data) return <div className="loading">Считаем оценки…</div>;
  if (data.days.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">📅</div>
        <p>Пока пусто. Снимки появятся здесь сразу после загрузки, а оценки — когда их наставят.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h2 className="page-title">Мои дни</h2>
      {data.days.map((d) => (
        <section key={d.date} className="ticket ticket-jade">
          <div className="ticket-tag">
            {d.date.slice(8, 10)}.{d.date.slice(5, 7)} · за день {d.total}
            {d.funny > 0 && ` · 😂 ${d.funny}`}
          </div>
          <div className="mine-grid">
            {d.items.map((it) => (
              <figure key={it.itemIdx} className="mine-card">
                <div className="mine-photo">
                  <img src={it.url} alt={it.text ?? 'Снимок'} loading="lazy" />
                  <span className="mine-score">{it.score}</span>
                  {it.funny > 0 && <span className="mine-funny">😂 {it.funny}</span>}
                </div>
                <figcaption className="mine-task">{it.text ?? '—'}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TodayTab({ hunt, vote, act }) {
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null); // задание, для которого выбирают снимок
  const [confirmDay, setConfirmDay] = useState(false);

  if (!hunt) return <div className="loading">Зажигаем фонари…</div>;

  const pickShot = (idx) => {
    setPending(idx);
    fileRef.current?.click();
  };

  const upload = (file) => {
    const idx = pending;
    setPending(null);
    if (idx === null) return;
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('item', String(idx));
    act(() => api('/hunt', { method: 'POST', formData: fd }), '📸 Снимок сохранён');
  };

  const saveWords = (body) => act(() => api('/hunt/words', { method: 'POST', body }), 'Слова приняты!');

  const confirmSubmission = () => {
    setConfirmDay(false);
    act(() => api('/hunt/confirm', { method: 'POST' }), '✅ Снимки ушли на голосование');
  };

  return (
    <div className="stack today-stack">
      {vote?.available && vote.photo && (
        <VoteCard
          key={`${vote.photo.photoUserId}:${vote.photo.itemIdx}`}
          vote={vote}
          act={act}
        />
      )}

      {hunt.enabled && (
        <section className="ticket ticket-jade">
          <div className="ticket-tag">
            Фотоохота дня · очки = сумма чужих оценок · угар дня +{hunt.funnyBonus}
          </div>
          {!hunt.started ? (
            <>
              <p className="hint">
                Новый день — новые задания: два общих и одно, собранное из слов других
                игроков. В полночь день обнуляется, и задания берутся заново.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => act(() => api('/hunt/start', { method: 'POST' }), '🎯 Задания на сегодня получены')}
              >
                Получить задания на сегодня
              </button>
            </>
          ) : hunt.confirmed ? (
            <p className="hint">✅ Снимки подтверждены и ушли на оценку. Переснять уже нельзя.</p>
          ) : (
            <p className="hint">
              Три задания на день. Снимок можно менять сколько угодно, пока не нажмёшь «Готово» —
              после этого он уйдёт на голосование, и чужие оценки станут твоими очками.
            </p>
          )}

          {hunt.items.map((it) => (
            <div key={it.idx} className="hunt-item">
              <div className="hunt-head">
                <span className="hunt-text">
                  {it.personal && <span className="hunt-personal">от игроков</span>}
                  {it.text ?? 'Ждём слова от других игроков'}
                </span>
                {it.text && !hunt.confirmed && (
                  <button className="btn btn-small" onClick={() => pickShot(it.idx)}>
                    {it.myUrl ? '🔄 Переснять' : '📸 Снять'}
                  </button>
                )}
              </div>
              {it.myUrl && (
                <figure className="hunt-mine">
                  <img src={it.myUrl} alt={it.text ?? 'Мой снимок'} loading="lazy" />
                </figure>
              )}
            </div>
          ))}

          {hunt.started && !hunt.confirmed && (
            <button
              className="btn btn-primary"
              disabled={hunt.shotCount === 0}
              onClick={() => setConfirmDay(true)}
            >
              Готово — на голосование ({hunt.shotCount}/{hunt.items.length})
            </button>
          )}
        </section>
      )}

      {hunt.enabled && !hunt.confirmed && (
        <section className="ticket ticket-lantern">
          <div className="ticket-tag">Слова для третьего задания</div>
          <p className="hint">
            Сдай прилагательное и существительное — они уйдут другим игрокам, а твоё
            третье задание соберётся из чужих слов.
            {hunt.othersWithWords === 0 && ' Пока никто больше слов не сдал — задание появится, когда сдадут.'}
          </p>
          <WordsForm key={hunt.date} initial={hunt.myWords} onSave={saveWords} />
        </section>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
          else setPending(null);
        }}
      />

      {confirmDay && (
        <ConfirmModal
          title="Отправить на голосование?"
          text={`Подтверждаешь ${hunt.shotCount} снимк(ов). После этого переснять будет нельзя, и остальные начнут их оценивать.`}
          confirmLabel="Да, готово"
          onConfirm={confirmSubmission}
          onCancel={() => setConfirmDay(false)}
        />
      )}
    </div>
  );
}

// «Слабо»: список поступков, а не находок. Пересдать фото можно — очки от
// этого не меняются, а кадр бывает смазанным.
function DaresTab({ dares, act }) {
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null);

  if (!dares) return <div className="loading">Собираем список…</div>;
  if (!dares.enabled) {
    return (
      <div className="empty">
        <div className="empty-icon">😤</div>
        <p>Игра «Слабо» выключена админом.</p>
      </div>
    );
  }

  const pickShot = (id) => {
    setPending(id);
    fileRef.current?.click();
  };

  const upload = (file) => {
    const id = pending;
    setPending(null);
    if (!id) return;
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('dareId', id);
    act(() => api('/dares', { method: 'POST', formData: fd }), '😤 Засчитано!');
  };

  return (
    <div className="stack">
      <section className="ticket ticket-lantern">
        <div className="ticket-tag">Слабо · сделано {dares.myDone} · очков {dares.myPoints}</div>
        <p className="hint">
          Здесь не высматривают, а делают. Выбери челлендж, выполни по-настоящему
          и сфоткай доказательство. Чем страшнее — тем дороже.
        </p>
      </section>

      {dares.tiers.map((t) => (
        <section key={t.tier} className={t.tier === 'extreme' ? 'ticket ticket-brass' : 'ticket ticket-jade'}>
          <div className="ticket-tag">{t.label} · каждый +{t.points}</div>
          <p className="hint">{t.hint}</p>
          {t.items.map((it) => (
            <div key={it.id} className="dare-item">
              <div className="dare-head">
                <span className={it.myUrl ? 'dare-text done' : 'dare-text'}>{it.text}</span>
                <button className="btn btn-small" onClick={() => pickShot(it.id)}>
                  {it.myUrl ? '🔄' : '📸 Слабо!'}
                </button>
              </div>
              <div className="dare-meta">
                {it.myUrl && <span className="dare-done">✓ твои +{t.points}</span>}
                {it.doneBy > 0 && <span>взяли: {it.doneBy}</span>}
              </div>
              {it.myUrl && (
                <figure className="dare-shot">
                  <img src={it.myUrl} alt={it.text} loading="lazy" />
                </figure>
              )}
            </div>
          ))}
        </section>
      ))}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
          else setPending(null);
        }}
      />
    </div>
  );
}

// Форма монтируется заново на каждый игровой день (key = дата), поэтому
// поллинг не затирает то, что игрок сейчас печатает.
function WordsForm({ initial, onSave }) {
  const [adjective, setAdjective] = useState(initial?.adjective ?? '');
  const [noun, setNoun] = useState(initial?.noun ?? '');

  const submit = (e) => {
    e.preventDefault();
    onSave({ adjective: adjective.trim(), noun: noun.trim() });
  };

  return (
    <form onSubmit={submit} className="phrase-form">
      <label>
        Прилагательное
        <input
          value={adjective}
          onChange={(e) => setAdjective(e.target.value)}
          placeholder="мокрый, святой, беременный…"
          maxLength={30}
          required
        />
      </label>
      <label>
        Существительное
        <input
          value={noun}
          onChange={(e) => setNoun(e.target.value)}
          placeholder="утюг, бабушка, дракон…"
          maxLength={30}
          required
        />
      </label>
      <button className="btn btn-primary" disabled={!adjective.trim() || !noun.trim()}>
        {initial ? 'Изменить слова' : 'Сдать слова'}
      </button>
    </form>
  );
}

function ConfirmModal({ title, text, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="modal-text">{text}</p>
        <div className="btn-row">
          <button className="btn btn-jade" onClick={onConfirm}>{confirmLabel}</button>
          <button className="btn btn-ghost" onClick={onCancel}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

function BingoTab({ bingo, act }) {
  // Клетку закрывает только фото, поэтому тап по пустой сразу открывает камеру.
  // Модалка осталась на сбросе — там есть что терять.
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null); // клетка, для которой выбирают фото
  const [viewer, setViewer] = useState(null); // { cell, word, url } — открытый снимок

  if (!bingo) return <div className="loading">Раздаём карточки…</div>;
  if (!bingo.enabled) {
    return (
      <div className="empty">
        <div className="empty-icon">🎯</div>
        <p>Бинго выключено админом.</p>
      </div>
    );
  }

  const pickShot = (cell) => {
    setPending(cell);
    fileRef.current?.click();
  };

  const upload = (file) => {
    const cell = pending;
    setPending(null);
    if (cell === null) return;
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('cell', String(cell));
    act(
      () => api('/bingo/cell', { method: 'POST', formData: fd }),
      `🎯 Есть! Клетка закрыта +${bingo.cellPoints}`,
    );
  };

  const reset = () => {
    const { cell } = viewer;
    setViewer(null);
    act(() => api(`/bingo/cell/${cell}`, { method: 'DELETE' }), 'Отметка снята, фото удалено');
  };

  return (
    <div className="stack">
      <section className="ticket ticket-jade">
        <div className="ticket-tag">
          Бинго дня · клетка +{bingo.cellPoints} · линия +{bingo.linePoints} · вся карта +{bingo.cardPoints}
        </div>
        <p className="hint">
          Высмотрел это вокруг — сфоткай, и клетка закроется. Без фото отметки нет.
          Подстраивать не считается: сам купил баблти — мимо. Линия — 5 в ряд
          по горизонтали, вертикали или диагонали.
        </p>
        <div className="bingo-grid">
          {bingo.cells.map((c, i) => (
            <button
              key={i}
              className={c.marked ? 'bingo-cell marked' : 'bingo-cell'}
              onClick={() => (c.marked ? setViewer({ cell: i, word: c.word, url: c.photoUrl }) : pickShot(i))}
            >
              {c.photoUrl && <img className="bingo-shot" src={c.photoUrl} alt="" loading="lazy" />}
              <span className="bingo-word">{c.word}</span>
            </button>
          ))}
        </div>
        <p className="hint center">
          Закрыто {bingo.marked}/25 · линий {bingo.lines} · очков за карту {bingo.score}
        </p>
      </section>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
          else setPending(null);
        }}
      />

      {/* Сначала показываем сам снимок: сброс — уже осознанное решение,
          поэтому отдельного «точно?» больше не нужно. */}
      {viewer && (
        <div className="modal-backdrop" onClick={() => setViewer(null)}>
          <div className="shot-viewer" onClick={(e) => e.stopPropagation()}>
            <h3 className="shot-word">{viewer.word}</h3>
            {viewer.url && <img className="shot-photo" src={viewer.url} alt={viewer.word} />}
            <div className="btn-row">
              <button type="button" className="btn btn-ghost" onClick={() => setViewer(null)}>
                Закрыть
              </button>
              <button type="button" className="btn btn-reset" onClick={reset}>
                Сбросить
              </button>
            </div>
            <p className="hint center">Сброс удалит фото и снимет очки за клетку.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Общий редактор пула: добавление и удаление позиций, каждое изменение
// сразу сохраняется целым конфигом (так работает PUT /admin/config).
function PoolEditor({ tag, items, busy, placeholder, warning, note, onSave, notify }) {
  const [value, setValue] = useState('');

  const add = (e) => {
    e.preventDefault();
    const w = value.trim();
    if (!w) return;
    if (items.some((x) => x.toLowerCase() === w.toLowerCase()))
      return notify('Такое уже есть в пуле');
    setValue('');
    onSave([...items, w]);
  };

  return (
    <section className="ticket ticket-brass">
      <div className="ticket-tag">{tag}</div>
      <form onSubmit={add} className="admin-add">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          maxLength={80}
        />
        <button className="btn btn-jade" disabled={busy || !value.trim()}>Добавить</button>
      </form>
      {warning && <p className="hint">⚠️ {warning}</p>}
      <div className="admin-words">
        {items.map((w) => (
          <span key={w} className="admin-word">
            {w}
            <button
              className="admin-word-x"
              disabled={busy}
              onClick={() => onSave(items.filter((x) => x !== w))}
              aria-label={`Удалить ${w}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {note && <p className="hint">{note}</p>}
    </section>
  );
}

function AdminTab({ notify }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/admin/config')
      .then((d) => setCfg(d.config))
      .catch((e) => notify(e.message));
  }, [notify]);

  if (!cfg) return <div className="loading">Открываем кабинет…</div>;

  const save = async (patch) => {
    setBusy(true);
    try {
      const d = await api('/admin/config', {
        method: 'PUT',
        body: { config: { ...cfg, ...patch } },
      });
      setCfg(d.config);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h2 className="page-title">Админка</h2>
      <PoolEditor
        tag={`Бинго — слов в пуле: ${cfg.bingo.words.length} · нужно минимум 25`}
        items={cfg.bingo.words}
        busy={busy}
        placeholder="Слово или словосочетание"
        warning={cfg.bingo.words.length < 25 ? 'Слов меньше 25 — в карточках будут повторы.' : null}
        note="Изменения пула действуют на карточки, выданные после правки. Уже розданные карточки дня не меняются."
        onSave={(words) => save({ bingo: { ...cfg.bingo, words } })}
        notify={notify}
      />
      <PoolEditor
        tag={`Фотоохота — целей в пуле: ${cfg.hunt.items.length} · по 2 в день`}
        items={cfg.hunt.items}
        busy={busy}
        placeholder="Стёбная цель для охоты"
        warning={cfg.hunt.items.length < 2 ? 'Нужно минимум 2 цели, иначе список дня будет короче.' : null}
        note="Третье задание не из пула — оно собирается из слов игроков. Сегодняшний список уже зафиксирован, правки подействуют со следующего дня."
        onSave={(items) => save({ hunt: { ...cfg.hunt, items } })}
        notify={notify}
      />
      <PoolEditor
        tag={`Слабо · еда — челленджей: ${cfg.dares.food.length} · каждый +${cfg.dares.foodPoints}`}
        items={cfg.dares.food}
        busy={busy}
        placeholder="Что съесть — конкретно, с названием блюда"
        note="Формулируй проверяемо: «куриные лапки», а не «что-то странное»."
        onSave={(food) => save({ dares: { ...cfg.dares, food } })}
        notify={notify}
      />
      <PoolEditor
        tag={`Слабо · кураж — челленджей: ${cfg.dares.courage.length} · каждый +${cfg.dares.couragePoints}`}
        items={cfg.dares.courage}
        busy={busy}
        placeholder="Поступок, на который нужен характер"
        onSave={(courage) => save({ dares: { ...cfg.dares, courage } })}
        notify={notify}
      />
      <PoolEditor
        tag={`Слабо · экстрим — челленджей: ${cfg.dares.extreme.length} · каждый +${cfg.dares.extremePoints}`}
        items={cfg.dares.extreme}
        busy={busy}
        placeholder="Аттракцион или высота — с точным названием"
        note="Уже выполненные челленджи привязаны к тексту: перепишешь формулировку — старое засчитанное отвяжется."
        onSave={(extreme) => save({ dares: { ...cfg.dares, extreme } })}
        notify={notify}
      />
    </div>
  );
}

function TopTab({ top, user, hunt, dares }) {
  if (!top) return <div className="loading">Пересчитываем славу…</div>;
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="stack">
      <h2 className="page-title">Лидерборд поездки</h2>
      <section className="ticket ticket-lantern">
        {top.map((p, i) => (
          <div key={p.id} className={p.id === user.id ? 'lb-row me' : 'lb-row'}>
            <span className="lb-place">{medals[i] || `${i + 1}.`}</span>
            <span className="lb-name">{p.name}{p.id === user.id ? ' (ты)' : ''}</span>
            <span className="lb-score">{p.score}</span>
          </div>
        ))}
        {top.length === 0 && <p className="hint">Пока пусто. Позови банду.</p>}
      </section>
      <p className="hint center">
        охота: каждая чужая оценка 0–3 идёт тебе в очки · угар дня +{hunt?.funnyBonus ?? 5} ·
        слабо: {dares?.tiers?.map((t) => `${t.label.toLowerCase()} +${t.points}`).join(', ') ?? 'еда +10, кураж +15, экстрим +25'} ·
        число N +N (до 30) · бинго: клетка +2, линия +10, вся карта +40
      </p>
    </div>
  );
}
