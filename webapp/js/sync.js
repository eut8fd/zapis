/* =========================================================
   Синхронизация с сервером
   ---------------------------------------------------------
   Два режима работы приложения.

   Демо (нет сервера, открыли файл с диска, GitHub Pages без API_BASE):
   данные живут в localStorage, у каждого устройства своя копия. Так было
   всегда, и так остаётся — демонстрация обязана открываться везде.

   Серверный режим: сервер — источник истины. На старте приложение
   получает своё состояние целиком (уже отфильтрованное по роли: клиент
   не видит чужих имён, мастер — денег), дальше любое изменение в S.data
   уходит на сервер разницей сущностей, а чужие изменения подтягиваются
   раз в полминуты и при возвращении на экран. Экраны про это не знают:
   они по-прежнему читают S.data и зовут функции store.js.

   Разница считается сравнением со снимком последнего известного
   серверу состояния: что поменялось — upsert, чего не стало — delete.
   Сервер может отказать (чужая запись, занятое время) — тогда локальная
   копия откатывается к серверной и человек видит причину.
   ========================================================= */
import { S, emit, onSave, allCompanies, setServerMode, DATA_COLS } from './store.js';
import { api, canAuth, ApiError } from './api.js';
import { BOT_USERNAME } from './config.js';

const PENDING_KEY = 'zapis.sync.pending';
const PULL_EVERY = 30000;

const st = {
  mode: 'demo', seq: 0, session: null, snapshot: null,
  pushTimer: null, pushing: false, dirty: false, pullTimer: null,
  lastError: '', failures: 0, warned: {},
};

export const isServer = () => st.mode === 'server';
export const session = () => st.session;
export const serverInfo = () => (st.session && st.session.server) || {};
/** Имя бота для ссылок: в серверном режиме его знает сервер, в демо — config.js. */
export const botName = () => serverInfo().botUsername || BOT_USERNAME;
export const syncState = () => ({ mode: st.mode, seq: st.seq, dirty: st.dirty, pushing: st.pushing, lastError: st.lastError });

/* ---------------- подключение ---------------- */

/**
 * Попробовать войти на сервер. Возвращает сессию (identity, membership,
 * данные) либо null — тогда приложение работает в демо-режиме.
 */
export async function connect(start) {
  if (!canAuth()) return null;
  let ping;
  try { ping = await api.ping(); } catch (e) { return null; }
  if (!ping || !ping.auth) return null;
  try {
    const s = await api.boot(start);
    if (!s || !s.ok) return null;
    return s;
  } catch (e) {
    // 401 — initData не прошёл: ошибка подписи или сервер без токена.
    // Это не повод падать: демо-режим покажет интерфейс, а баннер — причину.
    st.lastError = e && e.message ? e.message : String(e);
    console.warn('boot failed', e);
    return null;
  }
}

/** Принять состояние с сервера как своё. */
export function adopt(sessionPayload) {
  st.mode = 'server';
  st.session = { ...sessionPayload };
  delete st.session.data;
  st.seq = sessionPayload.seq || 0;
  const data = sessionPayload.data || {};
  const next = {};
  DATA_COLS.forEach(k => { next[k] = Array.isArray(data[k]) ? data[k] : []; });
  S.data = next;
  takeSnapshot();
  setServerMode(true);
  startPolling();
}

/* ---------------- снимок и разница ---------------- */
function takeSnapshot() {
  const snap = {};
  DATA_COLS.forEach(col => {
    const m = new Map();
    (S.data[col] || []).forEach(e => { if (e && e.id) m.set(e.id, JSON.stringify(e)); });
    snap[col] = m;
  });
  st.snapshot = snap;
}

function diff() {
  const upsert = {}, del = {};
  let n = 0;
  DATA_COLS.forEach(col => {
    const prev = (st.snapshot && st.snapshot[col]) || new Map();
    const seen = new Set();
    (S.data[col] || []).forEach(e => {
      if (!e || !e.id) return;
      seen.add(e.id);
      const js = JSON.stringify(e);
      if (prev.get(e.id) !== js) { (upsert[col] = upsert[col] || []).push(e); n++; }
    });
    prev.forEach((_, id) => { if (!seen.has(id)) { (del[col] = del[col] || []).push(id); n++; } });
  });
  return { upsert, delete: del, n };
}

/* ---------------- отправка ---------------- */
onSave(() => { if (st.mode === 'server') schedulePush(); });

