import { buildSeed } from './seed.js';
import { startOfDay, dayKey, pad } from './ui.js';
import { applyLang, lang, t as tr } from './i18n.js';

const KEY = 'zapis.demo.v2';
const VER = 15;

// homeId, person и clientIds появились вместе с каталогом — см. блок
// «Клиент: свой салон, личность и каталог» ниже.
const SESSION = () => ({
  role: 'owner', companyId: 'c1', employeeId: 'c1_owner', clientId: 'c1_cl1',
  homeId: null, person: null, clientIds: {},
});

export const S = {
  v: VER, anchor: null, shift: 0, theme: 'auto', lang: 'ru', aiMode: 'demo', onboarded: true,
  session: SESSION(),
  data: null, aiChat: {}, seenTips: {},
};

/* ---------- подписки ---------- */
const subs = new Set();
export const sub = fn => { subs.add(fn); return () => subs.delete(fn); };
let saveTimer = null;
export function emit() {
  subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 120);
}

/* ---------- время демо ---------- */
export const now = () => new Date(Date.now() + S.shift);
export const today = () => startOfDay(now());
export function setShift(ms) { S.shift = ms; emit(); }
export function shiftBy(ms) { S.shift += ms; emit(); }

/* ---------- persist ---------- */
let quotaWarned = false;
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VER, anchor: S.anchor, shift: S.shift, theme: S.theme, lang: S.lang, aiMode: S.aiMode, onboarded: S.onboarded, session: S.session, data: S.data, aiChat: S.aiChat, seenTips: S.seenTips }));
    quotaWarned = false;
  } catch (e) {
    console.warn('save failed', e);
    // Молчать нельзя: изменения останутся только на экране и пропадут
    // при перезагрузке. Чаще всего виноваты фотографии — о них и говорим.
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    if (!quotaWarned) {
      quotaWarned = true;
      import('./ui.js').then(u => u.toast(
        quota ? 'Не хватает места в браузере — удалите часть фотографий' : 'Не удалось сохранить изменения', 'dan'
      )).catch(() => { });
    }
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function shiftTree(node, ms) {
  if (Array.isArray(node)) { node.forEach(n => shiftTree(n, ms)); return; }
  if (node && typeof node === 'object') {
    for (const k in node) {
      const v = node[k];
      if (typeof v === 'string' && ISO.test(v)) node[k] = new Date(new Date(v).getTime() + ms).toISOString();
      else if (v && typeof v === 'object') shiftTree(v, ms);
    }
  }
}

export function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
  if (!raw || raw.v !== VER || !raw.data) { reset(false); applyLang(S.lang); return; }
  Object.assign(S, raw);
  applyLang(S.lang);
  // Демо всегда «свежее»: переносим данные на текущий день
  const a = startOfDay(new Date(S.anchor));
  const t = startOfDay(new Date());
  const diff = Math.round((t - a) / 86400000);
  if (diff !== 0) { shiftTree(S.data, diff * 86400000); S.anchor = t.toISOString(); }
  autoComplete();
}

export function reset(doEmit = true) {
  const t = startOfDay(new Date());
  S.anchor = t.toISOString();
  S.shift = 0;
  S.data = buildSeed(t);
  S.session = SESSION();
  S.data.invites = S.data.invites || [];
  S.aiChat = {}; S.onboarded = true; S.seenTips = {};
  S.lang = lang();
  autoComplete();
  if (doEmit) emit(); else save();
}

// Записи, закончившиеся более 2 часов назад, автоматически считаем выполненными
export function autoComplete() {
  const n = now().getTime();
  let ch = 0;
  S.data.appointments.forEach(a => {
    if (a.status !== 'planned') return;
    const end = new Date(a.start).getTime() + a.duration * 60000;
    if (end < n - 2 * 3600000) { a.status = 'done'; ch++; }
  });
  return ch;
}

/** Язык интерфейса. Настройка устройства, а не компании: у владельца
    и у клиента на одном телефоне он один. */
export function setLang(id) {
  if (!applyLang(id)) return;
  S.lang = id;
  emit();
}

