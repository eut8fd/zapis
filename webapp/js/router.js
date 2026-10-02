import { $, esc, t as tr, topSheet, closeAllSheets, onSheetsChanged } from './ui.js';
import { icon, iconFill } from './icons.js';
import { haptic, setBackButton } from './tg.js';
import { S, reportError, can, roleName, me } from './store.js';

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
  // Открытая шторка — это верхний слой интерфейса. Пока она есть, «назад»
  // относится к ней: иначе кнопка Telegram уводила с экрана, а шторка
  // оставалась висеть поверх чужого — человек оказывался не там, где был.
  const sheet = topSheet();
  if (sheet) { haptic('light'); sheet.close(); return; }
  if (stack.length > 1) { navMotion = 'back'; stack.pop(); haptic('light'); syncHash(); render(true); }
}
export function canBack() { return stack.length > 1 || !!topSheet(); }
export function resetStack(r, p = {}) { navMotion = 'replace'; stack = [{ r, p }]; syncHash(); render(true); }

// Шторка открылась или закрылась — системная кнопка «назад» должна это учесть.
onSheetsChanged(() => setBackButton(canBack() ? back : null));

function syncHash() { location.hash = toHash(current()); }

const sameEntry = (a, b) => !!a && !!b && a.r === b.r && toHash(a) === toHash(b);

window.addEventListener('hashchange', () => {
  const e = fromHash();
  if (!e) return;
  // Раньше собственный syncHash отсекался флагом на 20 мс. В WebView
  // Telegram событие иногда приходит позже, флаг успевал сброситься —
  // и экран добавлялся в стек второй раз. После этого «назад» либо не
  // делал ничего, либо прыгал через экран. Сравниваем с вершиной стека:
  // это не зависит от того, когда браузер решит прислать событие.
  if (sameEntry(current(), e)) return;
  if (stack.length > 1 && sameEntry(stack[stack.length - 2], e)) { navMotion = 'back'; stack.pop(); }
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
    { r: 'e.home', t: 'Главная', i: 'home' },
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

/* У клиента ровно один салон — тот, чью ссылку он открыл. Поиска и
   каталога нет: первая вкладка навсегда принадлежит этому салону. */
const clientTabs = () => [
  { r: 'cl.company', t: 'Салон', i: 'home' },
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
  // tab может быть функцией: экран вправе решать, какую вкладку подсветить,
  // уже во время отрисовки — например по правам текущей роли
  const active = (typeof def.tab === 'function' ? def.tab() : def.tab) || cur.r;
  return `<nav class="tabbar">${tabs.map(t => `
    <button class="tab ${active === t.r ? 'on' : ''} ${active === t.r && tabPulse === t.r ? 'tab-pulse' : ''}" data-a="tab" data-r="${t.r}">
      <span class="tab-ic">${active === t.r ? iconFill(t.i, 24) : icon(t.i, 24, 1.9)}</span><span class="lb">${esc(tr(t.t))}</span>
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
    // Шторка принадлежит экрану. Если переход случился не через «назад»
    // (например, из самой шторки открыли другой раздел), она не должна
    // остаться висеть поверх нового экрана.
    if (fresh) closeAllSheets();
    // Telegram WebView по-разному реализует View Transitions: на части
    // устройств снимки мерцают и меняют размер fixed-кнопок. Однослойная
    // CSS-анимация предсказуема и не накладывает старый интерфейс на новый.
    // Переход по стеку двигает весь экран; смена вкладки — только
    // карточки, каскадом. Двойное движение смотрится суетливо.
    const cascade = animate && (motion === 'tab' || motion === 'replace');
    const enter = animate && !cascade ? ` nav-enter nav-${motion}` : '';
    app.innerHTML = `<div class="screen ${noTab ? 'no-tab' : ''} ${def.fab ? 'has-fab' : ''}${enter}" id="screen">${html}</div>` +
      (noTab ? '' : tabbar()) + (def.fab ? def.fab() : '');
    if (cascade) stagger($('#screen'));
    tabPulse = null;
    if (fresh) window.scrollTo(0, 0);
    if (def.mount) { try { def.mount(e.p, $('#screen')); } catch (err) { console.error(err); } }
    setBackButton(canBack() ? back : null);
    rendering = false;
  };
  paint();
}

/* Каскад появления: первым карточкам экрана по порядку в DOM
   выдаётся номер — CSS превращает его в задержку. Вложенные не
   считаем (карточка внутри карточки поднималась бы дважды), дальше
   десятка с лишним элементов — не ждём: они ниже экрана. */
const RISE = '.card,.kpis,.kpi,.mkpi,.grid2,.grid3,.hero,.ai-hero,.statbar,.appt,.svc,.mcard,.ai-card,.ins,.wgrid,.mcal,.cal-range-day,.cat-tile,.biz-fact,.st-card,.empty,.pub-cta,.sec-h,.chips,.acts,.cal-view-switch,.pub-hero,.cal-summary-wrap,.setup-list';
function stagger(root) {
  if (!root) return;
  let i = 0;
  for (const el of root.querySelectorAll(RISE)) {
    if (i >= 16) break;
    if (el.parentElement && el.parentElement.closest(RISE)) continue;
    el.classList.add('rise');
    el.style.setProperty('--i', i++);
  }
}

/* ---------- инициализация ---------- */
export function bootRoute(defRoute) {
  const e = fromHash();
  stack = [e || defRoute];
  syncHash();
  render(true);
}
