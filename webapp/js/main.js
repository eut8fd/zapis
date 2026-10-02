import {
  S, load, loadServer, sub, emit, save, reportError, setHome, viewCompany, ensurePerson, homeId,
  isServer, allCompanies, emps, co, readCache,
} from './store.js';
import { initTelegram, tgColorScheme, startParam, tgUser, tgId, tgUsername, tg } from './tg.js';
import { adminAllowed, unlockWithCode } from './config.js';
import { bindDelegation, on } from './bus.js';
import { render, bootRoute, go, back, routes, resetStack } from './router.js';
import { $ } from './ui.js';
import { connect, adopt, adoptOffline, session, pushNow, pull } from './sync.js';
import { parseStart, SECTIONS, enterCompany, enterAsClient } from './roles.js';

/* ---------- тема ---------- */
export function applyTheme() {
  let t = S.theme;
  if (t === 'auto') t = tgColorScheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t === 'dark' ? '#0C0E13' : '#F4F5F8';
  try { if (tg && tg.setHeaderColor) tg.setHeaderColor(t === 'dark' ? '#0C0E13' : '#F4F5F8'); } catch (e) { }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });
if (tg && tg.onEvent) { try { tg.onEvent('themeChanged', () => { if (S.theme === 'auto') applyTheme(); }); } catch (e) { } }

/* ---------- общие действия ---------- */
on('tab', (ds, el) => {
  const r = ds.r;
  // вкладка «Салон» всегда возвращает в свой салон, даже если сейчас открыт
  // чужой из каталога: иначе первая вкладка перестала бы быть салонной
  if (r === 'cl.company' && homeId()) viewCompany(homeId());
  if (routes[r]) go(r, {}, { root: true, tabPulse: !!el?.classList.contains('tab') });
});
on('back', () => back());
on('nav', ds => { const p = {}; Object.keys(ds).forEach(k => { if (k !== 'a' && k !== 'r') p[k] = ds[k]; }); go(ds.r, p); });
on('noop', () => { });

/* ---------- сбор ошибок ----------
   Ошибки видит владелец платформы в Super Admin, а не только консоль
   разработчика. В серверном режиме они уходят на сервер вместе с
   остальными данными — меняется приёмник в reportError, не эти обработчики.
---------------------------------- */
window.addEventListener('error', ev => {
  try {
    reportError(ev.message || 'Ошибка скрипта', {
      stack: (ev.error && ev.error.stack) || (ev.filename ? ev.filename + ':' + ev.lineno : ''),
      where: location.hash || 'старт',
    });
  } catch (e) { }
});
window.addEventListener('unhandledrejection', ev => {
  try {
    const r = ev.reason;
    reportError((r && r.message) || String(r) || 'Необработанный промис', {
      stack: (r && r.stack) || '', where: location.hash || 'старт',
    });
  } catch (e) { }
});

/* ---------- start-параметр ----------
   Формат: <роль|компания>[_<раздел>] — c1_book, owner_cal, co_abc_my.
   Идентификаторы компаний сами содержат подчёркивание (co_abc), поэтому
   отрезаем только известный хвост раздела, а не первое подчёркивание.
----------------------------------- */
const tgName = () => { const u = tgUser(); return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : ''; };
// Числовой id обязателен: бот узнаёт человека только по нему и без
// него не покажет ему запись, сделанную в приложении.
const tgIds = () => ({ tg: tgUsername(), tgId: tgId() });

/* ---------- маршрут по умолчанию: демо-режим (как раньше) ---------- */
async function demoRoute(raw) {
  const [sp, section] = parseStart(raw);
  let def = { r: 'o.home', p: {} };
  if (/^inv[a-z0-9]{8,}$/.test(sp)) { def = { r: 'inv.join', p: { id: sp } }; }
  else if (S.data.companies.some(c => c.id === sp)) {
    S.session.role = 'client';
    setHome(sp);
    ensurePerson(tgName(), tgIds());
    def = { r: SECTIONS.client[section] || 'cl.company', p: {} };
  } else if (sp === 'admin') {
    const key = new URLSearchParams(location.search).get('key');
    const ok = adminAllowed(tgUser()) || (key ? await unlockWithCode(key) : false);
    if (key) history.replaceState(null, '', location.pathname + location.hash);
    if (ok) { S.session.role = 'admin'; def = { r: 'sa.home', p: {} }; }
    else { S.session.role = 'owner'; def = { r: 'o.home', p: {} }; }
  }
  else if (sp === 'create') { def = { r: 'biz.start', p: {} }; }
  else if (sp === 'client' || sp === 'find') {
    S.session.role = 'client';
    if (!homeId()) setHome(S.session.companyId);
    ensurePerson(tgName(), tgIds());
    def = { r: SECTIONS.client[section] || 'cl.company', p: {} };
  }
  else if (sp === 'owner' || sp === 'biz' || sp === 'business') {
    S.session.role = 'owner';
    const owner = S.data.employees.find(e => e.companyId === S.session.companyId && e.isOwner);
    if (owner) S.session.employeeId = owner.id;
    def = { r: SECTIONS.owner[section] || 'o.home', p: {} };
  }
  else if (sp === 'employee') {
    S.session.role = 'employee';
    const st = S.data.employees.find(e => e.companyId === S.session.companyId && e.takesAppointments && !e.isOwner);
    S.session.employeeId = st ? st.id : S.session.employeeId;
    def = { r: SECTIONS.employee[section] || 'e.home', p: {} };
  }
  else if (sp === 'onboarding' || !S.onboarded) { def = { r: 'onb', p: {} }; }
  else {
    const r = S.session.role;
    def = { r: r === 'client' ? 'cl.company' : r === 'employee' ? 'e.home' : r === 'admin' ? 'sa.home' : 'o.home', p: {} };
  }
  if (S.session.role === 'client') ensurePerson(tgName(), tgIds());
  if (S.session.role === 'client') {
    if (!homeId()) setHome(S.session.companyId);
    viewCompany(homeId());
  }
  return def;
}