/* ---------- селекторы ---------- */
export const D = () => S.data;
export const cid = () => S.session.companyId;
export const co = (id = cid()) => S.data.companies.find(c => c.id === id);
export const allCompanies = () => S.data.companies;
export const emps = (id = cid()) => S.data.employees.filter(e => e.companyId === id && e.active !== false);
export const staff = (id = cid()) => emps(id).filter(e => e.takesAppointments);
export const emp = eid => S.data.employees.find(e => e.id === eid);
export const svcs = (id = cid()) => S.data.services.filter(s => s.companyId === id && s.active !== false);
export const svc = sid => S.data.services.find(s => s.id === sid);
export const clients = (id = cid()) => S.data.clients.filter(c => c.companyId === id);
export const client = cl => S.data.clients.find(c => c.id === cl);
export const appts = (id = cid()) => S.data.appointments.filter(a => a.companyId === id);
export const appt = aid => S.data.appointments.find(a => a.id === aid);
export const reviews = (id = cid()) => S.data.reviews.filter(r => r.companyId === id);
export const broadcasts = (id = cid()) => S.data.broadcasts.filter(b => b.companyId === id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
export const blocks = (id = cid()) => S.data.blocks.filter(b => b.companyId === id);

export const me = () => S.session.role === 'client' ? client(S.session.clientId) : emp(S.session.employeeId);
export const isOwner = () => S.session.role === 'owner';
export const isEmployee = () => S.session.role === 'employee';
/** Администратор — сотрудник, которому открыт весь салон. */
export const isManager = () => S.session.role === 'employee' && can('allCalendar');

export function apptEnd(a) { return new Date(new Date(a.start).getTime() + a.duration * 60000); }
export function apptTitle(a) { return (a.serviceIds || []).map(id => (svc(id) || {}).name).filter(Boolean).join(' + ') || 'Услуга'; }
export function apptColor(a) { const s = svc((a.serviceIds || [])[0]); return s ? s.color : '#4C6FFF'; }

export function dayAppts(date, { employeeId = null, companyId = cid(), includeCancelled = false } = {}) {
  const k = dayKey(date);
  return appts(companyId)
    .filter(a => dayKey(new Date(a.start)) === k)
    .filter(a => includeCancelled || a.status !== 'cancelled')
    .filter(a => !employeeId || a.employeeId === employeeId)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function clientAppts(clientId) {
  return S.data.appointments.filter(a => a.clientId === clientId).sort((a, b) => new Date(b.start) - new Date(a.start));
}
export function clientStats(clientId) {
  const list = clientAppts(clientId);
  const done = list.filter(a => a.status === 'done');
  const spent = done.reduce((s, a) => s + a.price, 0);
  const next = list.filter(a => a.status === 'planned' && new Date(a.start) > now()).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  const last = done[0];
  return { visits: done.length, spent, avg: done.length ? Math.round(spent / done.length) : 0, next, last, all: list };
}

/* =========================================================
   Клиент: свой салон и личность
   ---------------------------------------------------------
   Клиент живёт ровно в одном салоне — том, чью ссылку он открыл
   (?start=c1). Каталога и поиска чужих салонов в приложении нет:
   приложение салона принадлежит салону, и уводить из него клиента
   ему некуда.

   homeId ставится один раз и дальше не меняется. Личность (person)
   живёт в сессии отдельно от карточки клиента: карточка принадлежит
   компании, и заводится она только при первой записи — от простого
   просмотра страницы салон не должен получать клиента. clientIds —
   карта «салон → карточка»; она пережила каталог, потому что в базе
   тестировщика ещё могут лежать записи из двух салонов.
   ========================================================= */
export const homeId = () => S.session.homeId || null;
export const homeCo = () => (homeId() ? co(homeId()) : null);
export const isBound = () => !!homeCo();

export const person = () => S.session.person || null;

/** Личность: из Telegram, если приложение открыто из бота, иначе просто имя.
    `tg` — username для ссылки t.me, `tgId` — числовой id: только по нему бот
    может узнать человека и показать ему запись, сделанную здесь. */
export function ensurePerson(name, ids = {}) {
  const p = S.session.person;
  if (p) {
    // Личность могла завестись раньше, чем стал известен telegram-id:
    // сессия переживает перезагрузку, а id появляется только внутри Telegram.
    if (ids.tgId && !p.tgId) p.tgId = String(ids.tgId);
    if (ids.tg && !p.tg) p.tg = String(ids.tg);
    return p;
  }
  const nm = String(name || '').trim() || 'Гость';
  S.session.person = {
    name: nm, phone: '', initials: initialsOf(nm), color: '#4C6FFF',
    tg: ids.tg ? String(ids.tg) : '',
    tgId: ids.tgId ? String(ids.tgId) : '',
  };
  return S.session.person;
}

const initialsOf = n => String(n || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** Привязать клиента к салону и взять личность из его карточки там. */
export function setHome(companyId) {
  const c = co(companyId);
  if (!c) return;
  S.session.homeId = companyId;
  S.session.companyId = companyId;
  const rec = myClient(companyId) || clients(companyId)[0];
  if (rec) {
    S.session.clientIds = { ...(S.session.clientIds || {}), [companyId]: rec.id };
    S.session.clientId = rec.id;
    if (!S.session.person) S.session.person = { name: rec.name, phone: rec.phone, initials: rec.initials, color: rec.color, tg: rec.tg || '' };
  }
}

/** Открыть салон на просмотр, не трогая привязку. */
export function viewCompany(companyId) {
  if (!co(companyId)) return;
  S.session.companyId = companyId;
  const rec = myClient(companyId);
  S.session.clientId = rec ? rec.id : null;
}

/** Карточка этого человека в компании; null — он там ещё не записывался. */
export function myClient(companyId = cid()) {
  const id = (S.session.clientIds || {})[companyId];
  return id ? client(id) : null;
}

/** Та же карточка, но заводится, если её ещё нет. Зовётся при записи. */
export function ensureMyClient(companyId = cid()) {
  const p = person() || {};
  const has = myClient(companyId);
  if (has) {
    // Карточка могла появиться до того, как приложение узнало telegram-id.
    // Без него бот не свяжет запись с человеком и покажет «записей нет».
    if (p.tgId && !has.tgId) has.tgId = String(p.tgId);
    return has;
  }
  const name = p.name || 'Гость';
  const rec = {
    id: uid('cl_'), companyId, name, phone: p.phone || '', tg: p.tg || '',
    tgId: p.tgId || '',
    initials: p.initials || initialsOf(name), color: p.color || '#4C6FFF',
    createdAt: now().toISOString(), note: '', ai: null, tags: [],
  };
  S.data.clients.push(rec);
  S.session.clientIds = { ...(S.session.clientIds || {}), [companyId]: rec.id };
  if (companyId === cid()) S.session.clientId = rec.id;
  return rec;
}

/** Имя и телефон меняются сразу во всех салонах — это один человек. */
export function updatePerson(patch) {
  S.session.person = { ...(S.session.person || {}), ...patch };
  if (patch.name) S.session.person.initials = initialsOf(patch.name);
  Object.values(S.session.clientIds || {}).forEach(id => {
    const c = client(id);
    if (c) Object.assign(c, { name: S.session.person.name, phone: S.session.person.phone, initials: S.session.person.initials });
  });
  emit();
}

/** Все записи человека — по всем салонам сразу, свежие первыми. */
export function myAppts() {
  const ids = Object.values(S.session.clientIds || {});
  if (!ids.length) return [];
  return S.data.appointments.filter(a => ids.includes(a.clientId))
    .sort((a, b) => new Date(b.start) - new Date(a.start));
}

export function myStats() {
  const list = myAppts();
  const done = list.filter(a => a.status === 'done');
  const next = list.filter(a => a.status === 'planned' && new Date(a.start) > now())
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  return { visits: done.length, next, last: done[0], all: list };
}

/* ---------- справочник салонов ----------
   Каталога для клиента в приложении нет: человек попадает в салон только
   по его ссылке и другие салоны увидеть не может. Справочник остался
   для бота — он читает оттуда названия, услуги и контакты, чтобы
   отрисовать страницу салона по присланной ссылке (см. sync.js).
------------------------------------------- */

/* Заготовки, которые онбординг подставляет вместо адреса и телефона.
   Держим их здесь, а не строкой в двух местах: по ним же проверяется,
   дозаполнил ли владелец карточку. */
export const ADDR_TODO = 'Укажите адрес в настройках';
export const PHONE_TODO = '+7 700 000 00 00';

/**
 * Готова ли компания показываться посторонним.
 * Свежесозданная компания — это ещё не салон: у неё заготовка вместо адреса
 * и телефона. Пускать её в каталог нельзя — клиент придёт по адресу
 * «Укажите адрес в настройках».
 */
export function catalogReady(c) {
  if (!c || c.status === 'blocked') return false;
  if (!svcs(c.id).length || !staff(c.id).length) return false;
  const addr = String(c.addr || '').trim();
  const phone = String(c.phone || '').trim();
  return !!addr && addr !== ADDR_TODO && !!phone && phone !== PHONE_TODO;
}

/** Чего не хватает компании до публикации — для подсказки владельцу. */
export function catalogMissing(c = co()) {
  const out = [];
  if (!c) return out;
  if (!svcs(c.id).length) out.push('услуги');
  if (!staff(c.id).length) out.push('мастера');
  const addr = String(c.addr || '').trim();
  if (!addr || addr === ADDR_TODO) out.push('адрес');
  const phone = String(c.phone || '').trim();
  if (!phone || phone === PHONE_TODO) out.push('телефон');
  return out;
}

export function catalogCompanies() {
  return allCompanies().filter(catalogReady);
}

export function nextAppt(companyId = cid(), employeeId = null) {
  const n = now();
  return appts(companyId)
    .filter(a => a.status === 'planned' && new Date(a.start) > n)
    .filter(a => !employeeId || a.employeeId === employeeId)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
}

/* ---------- расписание и слоты ---------- */
export const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
export const toHM = min => pad(Math.floor(min / 60)) + ':' + pad(min % 60);

export function workDay(e, date) {
  const s = e.schedule && e.schedule[date.getDay()];
  if (!s || !s.on) return null;
  return s;
}
export function companyHours(date, id = cid()) {
  const c = co(id); const s = c && c.hours && c.hours[date.getDay()];
  return s && s.on ? s : null;
}

/** Рабочее окно мастера, обрезанное часами салона (§37).
    Мастер физически не может принимать, когда салон закрыт, поэтому
    расписание считается по пересечению двух графиков, а не по одному.
    clipped — признак того, что график мастера шире салона: по нему
    интерфейс показывает предупреждение владельцу. */
export function workWindow(e, date, companyId = cid()) {
  const w = workDay(e, date); if (!w) return null;
  const c = co(companyId);
  const ch = c && c.hours ? c.hours[date.getDay()] : null;
  if (ch && !ch.on) return null;              // салон закрыт — записей нет
  let from = toMin(w.from), to = toMin(w.to);
  let clipped = false;
  if (ch && ch.on) {
    const cf = toMin(ch.from), ct = toMin(ch.to);
    if (cf > from) { from = cf; clipped = true; }
    if (ct < to) { to = ct; clipped = true; }
  }
  if (to - from < 5) return null;             // окно схлопнулось
  return { on: true, from: toHM(from), to: toHM(to), breaks: w.breaks || [], clipped };
}

/** Конфликты графиков мастеров с часами салона — для предупреждений (§37). */
export function scheduleConflicts(companyId = cid()) {
  const c = co(companyId); if (!c || !c.hours) return [];
  const out = [];
  staff(companyId).forEach(e => {
    for (let d = 0; d < 7; d++) {
      const w = e.schedule && e.schedule[d];
      if (!w || !w.on) continue;
      const ch = c.hours[d];
      if (!ch || !ch.on) { out.push({ emp: e, day: d, kind: 'closed' }); continue; }
      if (toMin(w.from) < toMin(ch.from) || toMin(w.to) > toMin(ch.to)) {
        out.push({ emp: e, day: d, kind: 'wider', empFrom: w.from, empTo: w.to, coFrom: ch.from, coTo: ch.to });
      }
    }
  });
  return out;
}

export function busyFor(empId, date, companyId = cid()) {
  const k = dayKey(date);
  const out = appts(companyId)
    .filter(a => a.employeeId === empId && a.status !== 'cancelled' && dayKey(new Date(a.start)) === k)
    .map(a => { const s = new Date(a.start); return { s: s.getHours() * 60 + s.getMinutes(), e: s.getHours() * 60 + s.getMinutes() + a.duration, id: a.id }; });
  blocks(companyId).filter(b => (b.employeeId === empId || !b.employeeId) && dayKey(new Date(b.start)) === k)
    .forEach(b => { const s = new Date(b.start), e = new Date(b.end); out.push({ s: s.getHours() * 60 + s.getMinutes(), e: e.getHours() * 60 + e.getMinutes(), block: true }); });
  return out;
}

export function slotFree(empId, date, startMin, duration, companyId = cid(), ignoreId = null) {
  const e = emp(empId); if (!e) return false;
  const w = workWindow(e, date, companyId); if (!w) return false;
  const from = toMin(w.from), to = toMin(w.to);
  if (startMin < from || startMin + duration > to) return false;
  for (const b of (w.breaks || [])) {
    if (startMin < toMin(b.to) && startMin + duration > toMin(b.from)) return false;
  }
  for (const b of busyFor(empId, date, companyId)) {
    if (b.id && b.id === ignoreId) continue;
    if (startMin < b.e && startMin + duration > b.s) return false;
  }
  const n = now();
  if (dayKey(date) === dayKey(n)) {
    const cur = n.getHours() * 60 + n.getMinutes();
    if (startMin < cur + 10) return false;
  }
  if (startOfDay(date) < startOfDay(n)) return false;
  return true;
}

export function slotsFor(empIds, date, duration, { step = 30, companyId = cid(), ignoreId = null } = {}) {
  const list = empIds.map(emp).filter(Boolean);
  const days = list.map(e => workWindow(e, date, companyId)).filter(Boolean);
  if (!days.length) return [];
  const from = Math.min(...days.map(d => toMin(d.from)));
  const to = Math.max(...days.map(d => toMin(d.to)));
  const out = [];
  for (let m = Math.ceil(from / step) * step; m + duration <= to; m += step) {
    const who = list.find(e => slotFree(e.id, date, m, duration, companyId, ignoreId));
    out.push({ min: m, t: toHM(m), free: !!who, empId: who ? who.id : null });
  }
  return out;
}

export function nextFreeFor(empId, duration, companyId = cid(), maxDays = 14) {
  const base = today();
  for (let d = 0; d < maxDays; d++) {
    const date = new Date(base.getTime() + d * 86400000);
    const s = slotsFor([empId], date, duration, { companyId }).find(x => x.free);
    if (s) return { date, slot: s };
  }
  return null;
}

export function freeGaps(date, empId, companyId = cid(), minLen = 60) {
  const e = emp(empId); const w = e && workWindow(e, date, companyId); if (!w) return [];
  const from = toMin(w.from), to = toMin(w.to);
  const busy = busyFor(empId, date, companyId).concat((w.breaks || []).map(b => ({ s: toMin(b.from), e: toMin(b.to) })))
    .sort((a, b) => a.s - b.s);
  const gaps = []; let cur = from;
  busy.forEach(b => { if (b.s - cur >= minLen) gaps.push({ s: cur, e: b.s }); cur = Math.max(cur, b.e); });
  if (to - cur >= minLen) gaps.push({ s: cur, e: to });
  return gaps;
}

/* ---------- действия ---------- */
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function createAppointment({ clientId, employeeId, serviceIds, start, note = '', source = 'owner', companyId = cid() }) {
  const list = serviceIds.map(svc).filter(Boolean);
  const a = {
    id: uid('ap_'), companyId, clientId, employeeId, serviceIds,
    start: new Date(start).toISOString(),
    duration: list.reduce((s, x) => s + x.duration, 0) || 60,
    price: list.reduce((s, x) => s + x.price, 0),
    status: 'planned', note, source, createdAt: now().toISOString(),
  };
  S.data.appointments.push(a);
  emit();
  return a;
}
export function cancelAppointment(id, by = 'owner') {
  const a = appt(id); if (!a || a.status !== 'planned') return false;
  a.status = 'cancelled'; a.cancelledBy = by; a.cancelledAt = now().toISOString();
  emit();
  return true;
}
export function completeAppointment(id) {
  const a = appt(id); if (!a) return;
  a.status = 'done'; a.completedAt = now().toISOString();
  emit();
}
export function restoreAppointment(id) { const a = appt(id); if (a) { a.status = 'planned'; emit(); } }
export function moveAppointment(id, start, employeeId) {
  const a = appt(id); if (!a) return;
  a.start = new Date(start).toISOString();
  if (employeeId) a.employeeId = employeeId;
  a.status = 'planned';
  emit();
}
export function setApptNote(id, note) { const a = appt(id); if (a) { a.note = note; emit(); } }

export function createClient({ name, phone = '', tg = '', companyId = cid() }) {
  const AVc = ['#4C6FFF', '#8B5CF6', '#F04462', '#F79009', '#12B76A', '#06AED4', '#EC4899'];
  const c = {
    id: uid('cl_'), companyId, name, phone, tg,
    initials: name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
    color: AVc[Math.floor(Math.random() * AVc.length)], createdAt: now().toISOString(), note: '', ai: null, tags: [],
  };
  S.data.clients.push(c); emit(); return c;
}
export function updateClient(id, patch) { const c = client(id); if (c) { Object.assign(c, patch); emit(); } }

export function createService({ name, price, duration, employeeIds, companyId = cid(), cat = 'nails' }) {
  const s = {
    id: uid('s_'), companyId, name, price: +price, duration: +duration, cat,
    color: catInfo(cat, companyId).color, active: true, buffer: 0, desc: '', photo: null,
    employeeIds: employeeIds && employeeIds.length ? employeeIds : staff(companyId).map(e => e.id),
  };
  S.data.services.push(s);
  s.employeeIds.forEach(id => { const e = emp(id); if (e && !e.serviceIds.includes(s.id)) e.serviceIds.push(s.id); });
  emit(); return s;
}
export function updateService(id, patch) {
  const s = svc(id); if (!s) return;
  Object.assign(s, patch);
  if (patch.employeeIds) {
    S.data.employees.filter(e => e.companyId === s.companyId).forEach(e => {
      const has = patch.employeeIds.includes(e.id);
      e.serviceIds = e.serviceIds.filter(x => x !== id);
      if (has) e.serviceIds.push(id);
    });
  }
  emit();
}
export function deleteService(id) {
  const s = svc(id); if (!s) return;
  s.active = false; emit();
}

export function createEmployee({ name, role, phone = '', serviceIds = [], companyId = cid() }) {
  const AVc = ['#4C6FFF', '#8B5CF6', '#F04462', '#F79009', '#12B76A', '#06AED4'];
  const e = {
    id: uid('e_'), companyId, name, role, phone, active: true, takesAppointments: true,
    initials: name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
    color: AVc[Math.floor(Math.random() * AVc.length)],
    schedule: JSON.parse(JSON.stringify(emps(companyId)[0].schedule)),
    serviceIds: serviceIds.length ? serviceIds : svcs(companyId).map(s => s.id),
    access: 'staff', rating: '5.0',
    photo: null, since: null, showExp: true,
  };
  S.data.employees.push(e);
  e.serviceIds.forEach(sid => { const s = svc(sid); if (s && !s.employeeIds.includes(e.id)) s.employeeIds.push(e.id); });
  emit(); return e;
}
export function updateEmployee(id, patch) {
  const e = emp(id); if (!e) return;
  Object.assign(e, patch);
  if (patch.serviceIds) {
    svcs(e.companyId).forEach(s => {
      s.employeeIds = s.employeeIds.filter(x => x !== id);
      if (patch.serviceIds.includes(s.id)) s.employeeIds.push(id);
    });
  }
  emit();
}
export function removeEmployee(id) { const e = emp(id); if (e) { e.active = false; emit(); } }

/**
 * Есть ли за карточкой сотрудника живой человек.
 *
 * Карточка и человек — разные вещи: карточку заводит владелец, чтобы
 * появился график и было кого ставить в записи, а доступ в приложение
 * человек получает только по приглашению. Раньше интерфейс их не различал,
 * и было непонятно, почему «сотрудник есть», а уведомления ему не приходят.
 *   linked  — вошёл по ссылке, доступ есть
 *   invited — ссылка выписана и ещё жива
 *   none    — карточка ничья
 */
export function employeeAccess(e) {
  if (!e) return 'none';
  if (e.isOwner || e.linkedAt) return 'linked';
  const live = (S.data.invites || []).some(
    i => i.companyId === e.companyId && i.employeeId === e.id && inviteState(i) === 'активна',
  );
  return live ? 'invited' : 'none';
}

// Причины отсутствия. allDay — занимает весь рабочий день,
// многодневные (отпуск, больничный) разворачиваются в блок на каждый день.
export const ABSENCE = {
  break: { t: 'Перерыв', color: '#F79009', icon: 'coffee' },
  busy: { t: 'Личные дела', color: '#8B5CF6', icon: 'lock' },
  vacation: { t: 'Отпуск', color: '#06AED4', icon: 'gift' },
  sick: { t: 'Больничный', color: '#F04462', icon: 'alert' },
  dayoff: { t: 'Выходной', color: '#7C8AA5', icon: 'moon' },
  other: { t: 'Другое', color: '#64748B', icon: 'dots' },
};

export function addBlock({ employeeId, start, end, reason = 'Перерыв', kind = 'break', allDay = false, companyId = cid() }) {
  const b = {
    id: uid('bl_'), companyId, employeeId, kind, allDay,
    start: new Date(start).toISOString(), end: new Date(end).toISOString(), reason,
  };
  S.data.blocks.push(b);
  emit();
  return b;
}

/** Отсутствие на диапазон дней — по блоку на каждый день (§53, §54). */
/**
 * Записи мастера, попадающие в отрезок. По ним проверяют, можно ли
 * занять время: блокировка поверх живой записи — это клиент, который
 * придёт к закрытой двери.
 */
export function apptsInRange(employeeId, from, to, companyId = cid()) {
  const a0 = new Date(from).getTime(), b0 = new Date(to).getTime();
  return appts(companyId)
    .filter(a => a.employeeId === employeeId && a.status === 'planned')
    .filter(a => {
      const s0 = new Date(a.start).getTime();
      return s0 < b0 && s0 + a.duration * 60000 > a0;
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function addAbsence({ employeeId, from, to, kind = 'vacation', companyId = cid() }) {
  const label = (ABSENCE[kind] || ABSENCE.other).t;
  const a = startOfDay(new Date(from)), b = startOfDay(new Date(to));
  const out = [];
  for (let d = new Date(a); d <= b; d = new Date(d.getTime() + 86400000)) {
    const e = emp(employeeId);
    const w = e && e.schedule && e.schedule[d.getDay()];
    const from_ = w && w.on ? toMin(w.from) : 9 * 60;
    const to_ = w && w.on ? toMin(w.to) : 20 * 60;
    out.push({
      id: uid('bl_'), companyId, employeeId, kind, allDay: true, reason: label,
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(from_ / 60), from_ % 60).toISOString(),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(to_ / 60), to_ % 60).toISOString(),
    });
  }
  S.data.blocks.push(...out);
  emit();
  return out;
}

/** Отсутствия сотрудника на дату (для календаря и расписания). */
export function absenceOn(date, employeeId, companyId = cid()) {
  const k = dayKey(date);
  return blocks(companyId).filter(b => b.employeeId === employeeId &&
    dayKey(new Date(b.start)) === k && b.kind && b.kind !== 'break');
}
export function removeBlock(id) { S.data.blocks = S.data.blocks.filter(b => b.id !== id); emit(); }

export function addMoney({ type, amount, cat, note = '', companyId = cid(), date = null }) {
  const rec = { id: uid('m_'), companyId, type, amount: +amount, cat, note, date: (date ? new Date(date) : now()).toISOString() };
  (type === 'income' ? S.data.incomes : S.data.expenses).push(rec);
  emit(); return rec;
}
export function removeMoney(id) {
  S.data.incomes = S.data.incomes.filter(x => x.id !== id);
  S.data.expenses = S.data.expenses.filter(x => x.id !== id);
  emit();
}

/* ---------- категории доходов и расходов (§85, §86) ----------
   Устроены так же, как категории услуг: базовый набор плюс свои,
   которые живут в company.finCats и подхватываются во всех списках.
------------------------------------------------------------- */
const BASE_FIN = {
  income: {
    sale: { t: 'Продажа товара', color: '#12B76A' },
    cert: { t: 'Сертификат', color: '#06AED4' },
    rent_in: { t: 'Субаренда места', color: '#8B5CF6' },
    other_in: { t: 'Прочее', color: '#7C8AA5' },
  },
  expense: {
    rent: { t: 'Аренда', color: '#F04462' },
    materials: { t: 'Материалы', color: '#F79009' },
    salary: { t: 'Зарплата', color: '#8B5CF6' },
    ads: { t: 'Реклама', color: '#EC4899' },
    utilities: { t: 'Коммунальные', color: '#06AED4' },
    tax: { t: 'Налоги', color: '#0EA5E9' },
    other_ex: { t: 'Прочее', color: '#7C8AA5' },
  },
};
const FIN_PALETTE = ['#EC4899', '#06AED4', '#F5A524', '#7C3AED', '#10B981', '#F04462', '#0EA5E9'];

export function finCats(type, companyId = cid()) {
  const c = co(companyId) || {};
  const own = (c.finCats && c.finCats[type]) || {};
  return { ...BASE_FIN[type], ...own };
}
export function finCatInfo(type, key, companyId = cid()) {
  // на удалённую категорию могли остаться ссылки — показываем «Прочее»,
  // а не технический ключ вроде f1x2y3
  return finCats(type, companyId)[key] || { t: 'Прочее', color: '#7C8AA5' };
}
export function finCatName(type, key, companyId = cid()) { return finCatInfo(type, key, companyId).t; }

export function addFinCat(type, title, companyId = cid()) {
  const c = co(companyId); if (!c || !title) return null;
  c.finCats = c.finCats || { income: {}, expense: {} };
  c.finCats[type] = c.finCats[type] || {};
  const key = 'f' + Date.now().toString(36);
  const n = Object.keys(c.finCats[type]).length;
  c.finCats[type][key] = { t: title.trim(), color: FIN_PALETTE[n % FIN_PALETTE.length] };
  emit();
  return key;
}
export function renameFinCat(type, key, title, companyId = cid()) {
  const c = co(companyId);
  if (c && c.finCats && c.finCats[type] && c.finCats[type][key]) { c.finCats[type][key].t = title.trim(); emit(); }
}
export function removeFinCat(type, key, companyId = cid()) {
  const c = co(companyId);
  if (!c || !c.finCats || !c.finCats[type] || !c.finCats[type][key]) return false;
  const fallback = type === 'income' ? 'other_in' : 'other_ex';
  const list = type === 'income' ? S.data.incomes : S.data.expenses;
  let moved = 0;
  list.forEach(x => { if (x.companyId === companyId && x.cat === key) { x.cat = fallback; moved++; } });
  recurring(companyId).forEach(x => { if (x.cat === key) { x.cat = fallback; moved++; } });
  delete c.finCats[type][key];
  emit();
  return moved;
}

/* ---------- регулярные операции (§87–§90) ----------
   Повторяющиеся платежи не материализуются в список операций:
   они разворачиваются на лету внутри запрошенного периода.
   Иначе база пухнет, а правка «аренды» не меняет прошлые месяцы.
---------------------------------------------------- */
export const REPEAT = {
  week: { t: 'Каждую неделю', days: 7 },
  month: { t: 'Каждый месяц', days: 30 },
  quarter: { t: 'Раз в квартал', days: 91 },
  year: { t: 'Раз в год', days: 365 },
};

export const recurring = (id = cid()) => (S.data.recurring || []).filter(r => r.companyId === id);

export function addRecurring({ type, amount, cat, note = '', every = 'month', from, to = null, companyId = cid() }) {
  const rec = {
    id: uid('rc_'), companyId, type, amount: +amount, cat, note, every,
    from: startOfDay(from ? new Date(from) : now()).toISOString(),
    to: to ? startOfDay(new Date(to)).toISOString() : null,
    active: true, createdAt: now().toISOString(),
  };
  S.data.recurring = S.data.recurring || [];
  S.data.recurring.push(rec);
  emit(); return rec;
}
export function updateRecurring(id, patch) {
  const r = (S.data.recurring || []).find(x => x.id === id);
  if (r) { Object.assign(r, patch); emit(); }
}
export function removeRecurring(id) {
  S.data.recurring = (S.data.recurring || []).filter(x => x.id !== id);
  emit();
}

/** Даты, в которые регулярная операция попадает в [start, end]. */
export function recurringDates(r, start, end) {
  if (r.active === false) return [];
  const from = new Date(r.from), to = r.to ? new Date(r.to) : null;
  const out = [];
  const lo = startOfDay(start), hi = startOfDay(end);
  let d = new Date(from);
  let guard = 0;
  while (d <= hi && guard++ < 800) {
    if (d >= lo && (!to || d <= to)) out.push(new Date(d));
    if (r.every === 'week') d = new Date(d.getTime() + 7 * 86400000);
    else if (r.every === 'month') d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    else if (r.every === 'quarter') d = new Date(d.getFullYear(), d.getMonth() + 3, d.getDate());
    else if (r.every === 'year') d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
    else break;
  }
  return out;
}

/** Все денежные операции периода: разовые + развёрнутые регулярные + выручка. */
export function moneyOps(start, end, companyId = cid(), { withRevenue = true } = {}) {
  const lo = startOfDay(start), hi = new Date(startOfDay(end).getTime() + 86399999);
  const inR = d => { const x = new Date(d); return x >= lo && x <= hi; };
  const out = [];
  if (withRevenue) {
    appts(companyId).filter(a => a.status === 'done' && inR(a.start)).forEach(a => {
      const c = client(a.clientId);
      out.push({ id: 'ap_' + a.id, type: 'income', amount: a.price, cat: 'services', catName: apptTitle(a), note: c ? c.name : '', date: a.start, fromAppt: true });
    });
  }
  S.data.incomes.filter(x => x.companyId === companyId && inR(x.date)).forEach(x => out.push({ ...x }));
  S.data.expenses.filter(x => x.companyId === companyId && inR(x.date)).forEach(x => out.push({ ...x }));
  recurring(companyId).forEach(r => {
    recurringDates(r, lo, hi).forEach(d => {
      out.push({ id: r.id + '_' + dayKey(d), type: r.type, amount: r.amount, cat: r.cat, note: r.note, date: d.toISOString(), recurringId: r.id });
    });
  });
  return out.sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ---------- обратная связь после визита (§80, §81) ----------
   Оценка видна только бизнесу: наружу, на страницу записи, отзывы
   не выводятся — так просил заказчик. Рейтинг мастера пересчитываем
   сразу, иначе он навсегда остался бы значением из сида.
------------------------------------------------------------- */
export function addReview({ apptId, rating, text = '', companyId = cid() }) {
  const a = appt(apptId);
  const rec = {
    id: uid('rv_'), companyId, apptId,
    clientId: a ? a.clientId : null, employeeId: a ? a.employeeId : null,
    rating: +rating, text: String(text || '').trim(), createdAt: now().toISOString(),
  };
  S.data.reviews.push(rec);
  if (a) a.reviewId = rec.id;
  recalcRating(rec.employeeId, companyId);
  emit();
  return rec;
}
export const reviewFor = apptId => S.data.reviews.find(r => r.apptId === apptId);

export function recalcRating(employeeId, companyId = cid()) {
  const e = emp(employeeId); if (!e) return;
  const list = S.data.reviews.filter(r => r.employeeId === employeeId && r.rating);
  if (list.length) e.rating = (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1);
  const c = co(companyId);
  if (c) {
    const all = reviews(companyId).filter(r => r.rating);
    if (all.length) { c.rating = +(all.reduce((s, r) => s + r.rating, 0) / all.length).toFixed(1); c.reviewsCount = all.length; }
  }
}

/** Выполненные визиты клиента, по которым он ещё не оставил оценку. */
export function pendingReviews(clientId) {
  const rated = new Set(S.data.reviews.map(r => r.apptId));
  return clientAppts(clientId)
    .filter(a => a.status === 'done' && !rated.has(a.id))
    .filter(a => (now() - new Date(a.start)) / 86400000 < 30);
}

export function addBroadcast(b) {
  const rec = { id: uid('bc_'), companyId: cid(), status: 'sent', sentAt: now().toISOString(), open: 0, booked: 0, ...b };
  S.data.broadcasts.push(rec); emit(); return rec;
}

export function setPlan(companyId, plan, days) {
  const c = co(companyId); if (!c) return;
  c.plan = plan;
  if (days != null) c.planUntil = new Date(now().getTime() + days * 86400000).toISOString();
  emit();
}
/** Продлить подписку на один период выбранного тарифа (месяц, квартал, год). */
export function extendPlan(companyId, planId = null) {
  const c = co(companyId); if (!c) return 0;
  const wasPlan = c.plan;
  const p = planById(planId || c.plan);
  const days = p ? (PERIODS[p.period] || PERIODS.month).days : 30;
  const base = Math.max(now().getTime(), new Date(c.planUntil).getTime() || 0);
  if (planId) c.plan = planId;
  c.planUntil = new Date(base + days * 86400000).toISOString();
  logEvent('billing', planId && planId !== wasPlan
    ? 'Тариф изменён: ' + wasPlan + ' → ' + planId
    : 'Подписка продлена на ' + days + ' дн.', { companyId });
  emit();
  return days;
}
export function setCompanyStatus(companyId, status) { const c = co(companyId); if (c) { c.status = status; emit(); } }

/* ---------- фирменный цвет компании ----------
   Цвет виден клиенту на странице записи, поэтому меняется владельцем
   в настройках, а не правкой данных.
--------------------------------------------- */
export const BRAND_COLORS = [
  { v: '#4C6FFF', t: 'Синий' },
  { v: '#6D5BF6', t: 'Индиго' },
  { v: '#8B5CF6', t: 'Фиолетовый' },
  { v: '#EC4899', t: 'Розовый' },
  { v: '#F04462', t: 'Красный' },
  { v: '#F79009', t: 'Оранжевый' },
  { v: '#12B76A', t: 'Зелёный' },
  { v: '#06AED4', t: 'Бирюзовый' },
  { v: '#0EA5E9', t: 'Голубой' },
  { v: '#2B3340', t: 'Графит' },
];

export function setCompanyColor(color, companyId = cid()) {
  const c = co(companyId);
  if (!c || !color) return;
  c.color = color;
  emit();
}

/* ---------- категории услуг ----------
   Базовые категории фиксированы, но компания может завести свои:
   они живут в company.cats и подхватываются везде, где выбирается категория.
--------------------------------------- */
const BASE_CATS = {
  nails: { t: 'Ногти', color: '#4C6FFF' },
  hair: { t: 'Волосы', color: '#F79009' },
  brow: { t: 'Брови и ресницы', color: '#8B5CF6' },
  bar: { t: 'Барбер', color: '#0EA5E9' },
  spa: { t: 'Спа', color: '#12B76A' },
  other: { t: 'Другое', color: '#7C8AA5' },
};
const CAT_PALETTE = ['#EC4899', '#06AED4', '#F5A524', '#7C3AED', '#10B981', '#F04462', '#0EA5E9'];

/** Все категории компании: базовые + добавленные владельцем. */
export function cats(companyId = cid()) {
  const c = co(companyId) || {};
  const own = c.cats || {};
  // Базовые показываем всегда: список короткий, а исчезающие пункты
  // сбивают с толку. «Другое» — только если там что-то лежит.
  const used = new Set(svcs(companyId).map(x => x.cat));
  const out = {};
  Object.entries(BASE_CATS).forEach(([k, v]) => {
    if (k === 'other' && !used.has('other')) return;
    out[k] = v;
  });
  Object.entries(own).forEach(([k, v]) => { out[k] = v; });
  return out;
}
export function catInfo(key, companyId = cid()) {
  const info = cats(companyId)[key] || BASE_CATS[key] || { t: 'Другое', color: '#7C8AA5' };
  // Базовые названия — метки приложения и переводятся. Категории, придуманные
  // владельцем, перевода не имеют и пройдут через t() без изменений.
  return { ...info, t: tr(info.t) };
}
export function catName(key, companyId = cid()) { return catInfo(key, companyId).t; }

export function addCat(title, companyId = cid()) {
  const c = co(companyId); if (!c || !title) return null;
  c.cats = c.cats || {};
  const key = 'c' + Date.now().toString(36);
  const n = Object.keys(c.cats).length;
  c.cats[key] = { t: title.trim(), color: CAT_PALETTE[n % CAT_PALETTE.length] };
  emit();
  return key;
}
export function renameCat(key, title, companyId = cid()) {
  const c = co(companyId);
  if (c && c.cats && c.cats[key]) { c.cats[key].t = title.trim(); emit(); }
}
export function removeCat(key, companyId = cid()) {
  const c = co(companyId);
  if (!c || !c.cats || !c.cats[key]) return false;
  // услуги этой категории переносим в «Другое», чтобы ничего не пропало
  const moved = svcs(companyId).filter(x => x.cat === key);
  moved.forEach(x => { x.cat = 'other'; x.color = '#7C8AA5'; });
  delete c.cats[key];
  emit();
  return moved.length;
}

/* ---------- роли и права ----------
   Роль — это набор прав. Права проверяются в интерфейсе (can()),
   поэтому сотрудник физически не видит чужих разделов.
------------------------------------ */
export const PERMS = {
  ownCalendar: 'Свой календарь',
  ownSchedule: 'Свой график и перерывы',
  allCalendar: 'Календарь всей команды',
  createAppt: 'Создавать и переносить записи',
  clients: 'База клиентов',
  services: 'Услуги и цены',
  team: 'Сотрудники и графики',
  finance: 'Финансы',
  analytics: 'Аналитика',
  // Отзывы стоят отдельно от аналитики намеренно. Оценка — это разговор
  // клиента с тем, кто отвечает за салон, а не рабочий отчёт: мастер не
  // должен читать, что о нём написали, а администратор — разбирать чужие
  // оценки. Поэтому право есть только у владельца (см. ROLES).
  reviews: 'Отзывы клиентов',
  settings: 'Настройки компании',
  billing: 'Тариф и оплата',
};

export const ROLES = {
  staff: {
    t: 'Мастер', s: 'Свой день, свои клиенты',
    perms: ['ownCalendar', 'ownSchedule', 'createAppt'],
  },
  manager: {
    t: 'Администратор', s: 'Весь календарь и клиенты',
    perms: ['ownCalendar', 'ownSchedule', 'allCalendar', 'createAppt', 'clients', 'services', 'team', 'analytics'],
  },
  owner: {
    t: 'Владелец', s: 'Полный доступ, включая деньги',
    perms: Object.keys(PERMS),
  },
};

export const roleOf = e => (e && ROLES[e.access]) ? e.access : 'staff';
export const roleName = e => ROLES[roleOf(e)].t;

/** Есть ли у текущего пользователя право? */
export function can(perm, e = me()) {
  if (S.session.role === 'admin') return true;
  if (!e) return false;
  if (e.isOwner) return true;
  return ROLES[roleOf(e)].perms.includes(perm);
}

/* =========================================================
   Приглашения в команду
   ---------------------------------------------------------
   Владелец делает ссылку с уже выбранной ролью и отправляет человеку.
   Тот открывает — и оказывается в команде. Ссылка одноразовая: второй
   переход по ней ничего не создаёт, иначе пересланное приглашение
   заводило бы сотрудников без ведома владельца.

   Живут приглашения в общем складе, а не только в браузере: ссылку
   создают на одном устройстве, а открывают на другом — иначе вся затея
   не имеет смысла.
   ========================================================= */
export const invites = (companyId = cid()) =>
  (S.data.invites || []).filter(i => i.companyId === companyId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

export const inviteById = id => (S.data.invites || []).find(i => i.id === id) || null;

/** активна | использована | истекла | отозвана */
export function inviteState(inv) {
  if (!inv) return 'нет';
  if (inv.revokedAt) return 'отозвана';
  if (inv.usedAt) return 'использована';
  if (new Date(inv.expiresAt) < now()) return 'истекла';
  return 'активна';
}

export function createInvite({ companyId = cid(), access = 'staff', role = 'Мастер', days = 7,
                               employeeId = null } = {}) {
  const rnd = () => Math.random().toString(36).slice(2, 8);
  const inv = {
    id: 'inv' + rnd() + rnd(),
    // Приглашение можно выписать на уже заведённую карточку: тогда человек
    // встанет за неё, а не появится вторым сотрудником с тем же именем.
    employeeId,
    companyId, access, role: String(role || '').trim() || ROLES[access].t,
    createdAt: now().toISOString(),
    createdBy: (me() || {}).id || null,
    expiresAt: new Date(now().getTime() + days * 86400000).toISOString(),
    usedAt: null, usedBy: null, revokedAt: null,
  };
  S.data.invites = S.data.invites || [];
  S.data.invites.push(inv);
  emit();
  return inv;
}

export function revokeInvite(id) {
  const inv = inviteById(id);
  if (!inv || inv.usedAt) return false;
  inv.revokedAt = now().toISOString();
  emit();
  return true;
}

/**
 * Принять приглашение: завести сотрудника и погасить ссылку.
 * Возвращает { ok, employee } либо { ok: false, why }.
 */
export function acceptInvite(id, person = {}) {
  const inv = inviteById(id);
  const st = inviteState(inv);
  if (st !== 'активна') return { ok: false, why: st };
  const c = co(inv.companyId);
  if (!c) return { ok: false, why: 'нет компании' };

  const name = String(person.name || '').trim() || 'Новый сотрудник';

  // Карточка могла быть заведена заранее — тогда за ней просто появляется
  // человек. Без этого приглашение плодило второго сотрудника с тем же
  // именем, а исходная карточка навсегда оставалась ничьей.
  let e = null;
  if (inv.employeeId) {
    const existing = S.data.employees.find(x => x.id === inv.employeeId);
    if (existing && existing.companyId === inv.companyId && existing.active !== false && !existing.linkedAt) {
      e = existing;
      if (person.phone) e.phone = person.phone;
    }
  }
  if (!e) {
    e = createEmployee({
      name, role: inv.role, phone: person.phone || '', companyId: inv.companyId,
    });
  }
  e.access = inv.access;
  e.tg = person.tg || '';
  e.tgId = person.tgId || '';
  // Отметка «за карточкой стоит живой человек»: по ней команда показывает,
  // кому уже открыт доступ, а кому ещё нужно отправить ссылку.
  e.linkedAt = now().toISOString();
  inv.usedAt = now().toISOString();
  inv.usedBy = e.id;
  logEvent('team', 'Сотрудник вошёл по приглашению', { companyId: inv.companyId, actor: name });
  emit();
  return { ok: true, employee: e };
}

/**
 * Можно ли трогать эту запись: переносить, отменять, завершать.
 * Мастер распоряжается только своими. Раньше проверки не было вовсе —
 * право createAppt существовало, но его никто не спрашивал.
 */
export function canTouchAppt(a) {
  if (!a) return false;
  if (can('allCalendar')) return true;      // владелец, администратор, супер-админ
  const e = me();
  return !!(e && a.employeeId === e.id && can('createAppt'));
}

/** Можно ли создать запись этому мастеру. */
export function canBookFor(employeeId) {
  if (can('allCalendar')) return true;
  const e = me();
  return !!(e && employeeId === e.id && can('createAppt'));
}

/** Мастера, которым текущий пользователь вправе создавать записи. */
export function bookableStaff(companyId = cid()) {
  const list = staff(companyId);
  if (can('allCalendar')) return list;
  const e = me();
  return list.filter(x => e && x.id === e.id);
}

export function setRole(employeeId, access) {
  const e = emp(employeeId);
  if (!e || !ROLES[access]) return;
  e.access = access;
  if (access === 'owner') e.isOwner = true;
  emit();
}

/* ---------- обучение и подсказки (§97, §99) ----------
   Подсказка показывается один раз: отметки живут в S.seenTips
   и переживают перезагрузку. Сбросить их можно в разделе «Обучение».
------------------------------------------------------ */
export const tipSeen = k => !!(S.seenTips || {})[k];
export function markTip(k) { S.seenTips = S.seenTips || {}; S.seenTips[k] = true; emit(); }
export function resetTips() { S.seenTips = {}; emit(); }

/** Шаг считается пройденным либо по данным, либо по отметке владельца. */
export function setupSteps(companyId = cid()) {
  const c = co(companyId) || {};
  const mark = c.setup || {};
  const list = staff(companyId);
  return [
    {
      k: 'svc', t: 'Добавить услуги', s: 'Название, цена и длительность',
      done: svcs(companyId).length > 0, act: 'qa.svc', ic: 'briefcase',
    },
    {
      k: 'team', t: 'Пригласить команду', s: 'Ссылка-приглашение — человек заполнит всё сам',
      // владелец в списке есть всегда, поэтому «команда собрана» — это
      // хотя бы один человек кроме него
      done: list.filter(e => !e.isOwner).length > 0, act: 'tm.invite', ic: 'userPlus',
    },
    {
      k: 'hours', t: 'Указать часы работы', s: 'Своё время на каждый день недели',
      done: !!mark.hours, act: 'set.hours', ic: 'clock',
    },
    {
      k: 'photo', t: 'Загрузить фото и логотип', s: 'Как выглядит страница записи',
      done: !!(c.logo || c.cover), act: 'set.photos', ic: 'image',
    },
    {
      k: 'share', t: 'Поделиться ссылкой', s: 'Отправьте её клиентам в Telegram',
      done: !!mark.share, act: 'o.share', ic: 'share',
    },
  ];
}
export function markSetup(key, companyId = cid()) {
  const c = co(companyId); if (!c) return;
  c.setup = c.setup || {};
  c.setup[key] = true;
  emit();
}
export const setupDone = (companyId = cid()) => setupSteps(companyId).filter(s => s.done).length;

/* ---------- статистика ----------
   Считается по произвольному отрезку дат: 7/30/90 дней, полгода, год
   и «свой период» из календаря — всё это одна функция statsBetween.
   rangeStats(days) оставлен обёрткой, им пользуются старые экраны.
--------------------------------- */
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON_S = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Сколько дней в отрезке включительно. */
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000) + 1;

/** Разбивка отрезка на корзины: по дням, неделям или месяцам (§91). */
export function buckets(start, end, group = 'auto') {
  const lo = startOfDay(start), hi = startOfDay(end);
  const n = daysBetween(lo, hi);
  if (group === 'auto') group = n <= 31 ? 'day' : n <= 120 ? 'week' : 'month';
  const out = [];
  if (group === 'day') {
    for (let d = new Date(lo); d <= hi; d = new Date(d.getTime() + 86400000)) {
      out.push({ from: new Date(d), to: new Date(d), label: n <= 7 ? WD_SHORT[d.getDay()] : String(d.getDate()) });
    }
  } else if (group === 'week') {
    // недели считаем с понедельника — так привычнее в расписании
    let d = new Date(lo); d = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86400000);
    for (; d <= hi; d = new Date(d.getTime() + 7 * 86400000)) {
      const to = new Date(d.getTime() + 6 * 86400000);
      out.push({ from: new Date(Math.max(d, lo)), to: new Date(Math.min(to, hi)), label: d.getDate() + '.' + MON_S[d.getMonth()] });
    }
  } else {
    let d = new Date(lo.getFullYear(), lo.getMonth(), 1);
    for (; d <= hi; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      out.push({ from: new Date(Math.max(d, lo)), to: new Date(Math.min(to, hi)), label: MON_S[d.getMonth()] });
    }
  }
  return { group, list: out };
}

export function statsBetween(start, end, companyId = cid(), { group = 'auto' } = {}) {
  const lo = startOfDay(start), hi = new Date(startOfDay(end).getTime() + 86399999);
  const days = daysBetween(lo, hi);
  const all = appts(companyId);
  const inR = a => { const d = new Date(a.start); return d >= lo && d <= hi; };
  const done = all.filter(a => a.status === 'done' && inR(a));
  const upcoming = all.filter(a => a.status === 'planned' && inR(a));
  const planned = all.filter(a => a.status !== 'cancelled' && inR(a));
  const cancelled = all.filter(a => a.status === 'cancelled' && inR(a));

  // §61 — фактическая и ожидаемая выручка считаются раздельно
  const revenue = done.reduce((s, a) => s + a.price, 0);
  const expected = upcoming.reduce((s, a) => s + a.price, 0);

  // предыдущий отрезок такой же длины
  const pEnd = new Date(lo.getTime() - 1), pStart = new Date(startOfDay(lo).getTime() - days * 86400000);
  const pDone = all.filter(a => a.status === 'done' && new Date(a.start) >= pStart && new Date(a.start) <= pEnd);
  const pRev = pDone.reduce((s, a) => s + a.price, 0);

  const bk = buckets(lo, hi, group);
  const series = [], labels = [], seriesExpected = [], seriesCount = [];
  bk.list.forEach(b => {
    const f = startOfDay(b.from).getTime(), t = startOfDay(b.to).getTime() + 86399999;
    const inB = a => { const x = new Date(a.start).getTime(); return x >= f && x <= t; };
    series.push(done.filter(inB).reduce((s, a) => s + a.price, 0));
    seriesExpected.push(upcoming.filter(inB).reduce((s, a) => s + a.price, 0));
    seriesCount.push(done.filter(inB).length);
    labels.push(b.label);
  });

  const byService = {};
  done.forEach(a => a.serviceIds.forEach(id => {
    const s = svc(id); if (!s) return;
    byService[id] = byService[id] || { name: s.name, color: s.color, count: 0, sum: 0 };
    byService[id].count++; byService[id].sum += s.price;
  }));
  const byEmployee = {};
  done.forEach(a => {
    const e = emp(a.employeeId); if (!e) return;
    byEmployee[e.id] = byEmployee[e.id] || { name: e.name, color: e.color, count: 0, sum: 0 };
    byEmployee[e.id].count++; byEmployee[e.id].sum += a.price;
  });

  const cls = clients(companyId);
  const newClients = cls.filter(c => new Date(c.createdAt) >= lo && new Date(c.createdAt) <= hi).length;
  const clientIds = new Set(done.map(a => a.clientId));
  let repeat = 0;
  clientIds.forEach(id => { if (all.filter(a => a.clientId === id && a.status === 'done').length > 1) repeat++; });

  // деньги: разовые операции и регулярные платежи периода
  const ops = moneyOps(lo, hi, companyId, { withRevenue: false });
  const extraIncome = ops.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
  const expenses = ops.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);
  const byCat = { income: {}, expense: {} };
  ops.forEach(o => {
    const info = finCatInfo(o.type, o.cat, companyId);
    const box = byCat[o.type];
    box[o.cat] = box[o.cat] || { key: o.cat, name: info.t, color: info.color, sum: 0, count: 0 };
    box[o.cat].sum += o.amount; box[o.cat].count++;
  });
  if (revenue) byCat.income.services = { key: 'services', name: 'Услуги', color: '#12B76A', sum: revenue, count: done.length };

  return {
    start: lo, end: startOfDay(end), days, group: bk.group,
    revenue, expected, income: revenue + extraIncome, extraIncome, expenses,
    profit: revenue + extraIncome - expenses,
    count: done.length, upcoming: upcoming.length, planned: planned.length, cancelled: cancelled.length,
    avg: done.length ? Math.round(revenue / done.length) : 0,
    prevRevenue: pRev, prevCount: pDone.length,
    deltaRev: pRev ? Math.round((revenue - pRev) / pRev * 100) : (revenue ? 100 : 0),
    deltaCount: done.length - pDone.length,
    series, labels, seriesExpected, seriesCount,
    byService: Object.values(byService).sort((a, b) => b.count - a.count),
    byEmployee: Object.values(byEmployee).sort((a, b) => b.sum - a.sum),
    byIncomeCat: Object.values(byCat.income).sort((a, b) => b.sum - a.sum),
    byExpenseCat: Object.values(byCat.expense).sort((a, b) => b.sum - a.sum),
    newClients, repeat, totalClients: cls.length,
    load: Math.min(100, Math.round(done.length / Math.max(1, staff(companyId).length * days * 6) * 100)),
  };
}

export function rangeStats(days, companyId = cid(), opts = {}) {
  const end = now();
  const start = new Date(startOfDay(end).getTime() - (days - 1) * 86400000);
  return statsBetween(start, end, companyId, opts);
}

/**
 * Свои цифры мастера за период: сколько визитов провёл и сколько заработал.
 * Раньше их доставали из общей сводки по компании поиском по имени
 * сотрудника — при двух Айгерим это бы развалилось.
 */
export function empStats(employeeId, days, companyId = cid()) {
  const end = now();
  const lo = new Date(startOfDay(end).getTime() - (days - 1) * 86400000);
  const list = appts(companyId).filter(a => a.employeeId === employeeId
    && new Date(a.start) >= lo && new Date(a.start) <= end);
  const done = list.filter(a => a.status === 'done');
  return {
    visits: done.length,
    sum: done.reduce((s, a) => s + a.price, 0),
    planned: list.filter(a => a.status === 'planned').length,
  };
}

export function todayStats(companyId = cid(), employeeId = null) {
  const list = dayAppts(now(), { companyId, employeeId });
  const done = list.filter(a => a.status === 'done');
  return {
    count: list.length,
    revenue: done.reduce((s, a) => s + a.price, 0),
    potential: list.reduce((s, a) => s + a.price, 0),
    clients: new Set(list.map(a => a.clientId)).size,
    done: done.length,
    list,
  };
}

export function lostClients(companyId = cid(), days = 45) {
  const n = now();
  return clients(companyId).map(c => {
    const st = clientStats(c.id);
    return { c, st };
  }).filter(x => x.st.visits > 0 && !x.st.next && x.st.last && (n - new Date(x.st.last.start)) / 86400000 > days)
    .sort((a, b) => b.st.spent - a.st.spent);
}

/* ---------- техническая часть платформы ----------
   Журнал, ошибки, обращения и блокировки живут в тех же структурах,
   что будут на сервере: запись создаётся одной функцией и никогда
   не правится на месте. Когда появится API, эти функции станут
   запросами, а экраны Super Admin останутся прежними.
-------------------------------------------------- */

/** Что писать в журнал. Ключ — он же фильтр в интерфейсе. */
export const LOG_KINDS = {
  auth: { t: 'Вход и роли', color: '#0EA5E9', icon: 'logout' },
  billing: { t: 'Оплаты и тарифы', color: '#12B76A', icon: 'card' },
  moderation: { t: 'Блокировки', color: '#F04462', icon: 'ban' },
  company: { t: 'Компании', color: '#8B5CF6', icon: 'building' },
  message: { t: 'Рассылки', color: '#EC4899', icon: 'megaphone' },
  system: { t: 'Система', color: '#7C8AA5', icon: 'gear' },
};

export const logs = () => (S.data.logs || []);

/** Записать событие. companyId и actor необязательны. */
export function logEvent(kind, text, { companyId = null, actor = null, level = 'info', meta = null } = {}) {
  const rec = {
    id: uid('lg_'), kind, text, level,
    companyId: companyId || null,
    actor: actor || (S.session.role === 'admin' ? 'super-admin' : (me() || {}).name || null),
    meta, at: now().toISOString(),
  };
  S.data.logs = S.data.logs || [];
  S.data.logs.push(rec);
  // журнал не должен расти бесконечно в браузере: на сервере это делает ротация
  if (S.data.logs.length > 400) S.data.logs.splice(0, S.data.logs.length - 400);
  emit();
  return rec;
}

/* ---------- ошибки ----------
   Собираются по-настоящему: main.js вешает onerror и unhandledrejection.
   В демо это тот же поток, что будет в бою, — меняется только приёмник.
---------------------------------- */
export const errors = () => (S.data.errors || []);

export function reportError(message, { stack = '', where = '', level = 'error', companyId = cid() } = {}) {
  S.data.errors = S.data.errors || [];
  const key = String(message).slice(0, 160);
  const seen = S.data.errors.find(e => e.message === key && e.where === where && !e.resolved);
  if (seen) {
    // одну и ту же ошибку не плодим — считаем повторы, как это делает Sentry
    seen.count++;
    seen.lastAt = now().toISOString();
    emit();
    return seen;
  }
  const rec = {
    id: uid('er_'), message: key, stack: String(stack || '').slice(0, 900),
    where: where || (typeof location !== 'undefined' ? location.hash : ''),
    level, count: 1, resolved: false,
    role: S.session.role, companyId,
    firstAt: now().toISOString(), lastAt: now().toISOString(),
  };
  S.data.errors.push(rec);
  if (S.data.errors.length > 120) S.data.errors.splice(0, S.data.errors.length - 120);
  emit();
  return rec;
}
export function resolveError(id, resolved = true) {
  const e = errors().find(x => x.id === id);
  if (e) { e.resolved = resolved; e.resolvedAt = resolved ? now().toISOString() : null; emit(); }
}
export function clearResolvedErrors() {
  S.data.errors = errors().filter(e => !e.resolved);
  emit();
}

/* ---------- личные уведомления компании ----------
   Блокировка, снятие блокировки, смена тарифа, ответ поддержки и жалоба
   клиента раньше писались только в журнал Super Admin. Владелец компании
   о них не узнавал вовсе: салон просто переставал принимать записи, и
   почему — было негде посмотреть. Теперь у компании есть своя почта.
--------------------------------------------------- */
export const INBOX_KINDS = {
  blocked: { t: 'Блокировка', icon: 'ban', color: '#F04462' },
  unblocked: { t: 'Блокировка снята', icon: 'checkCircle', color: '#12B76A' },
  plan: { t: 'Тариф', icon: 'card', color: '#0EA5E9' },
  support: { t: 'Поддержка', icon: 'msg', color: '#8B5CF6' },
  complaint: { t: 'Жалоба клиента', icon: 'shield', color: '#F79009' },
  system: { t: 'Платформа', icon: 'bell', color: '#7C8AA5' },
};

export const companyInbox = (companyId = cid()) =>
  (S.data.inbox || []).filter(m => m.companyId === companyId)
    .sort((a, b) => new Date(b.at) - new Date(a.at));

export const unreadInbox = (companyId = cid()) =>
  companyInbox(companyId).filter(m => !m.readAt).length;

export function notifyCompany({ companyId, kind = 'system', title, text = '', goTo = null, refId = null }) {
  if (!companyId || !title) return null;
  const rec = {
    id: uid('in_'), companyId, kind, title, text, goTo, refId,
    at: now().toISOString(), readAt: null,
  };
  S.data.inbox = S.data.inbox || [];
  S.data.inbox.push(rec);
  // Длину ограничиваем: в браузере это заодно и ротация.
  if (S.data.inbox.length > 300) S.data.inbox = S.data.inbox.slice(-300);
  emit();
  return rec;
}

export function markInboxRead(id) {
  const m = (S.data.inbox || []).find(x => x.id === id);
  if (m && !m.readAt) { m.readAt = now().toISOString(); emit(); }
}

export function markInboxAllRead(companyId = cid()) {
  let n = 0;
  (S.data.inbox || []).forEach(m => {
    if (m.companyId === companyId && !m.readAt) { m.readAt = now().toISOString(); n++; }
  });
  if (n) emit();
  return n;
}

/* ---------- обращения в поддержку ---------- */
export const TICKET_STATUS = {
  new: { t: 'Новое', color: '#F79009' },
  work: { t: 'В работе', color: '#0EA5E9' },
  closed: { t: 'Закрыто', color: '#12B76A' },
};
export const TICKET_TOPICS = {
  bug: 'Что-то не работает',
  billing: 'Оплата и тариф',
  howto: 'Как сделать',
  feature: 'Пожелание',
  complaint: 'Жалоба на компанию',
  other: 'Другое',
};

/** За что клиент может пожаловаться на салон. Список короткий намеренно:
    длинный человек не читает, а выбирает первый пункт. */
export const COMPLAINT_REASONS = {
  noshow: 'Меня не приняли по записи',
  price: 'Цена не совпала с указанной',
  rude: 'Грубое обращение',
  quality: 'Качество услуги',
  fake: 'Салона не существует / неверные данные',
  other: 'Другое',
};

export const tickets = () => (S.data.tickets || []).slice()
  .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

export function addTicket({ companyId = cid(), topic = 'other', subject, text, author = null,
                            from = 'company' }) {
  const rec = {
    id: uid('tk_'), companyId, topic, subject, status: 'new',
    // Кто обратился: владелец компании или её клиент. Поддержке это первое,
    // что нужно знать — от этого зависит, чью сторону она выясняет.
    from,
    author: author || (me() || {}).name || 'Владелец',
    messages: [{ from, text, at: now().toISOString() }],
    createdAt: now().toISOString(), updatedAt: now().toISOString(),
  };
  S.data.tickets = S.data.tickets || [];
  S.data.tickets.push(rec);
  emit();
  return rec;
}
/**
 * Жалоба клиента на компанию. Уходит тем же потоком, что и обращения
 * владельцев, но помечена источником: в Super Admin видно, что это не
 * вопрос компании о себе, а претензия к ней со стороны.
 */
export function addComplaint({ companyId, reason = 'other', text = '', appointmentId = null }) {
  const c = co(companyId);
  const who = (person() || {}).name || 'Клиент';
  const rec = addTicket({
    companyId,
    topic: 'complaint',
    subject: 'Жалоба: ' + (COMPLAINT_REASONS[reason] || COMPLAINT_REASONS.other),
    text: text || COMPLAINT_REASONS[reason] || '',
    author: who,
    from: 'client',
  });
  rec.reason = reason;
  rec.appointmentId = appointmentId;
  // По кому жалоба — тот и должен о ней знать: иначе он узнает о проблеме
  // только когда его заблокируют.
  rec.authorTg = (person() || {}).tgId || '';
  logEvent('moderation', 'Жалоба на компанию', {
    companyId, actor: who, note: COMPLAINT_REASONS[reason] || reason,
  });
  notifyCompany({
    companyId, kind: 'complaint',
    title: 'Клиент пожаловался в поддержку',
    text: (COMPLAINT_REASONS[reason] || 'Жалоба') + (text ? '. ' + text : '')
      + '. Поддержка платформы разбирается.',
    refId: rec.id,
  });
  emit();
  return rec;
}

/**
 * Вопрос клиента в поддержку платформы — не жалоба на салон, а «не приходят
 * напоминания», «как отменить запись». Поток тот же, чтобы ответ вернулся
 * туда же, в «Мои обращения»; отличает их тема, а не источник.
 */
export function addClientTicket({ topic = 'other', subject, text, companyId = cid() }) {
  const p = person() || {};
  const rec = addTicket({
    companyId, topic,
    subject: subject || TICKET_TOPICS[topic] || 'Вопрос',
    text, author: p.name || 'Клиент', from: 'client',
  });
  // Без этого ответ поддержки не найдёт адресата: myTickets ищет по tgId.
  rec.authorTg = p.tgId || '';
  emit();
  return rec;
}

/**
 * Вопрос сотрудника в поддержку платформы. От обращения владельца отличается
 * только автором: отвечает та же поддержка, ответ приходит в уведомления
 * компании — отдельного ящика у мастера в демо нет.
 */
export function addStaffTicket({ topic = 'other', subject, text }) {
  const who = (me() || {}).name || 'Сотрудник';
  return addTicket({ topic, subject: subject || TICKET_TOPICS[topic] || 'Вопрос', text, author: who });
}

export function replyTicket(id, text, from = 'support') {
  const t = tickets().find(x => x.id === id); if (!t) return null;
  t.messages.push({ from, text, at: now().toISOString() });
  t.updatedAt = now().toISOString();
  if (from === 'support' && t.status === 'new') t.status = 'work';
  // Ответ поддержки видит тот, кто писал. Обращение компании — владелец;
  // жалобу клиента компании показывать нельзя, её автор увидит ответ
  // у себя в профиле.
  if (from === 'support' && t.from !== 'client') {
    notifyCompany({
      companyId: t.companyId, kind: 'support',
      title: 'Ответ поддержки',
      text: String(text).slice(0, 200),
      goTo: 'o.support', refId: t.id,
    });
  }
  emit();
  return t;
}

/** Обращения этого человека как клиента: по ним он видит ответ поддержки. */
export function myTickets() {
  const p = person() || {};
  const key = p.tgId || '';
  const name = p.name || '';
  return (S.data.tickets || []).filter(t => t.from === 'client'
    && ((key && String(t.authorTg || '') === String(key)) || (!key && t.author === name)))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}
export function setTicketStatus(id, status) {
  const t = tickets().find(x => x.id === id); if (!t) return;
  t.status = status;
  t.updatedAt = now().toISOString();
  emit();
}

/* ---------- блокировки ----------
   Блокировка — это запись со сроком и причиной, а не флаг: в боевой
   версии по ней строится история и автоматическое снятие.
---------------------------------- */
export const BAN_REASONS = {
  unpaid: 'Неоплата',
  abuse: 'Жалобы клиентов',
  spam: 'Спам в рассылках',
  fraud: 'Подозрение на мошенничество',
  request: 'По просьбе владельца',
  other: 'Другое',
};

export const bans = () => (S.data.bans || []);
export const activeBan = (type, targetId) => bans().find(b =>
  b.type === type && b.targetId === targetId && !b.liftedAt &&
  (!b.until || new Date(b.until) > now()));

export function banEntity({ type = 'company', targetId, reason = 'other', note = '', days = 0 }) {
  const rec = {
    id: uid('bn_'), type, targetId, reason, note,
    until: days ? new Date(now().getTime() + days * 86400000).toISOString() : null,
    createdAt: now().toISOString(), by: 'super-admin', liftedAt: null,
  };
  S.data.bans = S.data.bans || [];
  S.data.bans.push(rec);
  if (type === 'company') setCompanyStatus(targetId, 'blocked');
  const name = type === 'company' ? (co(targetId) || {}).name : (emp(targetId) || client(targetId) || {}).name;
  logEvent('moderation', 'Заблокировано: ' + (name || targetId) + ' — ' + (BAN_REASONS[reason] || reason),
    { companyId: type === 'company' ? targetId : null, level: 'warn' });
  if (type === 'company') {
    notifyCompany({
      companyId: targetId, kind: 'blocked',
      title: 'Компания заблокирована',
      text: 'Причина: ' + (BAN_REASONS[reason] || reason)
        + (note ? '. ' + note : '')
        + (rec.until ? '. Блокировка действует до ' + new Date(rec.until).toLocaleDateString('ru-RU') : '')
        + '. Клиенты не могут записаться. Напишите в поддержку, если считаете это ошибкой.',
      goTo: 'o.support',
    });
  }
  emit();
  return rec;
}
export function liftBan(type, targetId) {
  const b = activeBan(type, targetId);
  if (b) { b.liftedAt = now().toISOString(); }
  if (type === 'company') setCompanyStatus(targetId, null);
  const name = type === 'company' ? (co(targetId) || {}).name : (emp(targetId) || client(targetId) || {}).name;
  logEvent('moderation', 'Разблокировано: ' + (name || targetId), { companyId: type === 'company' ? targetId : null });
  if (type === 'company') {
    notifyCompany({
      companyId: targetId, kind: 'unblocked',
      title: 'Блокировка снята',
      text: 'Компания снова видна в каталоге, клиенты могут записываться.',
    });
  }
  emit();
  return b;
}

/* ---------- сводный реестр людей платформы ----------
   Сотрудники и клиенты всех компаний одним списком: в боевой версии
   это будет отдельная таблица users, здесь — вычисляемая выборка.
------------------------------------------------------ */
export function platformUsers({ q = '', role = 'all', companyId = null } = {}) {
  const out = [];
  S.data.employees.forEach(e => {
    if (e.active === false) return;
    out.push({
      id: e.id, kind: e.isOwner ? 'owner' : 'staff', name: e.name, phone: e.phone || '',
      companyId: e.companyId, role: e.role, since: e.createdAt || null,
      banned: !!activeBan('user', e.id),
    });
  });
  S.data.clients.forEach(c => {
    out.push({
      id: c.id, kind: 'client', name: c.name, phone: c.phone || '',
      companyId: c.companyId, role: 'Клиент', since: c.createdAt,
      banned: !!activeBan('user', c.id),
    });
  });
  const needle = q.trim().toLowerCase();
  return out.filter(u => {
    if (role !== 'all' && u.kind !== role) return false;
    if (companyId && u.companyId !== companyId) return false;
    if (needle && !(u.name.toLowerCase().includes(needle) || u.phone.includes(needle))) return false;
    return true;
  });
}

/** Техническое состояние платформы — для экрана «Здоровье». */
export function platformHealth() {
  const dayAgo = now().getTime() - 86400000;
  const errs = errors();
  const raw = (() => {
    try { return (localStorage.getItem(KEY) || '').length; } catch (e) { return 0; }
  })();
  const openTickets = tickets().filter(t => t.status !== 'closed');
  return {
    version: '2.0 demo',
    dataVersion: VER,
    storageBytes: raw,
    storageMb: +(raw / 1024 / 1024).toFixed(2),
    // квота localStorage ~5 МБ на домен; это и есть потолок демо
    storagePct: Math.min(100, Math.round(raw / (5 * 1024 * 1024) * 100)),
    errors24: errs.filter(e => new Date(e.lastAt).getTime() > dayAgo && !e.resolved)
      .reduce((sum, e) => sum + e.count, 0),
    errorsOpen: errs.filter(e => !e.resolved).length,
    ticketsOpen: openTickets.length,
    ticketsNew: openTickets.filter(t => t.status === 'new').length,
    bansActive: bans().filter(b => !b.liftedAt && (!b.until || new Date(b.until) > now())).length,
    logs: logs().length,
    records: {
      companies: S.data.companies.length,
      employees: S.data.employees.length,
      clients: S.data.clients.length,
      appointments: S.data.appointments.length,
      reviews: S.data.reviews.length,
    },
  };
}

/* ---------- супер-админ ---------- */

/* Тарифы — данные, а не константы (§100–§102): название, цену, период,
   лимиты и список функций правит владелец платформы прямо в панели. */
export const PERIODS = { month: { t: 'месяц', days: 30 }, quarter: { t: 'квартал', days: 90 }, year: { t: 'год', days: 365 } };

export const DEFAULT_PLANS = () => ([
  {
    id: 'START', name: 'START', price: 9900, period: 'month', active: true, color: '#0EA5E9',
    limits: { staff: 1, services: 20, broadcasts: 2 },
    feats: ['1 сотрудник', 'Онлайн-запись', 'База клиентов', 'Напоминания'],
  },
  {
    id: 'PRO', name: 'PRO', price: 19900, period: 'month', active: true, color: '#4C6FFF',
    limits: { staff: 10, services: 100, broadcasts: 20 },
    feats: ['До 10 сотрудников', 'AI-помощник', 'Рассылки', 'Аналитика и финансы'],
  },
  {
    id: 'BUSINESS', name: 'BUSINESS', price: 39900, period: 'month', active: true, color: '#8B5CF6',
    limits: { staff: 0, services: 0, broadcasts: 0 },
    feats: ['Без ограничений', 'Несколько филиалов', 'API и интеграции', 'Приоритетная поддержка'],
  },
]);

export const plans = () => (S.data.plans && S.data.plans.length ? S.data.plans : DEFAULT_PLANS());
export const planById = id => plans().find(p => p.id === id) || null;
export const planPrice = id => { const p = planById(id); return p ? p.price : 0; };
/** Цена, приведённая к месяцу — иначе годовой тариф раздувает MRR. */
export const planMonthly = id => {
  const p = planById(id); if (!p) return 0;
  return Math.round(p.price / ((PERIODS[p.period] || PERIODS.month).days / 30));
};

export function updatePlan(id, patch) {
  S.data.plans = S.data.plans && S.data.plans.length ? S.data.plans : DEFAULT_PLANS();
  const p = S.data.plans.find(x => x.id === id);
  if (!p) return null;
  Object.assign(p, patch);
  emit(); return p;
}
export function addPlan({ name, price, period = 'month', feats = [], limits = {} }) {
  S.data.plans = S.data.plans && S.data.plans.length ? S.data.plans : DEFAULT_PLANS();
  const id = String(name || 'PLAN').toUpperCase().replace(/[^A-ZА-Я0-9]/gi, '').slice(0, 12) || ('P' + Date.now().toString(36));
  if (S.data.plans.some(p => p.id === id)) return null;
  const p = { id, name, price: +price, period, active: true, color: '#12B76A', limits, feats };
  S.data.plans.push(p); emit(); return p;
}
export function removePlan(id) {
  if (allCompanies().some(c => c.plan === id)) return false;   // тариф с клиентами не удаляем
  S.data.plans = plans().filter(p => p.id !== id);
  emit(); return true;
}

/* Системные уведомления платформы (§106) */
export const NOTICE_KINDS = {
  update: { t: 'Обновление', color: '#4C6FFF', icon: 'sparkles' },
  maintenance: { t: 'Технические работы', color: '#F79009', icon: 'gear' },
  billing: { t: 'Оплата', color: '#F04462', icon: 'card' },
};
export const notices = () => (S.data.notices || []).slice().sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
export function addNotice({ kind = 'update', title, text, segment = 'all', to = 0 }) {
  const rec = { id: uid('nt_'), kind, title, text, segment, to, sentAt: now().toISOString() };
  S.data.notices = S.data.notices || [];
  S.data.notices.push(rec); emit(); return rec;
}
export function removeNotice(id) { S.data.notices = (S.data.notices || []).filter(n => n.id !== id); emit(); }

/* Сегменты компаний для рассылок платформы (§105) */
export function saSegments() {
  const cs = allCompanies();
  const isActive = c => c.status !== 'blocked' && new Date(c.planUntil) > now();
  const segs = [
    { v: 'all', t: 'Все компании', s: 'Каждая компания в системе', list: cs },
    { v: 'active', t: 'Активные', s: 'Подписка оплачена', list: cs.filter(isActive) },
    { v: 'inactive', t: 'Неактивные', s: 'Истёкшие и заблокированные', list: cs.filter(c => !isActive(c)) },
  ];
  plans().forEach(p => segs.push({ v: 'plan:' + p.id, t: 'Тариф ' + p.name, s: 'Компании на этом тарифе', list: cs.filter(c => c.plan === p.id) }));
  return segs;
}
export const saBroadcasts = () => (S.data.saBroadcasts || []).slice().sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
export function addSaBroadcast({ title, text, segment, to, open = 0 }) {
  const rec = { id: uid('sb_'), title, text, segment, to, open, sentAt: now().toISOString() };
  S.data.saBroadcasts = S.data.saBroadcasts || [];
  S.data.saBroadcasts.push(rec); emit(); return rec;
}

export function saStats() {
  const cs = allCompanies();
  const active = cs.filter(c => c.status !== 'blocked' && new Date(c.planUntil) > now());
  const price = {};
  plans().forEach(p => { price[p.id] = p.price; });
  const byPlan = plans().map(p => ({
    ...p,
    count: cs.filter(c => c.plan === p.id).length,
    activeCount: active.filter(c => c.plan === p.id).length,
    mrr: active.filter(c => c.plan === p.id).length * planMonthly(p.id),
  }));
  // регистрации по месяцам за последние полгода (§104)
  const signups = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now().getFullYear(), now().getMonth() - i, 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    signups.push({
      label: MON_S[d.getMonth()],
      count: cs.filter(c => { const x = new Date(c.createdAt); return x >= d && x < to; }).length,
    });
  }
  return {
    companies: cs.length,
    active: active.length,
    mrr: active.reduce((s, c) => s + planMonthly(c.plan), 0),
    arpu: active.length ? Math.round(active.reduce((s, c) => s + planMonthly(c.plan), 0) / active.length) : 0,
    users: S.data.employees.length,
    clients: S.data.clients.length,
    todayAppts: S.data.appointments.filter(a => dayKey(new Date(a.start)) === dayKey(now()) && a.status !== 'cancelled').length,
    totalAppts: S.data.appointments.length,
    expiring: cs.filter(c => { const d = (new Date(c.planUntil) - now()) / 86400000; return d > 0 && d < 10; }),
    blocked: cs.filter(c => c.status === 'blocked'),
    newThisMonth: signups[signups.length - 1].count,
    signups, byPlan, price,
    health: platformHealth(),
  };
}
export function companyStats(id) {
  return {
    team: emps(id).length,
    clients: clients(id).length,
    appts: appts(id).length,
    revenue: appts(id).filter(a => a.status === 'done').reduce((s, a) => s + a.price, 0),
  };
}
