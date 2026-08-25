import { $, esc, t as tr } from './ui.js';
import { icon } from './icons.js';
import { haptic, setBackButton } from './tg.js';
import { S, reportError, isBound, can, roleName, me } from './store.js';

export const routes = {};
export function route(name, def) { routes[name] = def; }

let stack = [];
let rendering = false;
let navMotion = 'replace';
let tabPulse = null;

export const current = () => stack[stack.length - 1] || { r: 'o.home', p: {} };

function toHash(e) {
  const q = Object.entries(e.p || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  return '#/' + e.r + (q ? '?' + q : '');
}
function fromHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return null;
  const [r, q] = h.split('?');
  const p = {};
  (q || '').split('&').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); p[k] = decodeURIComponent(v || ''); });
  return routes[r] ? { r, p } : null;
}

export function go(r, p = {}, opts = {}) {
  if (!routes[r]) { console.warn('no route', r); return; }
  haptic('light');
  tabPulse = opts.tabPulse ? r : null;
  navMotion = opts.root ? 'tab' : opts.replace ? 'replace' : 'forward';
  if (opts.replace || !stack.length) stack[Math.max(0, stack.length - 1)] = { r, p };
  else if (opts.root) stack = [{ r, p }];
  else stack.push({ r, p });
  syncHash(); render(true);
}
export function back() {
  if (stack.length > 1) { navMotion = 'back'; stack.pop(); haptic('light'); syncHash(); render(true); }
}
export function canBack() { return stack.length > 1; }
export function resetStack(r, p = {}) { navMotion = 'replace'; stack = [{ r, p }]; syncHash(); render(true); }

let ignoreHash = false;
function syncHash() { ignoreHash = true; location.hash = toHash(current()); setTimeout(() => ignoreHash = false, 20); }
window.addEventListener('hashchange', () => {
  if (ignoreHash) return;
  const e = fromHash();
  if (!e) return;
  if (stack.length > 1 && stack[stack.length - 2].r === e.r) { navMotion = 'back'; stack.pop(); }
  else { navMotion = 'forward'; stack.push(e); }
  render(true);
});

/* ---------- tabbar ---------- */
const TABS = {
  owner: [
    { r: 'o.home', t: 'Главная', i: 'home' },
    { r: 'o.cal', t: 'Календарь', i: 'calendar' },
    { r: 'o.clients', t: 'Клиенты', i: 'users' },
    { r: 'o.team', t: 'Команда', i: 'userPlus' },
    { r: 'o.more', t: 'Ещё', i: 'grid' },
  ],
  employee: [
    { r: 'e.home', t: 'Сегодня', i: 'home' },
    { r: 'e.cal', t: 'Календарь', i: 'calendar' },
    { r: 'e.clients', t: 'Клиенты', i: 'users' },
    { r: 'e.profile', t: 'Профиль', i: 'user' },
  ],
  admin: [
    { r: 'sa.home', t: 'Обзор', i: 'chart' },
    { r: 'sa.companies', t: 'Компании', i: 'building' },
    { r: 'sa.settings', t: 'Система', i: 'gear' },
  ],
};

/* Первая вкладка клиента зависит от того, как он пришёл. Пришёл по ссылке
   салона — вкладка принадлежит салону, и каталога на ней нет. Пришёл сам —
   первым делом ему нужен поиск, а не чужой салон, выбранный за него. */
const clientTabs = () => [
  isBound()
    ? { r: 'cl.company', t: 'Салон', i: 'home' }
    : { r: 'cl.find', t: 'Поиск', i: 'search' },
  { r: 'cl.my', t: 'Мои записи', i: 'calendar' },
  { r: 'cl.profile', t: 'Профиль', i: 'user' },
];

/* Администратору салона открыт весь салон, поэтому у него есть «Ещё» —
   но внутри он увидит только разрешённые разделы (см. TILES в more.js).
   Без этой вкладки роль администратора была бы неотличима от мастера. */
function employeeTabs() {
  const base = TABS.employee.slice();
  if (!can('allCalendar')) return base;
  base.splice(3, 0, { r: 'o.more', t: 'Ещё', i: 'grid' });
  return base;
}

