import { S, load, sub, emit, reportError, logEvent, setHome, viewCompany, ensurePerson, homeId } from './store.js';
import { initTelegram, tgColorScheme, startParam, tgUser, tg } from './tg.js';
import { adminAllowed, unlockWithCode } from './config.js';
import { bindDelegation, on } from './bus.js';
import { render, bootRoute, go, back, routes } from './router.js';
import { $ } from './ui.js';
import { syncOnBoot, pushCatalog } from './sync.js';

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
   разработчика. В боевой версии тот же поток уходит на сервер —
   меняется приёмник в reportError, не эти обработчики.
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

/* ---------- старт ---------- */
async function boot() {
  initTelegram();
  load();
  // сохранённая сессия не должна давать доступ к Super Admin без ключа
  if (S.session.role === 'admin' && !adminAllowed(tgUser())) S.session.role = 'owner';
  applyTheme();
  bindDelegation();

  await Promise.all([
    import('./screens/owner.js'), import('./screens/clients.js'), import('./screens/more.js'),
    import('./screens/ai.js'), import('./screens/client.js'), import('./screens/employee.js'),
    import('./screens/admin.js'), import('./screens/onboarding.js'), import('./dev.js'),
    import('./screens/business.js'),
  ]);

  // стартовый маршрут: параметр из ссылки бота, иначе роль сессии
  // формат: <роль|компания>[_<раздел>] — например c1_book, owner_cal
  const raw = (startParam() || new URLSearchParams(location.search).get('start') || '').toLowerCase();
  const [sp, section] = raw.split('_');
  const SECTIONS = {
    client: { book: 'cl.book', my: 'cl.my', profile: 'cl.profile', find: 'cl.find' },
    owner: { cal: 'o.cal', clients: 'o.clients', sub: 'o.subscription', ai: 'ai.home', more: 'o.more' },
    employee: { cal: 'e.cal', clients: 'e.clients' },
  };
  const tgName = () => { const u = tgUser(); return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : ''; };
  let def = { r: 'o.home', p: {} };
  // ссылка салона — привязка. Ставится один раз и дальше живёт в сессии:
  // салон, который привёл клиента, не теряет его из-за похода в каталог
  if (S.data.companies.some(c => c.id === sp)) {
    S.session.role = 'client';
    setHome(sp);
    ensurePerson(tgName());
    def = { r: SECTIONS.client[section] || 'cl.company', p: {} };
  } else if (sp === 'admin') {
    // панель Super Admin: только белый список Telegram ID или верный секретный код
    const key = new URLSearchParams(location.search).get('key');
    const ok = adminAllowed(tgUser()) || (key ? await unlockWithCode(key) : false);
    if (key) history.replaceState(null, '', location.pathname + location.hash);
    if (ok) { S.session.role = 'admin'; def = { r: 'sa.home', p: {} }; }
    else { S.session.role = 'owner'; def = { r: 'o.home', p: {} }; }
  }
  // пришёл заводить бизнес: сначала витрина, а не сразу форма
  else if (sp === 'create') { def = { r: 'biz.start', p: {} }; }
  // человек открыл бота сам, без ссылки салона: салон за него не выбираем,
  // первым делом ему нужен поиск
  else if (sp === 'client' || sp === 'find') {
    S.session.role = 'client';
    S.session.homeId = null;
    ensurePerson(tgName());
    def = { r: SECTIONS.client[section] || 'cl.find', p: {} };
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
    const clientHome = homeId() ? 'cl.company' : 'cl.find';
    def = { r: r === 'client' ? clientHome : r === 'employee' ? 'e.home' : r === 'admin' ? 'sa.home' : 'o.home', p: {} };
  }
  // привязанный клиент всегда открывается на своём салоне, даже если в прошлый
  // раз ушёл смотреть чужой: последний просмотренный салон — не его дом
  if (S.session.role === 'client' && homeId()) viewCompany(homeId());

  // ссылка из адресной строки не должна открывать экран чужой роли
  // Сотруднику открыты и разделы салона: настоящий гейт теперь не этот
  // список, а право маршрута (perm) — оно работает и на переходах, и на
  // адресе из строки браузера, а раньше проверки не было вовсе.
  // витрина для бизнеса (biz.) открыта всем: на неё приходят до того,
  // как у человека появилась хоть какая-то роль
  const ROLE_OK = {
    owner: /^(o\.|ai\.|biz\.|onb$)/, employee: /^(e\.|o\.|ai\.|biz\.|onb$)/,
    client: /^(cl\.|biz\.|onb$)/, admin: /^(sa\.|o\.|ai\.|biz\.|onb$)/,
  };
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (h && !(ROLE_OK[S.session.role] || /./).test(h)) location.hash = '';
  // «свой салон» нельзя открыть тому, у кого своего салона нет: иначе
  // старый адрес показал бы ему чужой салон как его собственный
  if (S.session.role === 'client' && !homeId() && h === 'cl.company') location.hash = '';

  sub(() => render(false));
  // Справочник уходит на сервер после любого изменения данных, с задержкой:
  // бот читает оттуда салоны и услуги. Если сервера нет, sync молча
  // отключается — приложение работает на localStorage, как раньше.
  sub(() => pushCatalog());
  $('#boot') && $('#boot').remove();
  bootRoute(def);
  // Записи из чата бота подтягиваем после первой отрисовки, чтобы не
  // задерживать открытие: сеть может и не ответить.
  syncOnBoot().catch(() => { });
  window.addEventListener('resize', () => { });
}

boot();

// отладочный доступ из консоли
window.__zapis = { S, go, emit, applyTheme };
