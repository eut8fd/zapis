import { S, load, sub, emit } from './store.js';
import { initTelegram, tgColorScheme, startParam, tgUser, tg } from './tg.js';
import { adminAllowed, unlockWithCode } from './config.js';
import { bindDelegation, on } from './bus.js';
import { render, bootRoute, go, back, routes } from './router.js';
import { $ } from './ui.js';

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
  if (routes[r]) go(r, {}, { root: true, tabPulse: !!el?.classList.contains('tab') });
});
on('back', () => back());
on('nav', ds => { const p = {}; Object.keys(ds).forEach(k => { if (k !== 'a' && k !== 'r') p[k] = ds[k]; }); go(ds.r, p); });
on('noop', () => { });

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
  ]);

  // стартовый маршрут: параметр из ссылки бота, иначе роль сессии
  // формат: <роль|компания>[_<раздел>] — например c1_book, owner_cal
  const raw = (startParam() || new URLSearchParams(location.search).get('start') || '').toLowerCase();
  const [sp, section] = raw.split('_');
  const SECTIONS = {
    client: { book: 'cl.book', my: 'cl.my', profile: 'cl.profile' },
    owner: { cal: 'o.cal', clients: 'o.clients', sub: 'o.subscription', ai: 'ai.home', more: 'o.more' },
    employee: { cal: 'e.cal', clients: 'e.clients' },
  };
  let def = { r: 'o.home', p: {} };
  if (/^(c1|c2|c3)$/.test(sp)) {
    S.session.role = 'client'; S.session.companyId = sp;
    const cl = S.data.clients.find(c => c.companyId === sp);
    if (cl) S.session.clientId = cl.id;
    def = { r: SECTIONS.client[section] || 'cl.company', p: {} };
  } else if (sp === 'admin') {
    // панель Super Admin: только белый список Telegram ID или верный секретный код
    const key = new URLSearchParams(location.search).get('key');
    const ok = adminAllowed(tgUser()) || (key ? await unlockWithCode(key) : false);
    if (key) history.replaceState(null, '', location.pathname + location.hash);
    if (ok) { S.session.role = 'admin'; def = { r: 'sa.home', p: {} }; }
    else { S.session.role = 'owner'; def = { r: 'o.home', p: {} }; }
  }
  else if (sp === 'client') {
    S.session.role = 'client';
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

  // ссылка из адресной строки не должна открывать экран чужой роли
  const ROLE_OK = {
    owner: /^(o\.|ai\.|onb$)/, employee: /^(e\.|o\.client|o\.schedule|ai\.|onb$)/,
    client: /^(cl\.|onb$)/, admin: /^(sa\.|o\.|ai\.|onb$)/,
  };
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (h && !(ROLE_OK[S.session.role] || /./).test(h)) location.hash = '';

  sub(() => render(false));
  $('#boot') && $('#boot').remove();
  bootRoute(def);
  window.addEventListener('resize', () => { });
}

boot();

// отладочный доступ из консоли
window.__zapis = { S, go, emit, applyTheme };