export const tabsFor = role => (role === 'client' ? clientTabs()
  : role === 'employee' ? employeeTabs()
    : TABS[role] || TABS.owner);

function tabbar() {
  const tabs = tabsFor(S.session.role);
  const cur = current();
  const def = routes[cur.r] || {};
  // tab может быть функцией: у клиента один и тот же экран салона светит
  // разную вкладку — свой салон это или открытый из каталога
  const active = (typeof def.tab === 'function' ? def.tab() : def.tab) || cur.r;
  return `<nav class="tabbar">${tabs.map(t => `
    <button class="tab ${active === t.r ? 'on' : ''} ${active === t.r && tabPulse === t.r ? 'tab-pulse' : ''}" data-a="tab" data-r="${t.r}">
      ${icon(t.i, 23, active === t.r ? 2.1 : 1.8)}<span class="lb">${esc(tr(t.t))}</span>
    </button>`).join('')}</nav>`;
}

/* Раздел закрыт правами. Показываем не пустоту, а объяснение: человек
   должен понять, что это не поломка, и к кому идти. */
function denied() {
  const who = roleName(me());
  return `<div class="wrap"><div class="empty">
    <div class="il">${icon('lock', 34, 1.7)}</div>
    <div class="t">${tr('Раздел закрыт')}</div>
    <div class="s">${tr('Ваша роль — {r}. Доступ к этому разделу открывает владелец в «Команде».', { r: who })}</div>
  </div></div>`;
}

/* ---------- render ---------- */
export function render(fresh = false) {
  if (rendering) return;
  rendering = true;
  const e = current();
  const def = routes[e.r];
  const app = $('#app');
  const noTab = def.noTab || !tabsFor(S.session.role).length;
  let html = '';
  // Право проверяется здесь, а не в экране: сюда приходят и переходы по
  // кнопкам, и адрес из строки браузера, и восстановление стека при запуске.
  if (def.perm && !can(def.perm)) {
    html = denied();
  } else {
  try { html = def.render(e.p) || ''; }
  catch (err) {
    console.error('render error', e.r, err);
    try { reportError('Экран не отрисовался: ' + err.message, { stack: err.stack || '', where: e.r }); } catch (x) { }
    html = `<div class="wrap"><div class="empty"><div class="t">Что-то пошло не так</div><div class="s">${esc(err.message)}</div></div></div>`;
  }
  }
  const motion = navMotion;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = fresh && !reduced && !!$('#screen', app);

  const paint = () => {
    document.body.dataset.tab = noTab ? '0' : '1';
    // Подсказки привязаны к экрану, но живут в #toasts, вне #app, и потому
    // переживают переход: «Записаться — одна кнопка» всплывала уже поверх
    // «Моих записей». Уходя с экрана, гасим их вместе с ним. Отметку
    // «показано» не ставим — человек её так и не прочитал.
    if (fresh) document.querySelectorAll('#toasts .tip').forEach(t => t.remove());
    // Telegram WebView по-разному реализует View Transitions: на части
    // устройств снимки мерцают и меняют размер fixed-кнопок. Однослойная
    // CSS-анимация предсказуема и не накладывает старый интерфейс на новый.
    const enter = animate ? ` nav-enter nav-${motion}` : '';
    app.innerHTML = `<div class="screen ${noTab ? 'no-tab' : ''} ${def.fab ? 'has-fab' : ''}${enter}" id="screen">${html}</div>` +
      (noTab ? '' : tabbar()) + (def.fab ? def.fab() : '');
    tabPulse = null;
    if (fresh) window.scrollTo(0, 0);
    if (def.mount) { try { def.mount(e.p, $('#screen')); } catch (err) { console.error(err); } }
    setBackButton(canBack() ? back : null);
    rendering = false;
  };
  paint();
}

/* ---------- инициализация ---------- */
export function bootRoute(defRoute) {
  const e = fromHash();
  stack = [e || defRoute];
  syncHash();
  render(true);
}