export function schedulePush(delay = 400) {
  st.dirty = true;
  clearTimeout(st.pushTimer);
  st.pushTimer = setTimeout(() => { pushNow().catch(() => { }); }, delay);
}

/**
 * Отправить накопившиеся изменения сейчас. Возвращает список отказов —
 * вызывающий решает, что показать (запись клиента ждёт ответа сервера
 * до экрана «Готово», а не после).
 */
export async function pushNow() {
  if (st.mode !== 'server') return [];
  if (st.pushing) {
    // идёт отправка — дождёмся и отправим остаток следующим заходом
    await new Promise(r => setTimeout(r, 250));
    return pushNow();
  }
  clearTimeout(st.pushTimer);
  const d = diff();
  const pending = readPending();
  if (!d.n && !pending) { st.dirty = false; return []; }
  const payload = pending ? mergePending(pending, d) : { upsert: d.upsert, delete: d.delete };
  payload.since = st.seq;
  // Что именно ушло: сервер мог поправить эти сущности (цена по прайсу,
  // имя владельца из Telegram, срок подписки), и его версию надо принять —
  // если за время запроса человек не поменял сущность ещё раз.
  const pushed = {};
  Object.keys(payload.upsert || {}).forEach(col => payload.upsert[col].forEach(e => { pushed[col + ':' + e.id] = JSON.stringify(e); }));
  st.pushing = true;
  try {
    const r = await api.push(payload);
    clearPending();
    st.failures = 0;
    st.lastError = '';
    const rejected = r.rejected || [];
    rejected.forEach(x => revert(x));
    applyChanges(r.changes || [], pushed);
    st.seq = r.seq || st.seq;
    // Снимок обновляем только для того, что ушло и что пришло: правка,
    // сделанная пока шёл запрос, остаётся «грязной» и уйдёт следующей.
    // Полный снимок здесь молча хоронил бы такую правку.
    commitSnapshot(payload, pushed, rejected);
    st.dirty = diff().n > 0;
    if (st.dirty) schedulePush(200);
    if (rejected.length) warn(rejected);
    if (rejected.length || (r.changes || []).length) emit();
    return rejected;
  } catch (e) {
    st.failures++;
    st.lastError = e && e.message ? e.message : String(e);
    // Нет сети — изменения не теряем: лежат в localStorage до следующей попытки,
    // переживают и перезагрузку приложения.
    if (!(e instanceof ApiError) || e.status >= 500 || e.status === 429) {
      savePending(payload);
      clearTimeout(st.pushTimer);
      st.pushTimer = setTimeout(() => { pushNow().catch(() => { }); }, Math.min(60000, 3000 * st.failures));
    } else if (e.status === 401) {
      // сессия протухла (initData живёт сутки) — просим открыть заново
      toastOnce('auth', 'Сессия истекла — откройте приложение заново из Telegram');
    } else {
      toastOnce('err', e.message);
    }
    return [];
  } finally { st.pushing = false; }
}

/** Снимок после удачной отправки: отправленное — как отправили, отказанное —
    как у сервера, удалённое — забыто. Остальное не трогаем. */
