import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const TABS = [
  { id: 'today', label: 'Сегодня', icon: '🏮' },
  { id: 'photos', label: 'Фото', icon: '📸' },
  { id: 'chain', label: 'Цепочка', icon: '🔢' },
  { id: 'top', label: 'Топ', icon: '🏆' },
];

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
      const [t, g, c, l, p] = await Promise.all([
        api('/day/today'), api('/photos/today'), api('/chain'), api('/leaderboard'), api('/players'),
      ]);
      setToday(t); setGallery(g); setChain(c); setTop(l.leaderboard); setPlayers(p.players);
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
        {tab === 'today' && <TodayTab today={today} user={user} players={players} act={act} />}
        {tab === 'photos' && <PhotosTab gallery={gallery} act={act} />}
        {tab === 'chain' && <ChainTab chain={chain} act={act} />}
        {tab === 'top' && <TopTab top={top} user={user} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function FileButton({ label, onFile }) {
  const ref = useRef(null);
  return (
    <>
      <button className="btn btn-primary" onClick={() => ref.current?.click()}>{label}</button>
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

function FlipCard({ front, back }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className={flipped ? 'flip flipped' : 'flip'}
      onClick={() => setFlipped(!flipped)}
      role="button"
      aria-label="Перевернуть карту"
    >
      <div className="flip-inner">
        <div className="flip-face flip-front">{front}</div>
        <div className="flip-face flip-back">{back}</div>
      </div>
    </div>
  );
}

function Drama({ y }) {
  return (
    <section className="ticket drama">
      <div className="ticket-tag">Вчерашняя драма · {y.date}</div>
      <h3>
        {y.caught
          ? `🚨 Импостером был(а) ${y.imposterName} — и вы его вычислили!`
          : `😈 Импостером был(а) ${y.imposterName} — и ушёл сухим из воды (+30)`}
      </h3>
      <p>Слово дня было: <b>«{y.word}»</b></p>
    </section>
  );
}

function TodayTab({ today, user, players, act }) {
  if (!today) return <div className="loading">Зажигаем фонари…</div>;
  const others = players.filter((p) => p.id !== user.id);

  const uploadPhoto = (file) => {
    const fd = new FormData();
    fd.append('photo', file);
    act(() => api('/photos', { method: 'POST', formData: fd }), 'Фото сдано! +5 очков');
  };

  return (
    <div className="stack">
      {today.yesterday && <Drama y={today.yesterday} />}

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

      <section className="ticket ticket-brass">
        <div className="ticket-tag">Тайное слово · выполнил +15</div>
        <FlipCard
          front={<span>🤫 Тапни, чтобы подсмотреть слово<br /><small>убедись, что соседи не палят</small></span>}
          back={<span className="secret-word">{today.word.word}</span>}
        />
        <p className="hint">Вставь это слово в разговор 5 раз за день — и не спались.</p>
        {today.word.status ? (
          <div className="done-line">
            {today.word.status === 'done'
              ? '✓ Заявлено: сказал 5 раз. Верим на слово. +15'
              : '✗ Спалили. Честность — тоже добродетель.'}
          </div>
        ) : (
          <div className="btn-row">
            <button
              className="btn btn-jade"
              onClick={() => act(() => api('/day/word', { method: 'POST', body: { status: 'done' } }), '+15! Мастер разговорного жанра')}
            >
              Сказал 5 раз ✓
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => act(() => api('/day/word', { method: 'POST', body: { status: 'busted' } }), 'Записали. Бывает.')}
            >
              Меня спалили ✗
            </button>
          </div>
        )}
      </section>

      <section className="ticket ticket-jade">
        <div className="ticket-tag">Imposter Who? · выжил +30 · угадал +10</div>
        {!today.imposter.active ? (
          <p>Импостер сегодня спит: нужно минимум {today.imposter.minPlayers} игрока (сейчас {today.playersCount}).</p>
        ) : (
          <>
            <FlipCard
              front={<span>🎭 Тапни, чтобы узнать свою роль</span>}
              back={
                today.imposter.isImposter ? (
                  <span className="imposter-role">ТЫ ИМПОСТЕР<br /><small>не спались и пойми слово по намёкам</small></span>
                ) : (
                  <span className="secret-word">{today.imposter.word}</span>
                )
              }
            />
            <p className="hint">Обсуждайте слово намёками вживую. Кто сегодня подозрительно молчит?</p>
            <div className="vote-grid">
              {others.map((p) => (
                <button
                  key={p.id}
                  className={today.imposter.myVoteUserId === p.id ? 'btn btn-vote voted' : 'btn btn-vote'}
                  onClick={() => act(() => api('/day/vote-imposter', { method: 'POST', body: { targetUserId: p.id } }), `Подозрение пало на: ${p.name}`)}
                >
                  {today.imposter.myVoteUserId === p.id ? '👉 ' : ''}{p.name}
                </button>
              ))}
            </div>
            <p className="hint">Голосов сегодня: {today.imposter.votesTotal}. Итоги — завтра утром, с драмой.</p>
          </>
        )}
      </section>
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
        фото +5 · голос за твоё фото +7 · слово +15 · импостер выжил +30 · угадал импостера +10 · число N +N (до 30)
      </p>
    </div>
  );
}