/* ---------- маршрут по умолчанию: серверный режим ----------
   Роль не выбирается в приложении — она следует из данных сервера:
   есть карточка сотрудника с моим telegram-id — я в команде; открыл
   ссылку салона — я его клиент; id в списке платформы — Super Admin.
--------------------------------------------------------- */
function serverRoute(raw) {
  const ses = session() || {};
  const [sp, section] = parseStart(raw);
  const members = ses.memberships || [];
  const known = cid => allCompanies().some(c => c.id === cid);

  if (/^inv[a-z0-9]{8,}$/.test(sp)) return { r: 'inv.join', p: { id: sp } };
  if (sp === 'admin' && ses.identity && ses.identity.isAdmin) {
    S.session.role = 'admin';
    const first = allCompanies()[0];
    if (first) { S.session.companyId = first.id; const o = emps(first.id).find(e => e.isOwner); S.session.employeeId = o ? o.id : null; }
    return { r: 'sa.home', p: {} };
  }
  // ссылка салона — всегда вход клиента, даже если это мой собственный салон:
  // владелец так смотрит свою страницу глазами клиента
  if (known(sp)) return enterAsClient(sp, section);

  const cabinet = () => {
    const last = S.session.lastCompanyId;
    const pick = members.find(m => m.companyId === last) || members.find(m => m.isOwner) || members[0];
    return pick ? enterCompany(pick.companyId, { section }) : null;
  };

  if (sp === 'owner' || sp === 'biz' || sp === 'business' || sp === 'employee' || sp === 'staff') {
    const r = cabinet(); if (r) return r;
  }
  if (sp === 'create') return { r: 'biz.start', p: {} };
  if (sp === 'onboarding') return { r: 'onb', p: {} };
  if (sp === 'client' || sp === 'find') {
    const home = ses.home && known(ses.home) ? ses.home : (ses.bound || []).find(known);
    if (home) return enterAsClient(home, section);
  }
  // без параметра: кабинет, если есть; иначе свой салон; иначе витрина
  const r = cabinet(); if (r) return r;
  const home = ses.home && known(ses.home) ? ses.home : (ses.bound || []).find(known);
  if (home) return enterAsClient(home, section);
  return { r: 'biz.start', p: {} };
}

/* ---------- старт ---------- */
async function boot() {
  initTelegram();
  bindDelegation();

  const raw = (startParam() || new URLSearchParams(location.search).get('start') || '').toLowerCase();

  // Сначала пробуем сервер. Нет сервера или не прошла подпись — демо на
  // localStorage, как раньше. Ждём ответ до отрисовки: иначе человек на
  // секунду увидит чужие демо-данные вместо своих.
  let ses = null;
  try { ses = await connect(raw); } catch (e) { ses = null; }

  await Promise.all([
    import('./screens/owner.js'), import('./screens/clients.js'), import('./screens/more.js'),
    import('./screens/ai.js'), import('./screens/client.js'), import('./screens/employee.js'),
    import('./screens/admin.js'), import('./screens/onboarding.js'), import('./dev.js'),
    import('./screens/business.js'), import('./screens/invite.js'),
  ]);

  let def;
  // Сервер молчит, но прошлый вход был серверным: показываем последние данные,
  // а не демо-сид. Правки накопятся и уйдут, когда сеть вернётся.
  let offline = null;
  if (!ses) {
    const cache = readCache();
    if (cache && cache.server && cache.data) {
      loadServer(cache);
      offline = adoptOffline(cache);
    }
  }
  if (ses || offline) {
    if (ses) { loadServer(); adopt(ses); }
    def = serverRoute(raw);
    document.body.dataset.server = '1';
    // кнопка демо-панели рисовалась при импорте, до того как стал известен режим
    try { (await import('./dev.js')).mountFab(); } catch (e) { }
    if (offline) {
      import('./ui.js').then(u => u.toast('Нет связи с сервером — показываем последние данные', 'dan')).catch(() => { });
    }
  } else {
    load();
    // сохранённая сессия не должна давать доступ к Super Admin без ключа
    if (S.session.role === 'admin' && !adminAllowed(tgUser())) S.session.role = 'owner';
    def = await demoRoute(raw);
  }
  applyTheme();

  // ссылка из адресной строки не должна открывать экран чужой роли
  const ROLE_OK = {
    owner: /^(o\.|ai\.|biz\.|inv\.|onb$)/, employee: /^(e\.|o\.|ai\.|biz\.|inv\.|onb$)/,
    client: /^(cl\.|biz\.|inv\.|onb$)/, admin: /^(sa\.|o\.|ai\.|biz\.|inv\.|onb$)/,
  };
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (h && !(ROLE_OK[S.session.role] || /./).test(h)) location.hash = '';
  // в серверном режиме стартовый экран решают данные, а не старый адрес в строке:
  // роль могла поменяться (пригласили в команду, открыли другой салон)
  if (ses && h && !h.startsWith('inv.')) location.hash = '';

  sub(() => render(false));
  $('#boot') && $('#boot').remove();
  bootRoute(def);
  if (ses || offline) {
    // роль и салон, выбранные при входе, нужны и офлайн-запуску
    save();
    // не отправленное с прошлого раза и свежие чужие изменения
    pushNow().then(() => pull()).catch(() => { });
  }
}

boot();

// отладочный доступ из консоли
window.__zapis = { S, go, emit, applyTheme, resetStack, enterCompany, enterAsClient, isServer };
