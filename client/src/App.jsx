import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const TABS = [
  { id: 'today', label: 'Сегодня', icon: '🏮' },
  { id: 'photos', label: 'Фото', icon: '📸' },
  { id: 'bingo', label: 'Бинго', icon: '🎯' },
  { id: 'chain', label: 'Цепочка', icon: '🔢' },
  { id: 'phrase', label: 'Фразы', icon: '🎭' },
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
  const [today, setToday] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [chain, setChain] = useState(null);
  const [bingo, setBingo] = useState(null);
  const [hunt, setHunt] = useState(null);
  const [phrase, setPhrase] = useState(null);
  const [top, setTop] = useState(null);
  const [players, setPlayers] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [t, g, c, b, h, f, l, p] = await Promise.all([
        api('/day/today'), api('/photos/today'), api('/chain'), api('/bingo'), api('/hunt'), api('/phrase'), api('/leaderboard'), api('/players'),
      ]);
      setToday(t); setGallery(g); setChain(c); setBingo(b); setHunt(h); setPhrase(f); setTop(l.leaderboard); setPlayers(p.players);
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
        {tab === 'today' && <TodayTab today={today} hunt={hunt} chain={chain} act={act} />}
        {tab === 'photos' && <PhotosTab gallery={gallery} act={act} />}
        {tab === 'bingo' && <BingoTab bingo={bingo} act={act} />}
        {tab === 'chain' && <ChainTab chain={chain} act={act} />}
        {tab === 'phrase' && <PhraseTab phrase={phrase} user={user} act={act} />}
        {tab === 'top' && <TopTab top={top} user={user} />}
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

function FileButton({ label, onFile, className = 'btn btn-primary' }) {
  const ref = useRef(null);
  return (
    <>
      <button className={className} onClick={() => ref.current?.click()}>{label}</button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function TodayTab({ today, hunt, chain, act }) {
  if (!today) return <div className="loading">Зажигаем фонари…</div>;

  const uploadPhoto = (file) => {
    const fd = new FormData();
    fd.append('photo', file);
    act(() => api('/photos', { method: 'POST', formData: fd }), 'Фото сдано! +5 очков');
  };

  const uploadHunt = (idx) => (file) => {
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('item', String(idx));
    act(() => api('/hunt', { method: 'POST', formData: fd }), `🎯 Добыча засчитана! +${hunt.itemPoints}`);
  };

  return (
    <div className="stack today-stack">
      <section className="ticket ticket-lantern">
        <div className="ticket-tag">Фото-миссия дня · сдал +5 · голос за твоё +7</div>
        <h2>{today.mission}</h2>
        {today.photo.submitted ? (
          <div className="done-line">✓ Фото сдано. Одна попытка — и она была твоя.</div>
        ) : (
          <FileButton label="📸 Сдать фото (одна попытка!)" onFile={uploadPhoto} />
        )}
        <p className="hint">Сдано сегодня: {today.photo.count}. Голосование — во вкладке «Фото».</p>
      </section>

      {hunt?.enabled && hunt.items.length > 0 && (
        <section className="ticket ticket-jade">
          <div className="ticket-tag">Фотоохота дня · каждая цель +{hunt.itemPoints}</div>
          <p className="hint">
            Это не конкурс красоты — просто найди и докажи фоткой. Три цели на сегодня:
          </p>
          {hunt.items.map((it) => (
            <div key={it.idx} className="hunt-item">
              <div className="hunt-head">
                <span className="hunt-text">{it.text}</span>
                {it.myUrl ? (
                  <span className="hunt-done">✓ добыто</span>
                ) : (
                  <FileButton className="btn btn-small" label="📸 Нашёл!" onFile={uploadHunt(it.idx)} />
                )}
              </div>
              {it.finds.length > 0 && (
                <div className="hunt-finds">
                  {it.finds.map((f) => (
                    <figure key={f.userId} className="hunt-find">
                      <img src={f.url} alt={`Находка от ${f.name}`} loading="lazy" />
                      <figcaption>{f.name}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {chain?.enabled && (
        <section className="ticket ticket-brass chain-preview">
          <div className="ticket-tag">Цепочка чисел · сейчас ищем {chain.next}</div>
          {chain.lastEntry ? (
            <LastChainEntry entry={chain.lastEntry} />
          ) : (
            <p className="hint">Цепочка ещё не началась — первым нужно найти число 1.</p>
          )}
        </section>
      )}
    </div>
  );
}

function PhotosTab({ gallery, act }) {
  if (!gallery) return <div className="loading">Проявляем плёнку…</div>;
  if (gallery.photos.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">📭</div>
        <p>Сегодня ещё никто не сдал фото.<br />Миссия ждёт на вкладке «Сегодня».</p>
      </div>
    );
  }
  return (
    <div className="stack">
      <h2 className="page-title">Галерея дня</h2>
      <p className="hint center">Голосуй за лучшее: за себя нельзя, голос можно менять. Автору +7 за голос.</p>
      {gallery.photos.map((p) => (
        <figure key={p.userId} className="photo-card">
          <img src={p.url} alt={`Фото от ${p.name}`} loading="lazy" />
          <figcaption>
            <span className="photo-author">{p.mine ? `${p.name} (ты)` : p.name}</span>
            <span className="photo-votes">🔥 {p.votes}</span>
            {!p.mine && (
              <button
                className={gallery.myVoteUserId === p.userId ? 'btn btn-small voted' : 'btn btn-small'}
                onClick={() => act(() => api('/day/vote-photo', { method: 'POST', body: { targetUserId: p.userId } }), 'Голос учтён')}
              >
                {gallery.myVoteUserId === p.userId ? '✓ Твой голос' : 'Голосовать'}
              </button>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function ChainTab({ chain, act }) {
  if (!chain) return <div className="loading">Считаем до бесконечности…</div>;

  const upload = (file) => {
    const fd = new FormData();
    fd.append('photo', file);
    act(() => api('/chain', { method: 'POST', formData: fd }), `Число ${chain.next} твоё! +${chain.points}`);
  };

  return (
    <div className="stack">
      <section className="ticket ticket-brass chain-hero">
        <div className="ticket-tag">Цепочка чисел · за число N — +N (макс. +30)</div>
        <div className="chain-number">{chain.next}</div>
        <p className="hint">Найди это число вокруг — номер дома, ценник, автобус — и успей первым.</p>
        {chain.mustSkip ? (
          <div className="done-line">✋ Ты взял прошлое число — этот ход пропускаешь.</div>
        ) : (
          <FileButton label={`📸 Я нашёл ${chain.next}! (+${chain.points})`} onFile={upload} />
        )}
        {chain.lastFinder && <p className="hint">Прошлое число забрал(а): {chain.lastFinder.name}</p>}
        {chain.lastEntry && <LastChainEntry entry={chain.lastEntry} />}
      </section>

      {chain.entries.length > 0 && (
        <>
          <h3 className="page-title">История охоты</h3>
          <div className="chain-grid">
            {chain.entries.map((e) => (
              <figure key={e.n} className="chain-card">
                <img src={e.url} alt={`Число ${e.n}`} loading="lazy" />
                <figcaption><b>{e.n}</b> · {e.name} · +{e.points}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LastChainEntry({ entry }) {
  return (
    <figure className="chain-latest">
      <div className="chain-latest-photo">
        <img src={entry.url} alt={`Последнее найденное число ${entry.n}`} loading="lazy" />
        <span className="chain-latest-number">{entry.n}</span>
      </div>
      <figcaption>Последним нашёл(ла): {entry.name}</figcaption>
    </figure>
  );
}

// Форма слов монтируется заново на каждый раунд (key = id раунда),
// поэтому поллинг не затирает то, что игрок сейчас печатает.
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

function PhraseCard({ item }) {
  return (
    <figure className={item.mine ? 'phrase-card mine' : 'phrase-card'}>
      <figcaption className="phrase-card-head">
        <span className="phrase-card-text">{item.adjective} {item.noun}</span>
        <span className="phrase-card-name">{item.mine ? `${item.name} (ты)` : item.name}</span>
      </figcaption>
      {item.url
        ? <img src={item.url} alt={`${item.adjective} ${item.noun}`} loading="lazy" />
        : <div className="phrase-card-wait">ещё ищет…</div>}
    </figure>
  );
}

// Архив грузится отдельно от общего поллинга: он меняется редко,
// а фото прошлых игр тянуть каждые 30 секунд незачем.
function PhraseHistory({ roundId }) {
  const [rounds, setRounds] = useState(null);

  useEffect(() => {
    api('/phrase/history').then((d) => setRounds(d.rounds)).catch(() => setRounds([]));
  }, [roundId]);

  if (!rounds || rounds.length === 0) return null;

  return (
    <section className="phrase-past-list">
      <h3 className="page-title">Прошлые игры</h3>
      {rounds.map((r) => (
        <details key={r.id} className="phrase-past">
          <summary>
            Игра #{r.id} · {r.date.slice(8, 10)}.{r.date.slice(5, 7)} · {r.photos} из {r.items.length} фото
          </summary>
          <div className="phrase-grid">
            {r.items.map((i) => <PhraseCard key={i.userId} item={i} />)}
          </div>
        </details>
      ))}
    </section>
  );
}

function PhraseTab({ phrase, user, act }) {
  if (!phrase) return <div className="loading">Тасуем слова…</div>;
  if (!phrase.enabled) {
    return (
      <div className="empty">
        <div className="empty-icon">🎭</div>
        <p>Фотофраза выключена админом.</p>
      </div>
    );
  }

  const status = phrase.round?.status ?? null;
  const ready = phrase.players.length;
  const done = phrase.assignments.filter((a) => a.url).length;

  const saveWords = (body) =>
    act(() => api('/phrase/words', { method: 'POST', body }), 'Слова приняты!');
  const uploadPhoto = (file) => {
    const fd = new FormData();
    fd.append('photo', file);
    act(() => api('/phrase/photo', { method: 'POST', formData: fd }), `🎭 Принято! +${phrase.photoPoints}`);
  };

  return (
    <div className="stack">
      {status === null && (
        <section className="ticket ticket-lantern phrase-hero">
          <div className="ticket-tag">Фотофраза · слова +{phrase.wordPoints} · фото +{phrase.photoPoints}</div>
          <h2>Каждый сдаёт два слова — получает чужие</h2>
          <p className="hint">
            Все скидывают по одному прилагательному и одному существительному. На старте слова
            перемешиваются: тебе достаётся чужая пара, и её надо сфотографировать в реальной жизни.
          </p>
          <div className="btn-row">
            <button className="btn btn-jade" onClick={() => act(() => api('/phrase/round', { method: 'POST' }), 'Раунд открыт — сдавайте слова')}>
              Открыть раунд
            </button>
          </div>
        </section>
      )}

      {status === 'collecting' && (
        <>
          <section className="ticket ticket-lantern">
            <div className="ticket-tag">Раунд #{phrase.round.id} · сбор слов · +{phrase.wordPoints}</div>
            <h2>Два слова от тебя</h2>
            <p className="hint">
              Чужие слова скрыты до старта. Загадывай так, чтобы сфоткать было реально — но смешно.
            </p>
            <WordsForm key={phrase.round.id} initial={phrase.myWords} onSave={saveWords} />
          </section>

          <section className="ticket ticket-jade">
            <div className="ticket-tag">Готовы: {ready} · нужно минимум {phrase.minPlayers}</div>
            <div className="phrase-players">
              {phrase.players.map((p) => (
                <span key={p.userId} className="phrase-player">✓ {p.mine ? `${p.name} (ты)` : p.name}</span>
              ))}
              {ready === 0 && <p className="hint">Пока никто не сдал слова.</p>}
            </div>
            <div className="btn-row">
              <button
                className="btn btn-jade"
                disabled={ready < phrase.minPlayers}
                onClick={() => act(() => api('/phrase/start', { method: 'POST' }), '🎲 Слова перемешаны!')}
              >
                Начать игру ({ready})
              </button>
            </div>
            {ready < phrase.minPlayers && <p className="hint">Ждём ещё игроков со словами.</p>}
            {user.isAdmin && (
              <>
                <button
                  className="btn btn-ghost phrase-admin-close"
                  onClick={() => act(() => api('/phrase/finish', { method: 'POST' }), 'Игра закрыта — можно открыть новую')}
                >
                  Закрыть игру, не начиная
                </button>
                <p className="hint">Только для админа: сдаться и начать новую игру в другой день.</p>
              </>
            )}
          </section>
        </>
      )}

      {status === 'playing' && (
        <>
          <section className="ticket ticket-brass phrase-hero">
            <div className="ticket-tag">Раунд #{phrase.round.id} · твоя фраза · фото +{phrase.photoPoints}</div>
            {phrase.myAssignment ? (
              <>
                <div className="phrase-big">{phrase.myAssignment.adjective}<br />{phrase.myAssignment.noun}</div>
                <p className="hint">Найди или устрой это в реальной жизни и сфоткай. Одна попытка.</p>
                {phrase.myAssignment.url ? (
                  <div className="done-line">✓ Фото сдано. Ждём остальных.</div>
                ) : (
                  <FileButton label="📸 Сдать фото" onFile={uploadPhoto} />
                )}
              </>
            ) : (
              <p className="hint">Ты не успел сдать слова — этот раунд идёт без тебя. Подключайся к следующему.</p>
            )}
            <p className="hint">Сдали {done} из {phrase.assignments.length}.</p>
          </section>

          <div className="phrase-grid">
            {phrase.assignments.map((a) => <PhraseCard key={a.userId} item={a} />)}
          </div>

          <button
            className="btn btn-ghost"
            onClick={() => act(() => api('/phrase/finish', { method: 'POST' }), 'Раунд закрыт')}
          >
            Завершить раунд досрочно
          </button>
        </>
      )}

      {status === 'finished' && (
        <>
          <section className="ticket ticket-jade phrase-hero">
            <div className="ticket-tag">Раунд #{phrase.round.id} · итоги</div>
            <h2>Раунд сыгран</h2>
            <p className="hint">Сфоткано {done} из {phrase.assignments.length} фраз.</p>
            <div className="btn-row">
              <button className="btn btn-jade" onClick={() => act(() => api('/phrase/round', { method: 'POST' }), 'Новый раунд открыт')}>
                Новый раунд
              </button>
            </div>
          </section>

          <div className="phrase-grid">
            {phrase.assignments.map((a) => <PhraseCard key={a.userId} item={a} />)}
          </div>
        </>
      )}

      <PhraseHistory roundId={phrase.round?.id ?? 0} />
    </div>
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
  // Любое изменение клетки — только через подтверждение в модалке.
  const [confirm, setConfirm] = useState(null); // { cell, word, marked }

  if (!bingo) return <div className="loading">Раздаём карточки…</div>;
  if (!bingo.enabled) {
    return (
      <div className="empty">
        <div className="empty-icon">🎯</div>
        <p>Бинго выключено админом.</p>
      </div>
    );
  }

  const apply = () => {
    const { cell, marked } = confirm;
    setConfirm(null);
    act(
      () => api('/bingo/mark', { method: 'POST', body: { cell, marked: !marked } }),
      marked ? 'Отметка снята' : '🎯 Есть! Клетка отмечена',
    );
  };

  return (
    <div className="stack">
      <section className="ticket ticket-jade">
        <div className="ticket-tag">
          Бинго дня · клетка +{bingo.cellPoints} · линия +{bingo.linePoints} · вся карта +{bingo.cardPoints}
        </div>
        <p className="hint">
          Высмотрел это вокруг — тапни клетку. Подстраивать не считается:
          сам купил баблти — мимо. Линия — 5 в ряд по горизонтали,
          вертикали или диагонали.
        </p>
        <div className="bingo-grid">
          {bingo.cells.map((c, i) => (
            <button
              key={i}
              className={c.marked ? 'bingo-cell marked' : 'bingo-cell'}
              onClick={() => setConfirm({ cell: i, word: c.word, marked: c.marked })}
            >
              {c.word}
            </button>
          ))}
        </div>
        <p className="hint center">
          Отмечено {bingo.marked}/25 · линий {bingo.lines} · очков за карту {bingo.score}
        </p>
      </section>

      {confirm && (
        <ConfirmModal
          title={confirm.marked ? 'Сбросить отметку?' : 'Отметить клетку?'}
          text={confirm.marked
            ? `Снимаем отметку с «${confirm.word}» — очки за неё уйдут.`
            : `«${confirm.word}» — правда видел это своими глазами? Честность — валюта этой игры.`}
          confirmLabel={confirm.marked ? 'Да, сбросить' : 'Да, подтверждаю'}
          onConfirm={apply}
          onCancel={() => setConfirm(null)}
        />
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
        tag={`Фотомиссия дня — тем в пуле: ${cfg.photo.missions.length}`}
        items={cfg.photo.missions}
        busy={busy}
        placeholder="Тема для фотомиссии дня"
        warning={cfg.photo.missions.length < 2 ? 'Лучше добавить хотя бы две темы, чтобы миссии менялись.' : null}
        note="Миссия на сегодня уже выбрана. Изменения пула подействуют со следующего игрового дня."
        onSave={(missions) => save({ photo: { ...cfg.photo, missions } })}
        notify={notify}
      />
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
        tag={`Фотоохота — целей в пуле: ${cfg.hunt.items.length} · по 3 в день`}
        items={cfg.hunt.items}
        busy={busy}
        placeholder="Стёбная цель для охоты"
        warning={cfg.hunt.items.length < 3 ? 'Нужно минимум 3 цели, иначе список дня будет короче.' : null}
        note="Сегодняшний список уже зафиксирован — правки пула подействуют со следующего дня."
        onSave={(items) => save({ hunt: { ...cfg.hunt, items } })}
        notify={notify}
      />
    </div>
  );
}

function TopTab({ top, user }) {
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
        фото +5 · голос за твоё фото +7 · число N +N (до 30) · охота: цель +8 ·
        бинго: клетка +2, линия +10, вся карта +40 · фразы: слова +3, фото по фразе +12
      </p>
    </div>
  );
}