function commitSnapshot(payload, pushed, rejected) {
  if (!st.snapshot) return;
  const bad = new Set(rejected.map(x => x.col + ':' + x.id));
  Object.keys(pushed).forEach(key => {
    if (bad.has(key)) return;
    const [col, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (st.snapshot[col]) st.snapshot[col].set(id, pushed[key]);
  });
  Object.keys(payload.delete || {}).forEach(col => {
    (payload.delete[col] || []).forEach(id => { if (st.snapshot[col] && !bad.has(col + ':' + id)) st.snapshot[col].delete(id); });
  });
  rejected.forEach(({ col, id, server }) => {
    if (!st.snapshot[col]) return;
    if (server) st.snapshot[col].set(id, JSON.stringify(server)); else st.snapshot[col].delete(id);
  });
}

/** Отказ сервера: вернуть сущность к серверному виду или убрать совсем. */
function revert({ col, id, server }) {
  const list = S.data[col];
  if (!Array.isArray(list)) return;
  const i = list.findIndex(e => e && e.id === id);
  if (server) { if (i >= 0) list[i] = server; else list.push(server); }
  else if (i >= 0) list.splice(i, 1);
}

function warn(rejected) {
  const reasons = Array.from(new Set(rejected.map(x => x.reason).filter(Boolean)));
  import('./ui.js').then(u => {
    u.toast('Не сохранено: ' + reasons.slice(0, 2).join('; '), 'dan');
  }).catch(() => { });
}

function toastOnce(key, msg) {
  const now = Date.now();
  if (st.warned[key] && now - st.warned[key] < 60000) return;
  st.warned[key] = now;
  import('./ui.js').then(u => u.toast(msg, 'dan')).catch(() => { });
}

/* ---------------- приём чужих изменений ---------------- */
function applyChanges(changes, pushed = {}) {
  if (!changes || !changes.length) return 0;
  const cur = diff();           // то, что ещё не ушло, сервер перебивать не должен
  const dirty = new Set();
  Object.keys(cur.upsert).forEach(col => cur.upsert[col].forEach(e => {
    const key = col + ':' + e.id;
    // только что отправленное и не тронутое с тех пор — не «грязное»:
    // серверная версия для него главнее
    if (pushed[key] && pushed[key] === JSON.stringify(e)) return;
    dirty.add(key);
  }));
  let n = 0;
  changes.forEach(ch => {
    const col = ch.col;
    if (!DATA_COLS.includes(col)) return;
    if (dirty.has(col + ':' + ch.id)) return;
    const list = S.data[col] = S.data[col] || [];
    const i = list.findIndex(e => e && e.id === ch.id);
    if (ch.deleted) {
      if (i >= 0) { list.splice(i, 1); n++; }
      if (st.snapshot) st.snapshot[col].delete(ch.id);
      return;
    }
    const js = JSON.stringify(ch.body);
    if (i >= 0) { if (JSON.stringify(list[i]) !== js) { list[i] = ch.body; n++; } }
    else { list.push(ch.body); n++; }
    if (st.snapshot) st.snapshot[col].set(ch.id, js);
  });
  return n;
}

export async function pull() {
  if (st.mode !== 'server' || st.pushing) return 0;
  try {
    const r = await api.changes(st.seq);
    const n = applyChanges(r.changes || []);
    st.seq = r.seq || st.seq;
    st.failures = 0;
    if (n) emit();
    return n;
  } catch (e) {
    return 0;
  }
}

let polling = false;
function startPolling() {
  if (polling) return;
  polling = true;
  const tick = () => { if (document.visibilityState === 'visible') pull(); };
  st.pullTimer = setInterval(tick, PULL_EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { pushNow().then(() => pull()).catch(() => { }); }
  });
  window.addEventListener('online', () => { pushNow().then(() => pull()).catch(() => { }); });
  window.addEventListener('pagehide', () => { if (st.dirty) savePending(diff()); });
}

/* ---------------- неотправленное между перезапусками ---------------- */
function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { return null; }
}
function savePending(p) {
  try {
    if (!p || (!Object.keys(p.upsert || {}).length && !Object.keys(p.delete || {}).length)) return;
    localStorage.setItem(PENDING_KEY, JSON.stringify({ upsert: p.upsert || {}, delete: p.delete || {} }));
  } catch (e) { }
}
function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) { } }
function mergePending(p, d) {
  const upsert = {}, del = {};
  [p, d].forEach(x => {
    Object.keys(x.upsert || {}).forEach(col => {
      upsert[col] = upsert[col] || [];
      x.upsert[col].forEach(e => {
        const i = upsert[col].findIndex(y => y.id === e.id);
        if (i >= 0) upsert[col][i] = e; else upsert[col].push(e);
      });
    });
    Object.keys(x.delete || {}).forEach(col => {
      del[col] = Array.from(new Set([...(del[col] || []), ...x.delete[col]]));
    });
  });
  return { upsert, delete: del };
}

/** Есть ли что-то, что не дошло до сервера с прошлого запуска. */
export const hasPending = () => !!readPending();

/* ---------------- приглашения (с любого устройства) ---------------- */
export async function fetchInvite(id) {
  if (st.mode !== 'server') return null;
  try {
    const r = await api.invite(id);
    if (!r || !r.ok) return { state: (r && r.state) || 'нет' };
    // компании приглашения у человека в данных нет — подкладываем публичную
    // карточку, чтобы экран мог показать название и логотип
    if (r.company && r.company.id && !allCompanies().some(c => c.id === r.company.id)) {
      S.data.companies.push(r.company);
      if (st.snapshot) st.snapshot.companies.set(r.company.id, JSON.stringify(r.company));
    }
    return { state: r.state, invite: r.invite, company: r.company };
  } catch (e) { return { state: 'нет' }; }
}

export async function acceptInviteOnServer(id, person) {
  const r = await api.acceptInvite(id, person);
  if (r && r.ok && r.session) adopt(r.session);
  return r;
}

