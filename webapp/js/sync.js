/* =========================================================
   Общий склад Mini App и бота
   ---------------------------------------------------------
   До него это были два мира. У бота своя база и услуги по номеру в списке,
   у приложения — localStorage и настоящие идентификаторы. Бот знал три
   салона из одиннадцати, а напоминания уходили только по записям из чата,
   хотя интерфейс обещал их всем.

   Теперь приложение выкладывает справочник (компании, услуги, мастера,
   часы) на сервер, а бот его читает. Записи складываются в общий список
   в формате приложения — с настоящими идентификаторами.

   Всё здесь необязательное. Нет сервера, нет сети, открыли файл с диска —
   приложение работает ровно как раньше, на localStorage. Синхронизация
   молча выключается, а не роняет экран: демо должно открываться всегда.
   ========================================================= */
import { S, catalogCompanies, svcs, staff, emit, allCompanies } from './store.js';

const TIMEOUT = 6000;
let pushTimer = null;
let lastPushed = '';
let alive = true;          // сервер ответил хоть раз — иначе не тревожим его

async function req(url, opts = {}) {
  if (!alive) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    // Первая же неудача выключает синхронизацию до перезагрузки: сервера
    // либо нет, либо он не наш, и долбиться в него на каждое сохранение
    // бессмысленно.
    alive = false;
    return null;
  } finally { clearTimeout(t); }
}

/* ---------------- справочник ---------------- */

/** Срез, который нужен боту: без клиентов, денег и всего внутреннего. */
function snapshot() {
  return catalogCompanies().map(c => ({
    id: c.id, name: c.name, short: c.short, cat: c.cat, city: c.city,
    addr: c.addr, phone: c.phone, color: c.color, currency: c.currency,
    rating: c.rating, hours: c.hours, lat: c.lat, lon: c.lon,
    services: svcs(c.id).map(s => ({
      id: s.id, name: s.name, price: s.price, duration: s.duration,
      cat: s.cat, employeeIds: s.employeeIds || [],
    })),
    staff: staff(c.id).map(e => ({
      id: e.id, name: e.name, role: e.role, schedule: e.schedule,
    })),
  }));
}

/** Выложить справочник. Зовётся после сохранения, с задержкой. */
export function pushCatalog(delay = 1500) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const catalog = snapshot();
    const body = JSON.stringify({ catalog });
    if (body === lastPushed) return;          // ничего не поменялось
    const ok = await req('/api/catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (ok) lastPushed = body;
  }, delay);
}

/* ---------------- записи ---------------- */

/** Отправить запись в общий список, чтобы бот её увидел и напомнил о ней. */
export async function pushAppointment(a, extra = {}) {
  if (!a) return;
  await req('/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...a, ...extra }),
  });
}

/** Изменить статус записи в общем списке (отмена, перенос). */
export async function patchAppointment(id, patch) {
  if (!id) return;
  await req('/api/appointments/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Найти или завести карточку клиента по имени: записи из чата приходят
    без clientId — в боте своих карточек клиентов нет. */
function clientFor(companyId, name, tg) {
  const list = S.data.clients.filter(c => c.companyId === companyId);
  const found = list.find(c => (tg && String(c.tg) === String(tg)) || c.name === name);
  if (found) return found.id;
  const initials = String(name || 'Клиент').split(' ').filter(Boolean)
    .slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const rec = {
    id: 'cl_bot_' + Math.random().toString(36).slice(2, 8),
    companyId, name: name || 'Клиент', phone: '', tg: tg ? String(tg) : '',
    initials, color: '#06AED4', createdAt: new Date().toISOString(),
    note: '', ai: null, tags: [],
  };
  S.data.clients.push(rec);
  return rec.id;
}

/**
 * Забрать записи из общего списка. Возвращает число новых.
 * Свои же записи узнаём по id и пропускаем — иначе после каждой отправки
 * они возвращались бы обратно дубликатами.
 */
export async function pullAppointments() {
  const data = await req('/api/appointments');
  if (!data || !Array.isArray(data.appointments)) return 0;
  const known = new Set(S.data.appointments.map(a => a.id));
  const ids = new Set(allCompanies().map(c => c.id));
  const emps = new Set(S.data.employees.map(e => e.id));
  const svcIds = new Set(S.data.services.map(x => x.id));
  let added = 0;
  data.appointments.forEach(a => {
    if (!a || !a.id || !ids.has(a.companyId)) return;
    const mine = S.data.appointments.find(x => x.id === a.id);
    if (mine) {
      // статус мог поменяться в чате — забираем его, остальное не трогаем
      if (a.status && a.status !== mine.status) { mine.status = a.status; added++; }
      return;
    }
    if (known.has(a.id)) return;
    // Запись с сервера может ссылаться на мастера или услугу, которых в этой
    // базе нет: версия данных поменялась, демо сбросили, справочник ушёл
    // вперёд. Такую пропускаем — иначе экраны падают на emp(...).name.
    if (!emps.has(a.employeeId)) return;
    if ((a.serviceIds || []).some(x => !svcIds.has(x))) return;
    S.data.appointments.push({
      id: a.id, companyId: a.companyId,
      clientId: a.clientId || clientFor(a.companyId, a.clientName, a.clientTg),
      employeeId: a.employeeId, serviceIds: a.serviceIds || [],
      start: a.start, duration: a.duration || 60, price: a.price || 0,
      status: a.status || 'planned', note: a.note || '',
      source: a.source || 'bot', createdAt: a.createdAt || a.start,
    });
    added++;
  });
  if (added) emit();
  return added;
}

/** Разовая синхронизация при запуске: сначала отдать, потом забрать. */
export async function syncOnBoot() {
  pushCatalog(0);
  return pullAppointments();
}

export const syncAlive = () => alive;
