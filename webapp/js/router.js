import { $, esc } from './ui.js';
import { icon } from './icons.js';
import { haptic, setBackButton } from './tg.js';
import { S } from './store.js';

export const routes = {};
export function route(name, def) { routes[name] = def; }

let stack = [];
let rendering = false;

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
  if (opts.replace || !stack.length) stack[Math.max(0, stack.length - 1)] = { r, p };
  else if (opts.root) stack = [{ r, p }];
  else stack.push({ r, p });
  syncHash(); render(true);
}
export function back() {
  if (stack.length > 1) { stack.pop(); haptic('light'); syncHash(); render(true); }
}
export function canBack() { return stack.length > 1; }
export function resetStack(r, p = {}) { stack = [{ r, p }]; syncHash(); render(true); }

let ignoreHash = false;
function syncHash() { ignoreHash = true; location.hash = toHash(current()); setTimeout(() => ignoreHash = false, 20); }
window.addEventListener('hashchange', () => {
  if (ignoreHash) return;
  const e = fromHash();
  if (!e) return;
  if (stack.length > 1 && stack[stack.length - 2].r === e.r) stack.pop();
  else stack.push(e);
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
  client: [
    { r: 'cl.company', t: 'Салон', i: 'home' },
    { r: 'cl.my', t: 'Мои записи', i: 'calendar' },
    { r: 'cl.profile', t: 'Профиль', i: 'user' },
  ],
  admin: [
    { r: 'sa.home', t: 'Обзор', i: 'chart' },
    { r: 'sa.companies', t: 'Компании', i: 'building' },
    { r: 'sa.settings', t: 'Система', i: 'gear' },
  ],
};
export const tabsFor = role => TABS[role] || TABS.owner;

function tabbar() {
  const tabs = tabsFor(S.session.role);
  const cur = current();
  const def = routes[cur.r] || {};
  const active = def.tab || cur.r;
  return `<nav class="tabbar">${tabs.map(t => `
    <button class="tab ${active === t.r ? 'on' : ''}" data-a="tab" data-r="${t.r}">
      ${icon(t.i, 23, active === t.r ? 2.1 : 1.8)}<span class="lb">${esc(t.t)}</span>
    </button>`).join('')}</nav>`;
}

/* ---------- render ---------- */
export function render(fresh = false) {
  if (rendering) return;
  rendering = true;
  const e = current();
  const def = routes[e.r];
  const app = $('#app');
  const noTab = def.noTab || !tabsFor(S.session.role).length;
  document.body.dataset.tab = noTab ? '0' : '1';
  let html = '';
  try { html = def.render(e.p) || ''; }
  catch (err) { console.error('render error', e.r, err); html = `<div class="wrap"><div class="empty"><div class="t">Что-то пошло не так</div><div class="s">${esc(err.message)}</div></div></div>`; }
  app.innerHTML = `<div class="screen ${noTab ? 'no-tab' : ''} ${def.fab ? 'has-fab' : ''}" id="screen">${html}</div>` +
    (noTab ? '' : tabbar()) + (def.fab ? def.fab() : '');
  if (fresh) window.scrollTo(0, 0);
  if (def.mount) { try { def.mount(e.p, $('#screen')); } catch (err) { console.error(err); } }
  setBackButton(canBack() ? back : null);
  rendering = false;
}

/* ---------- инициализация ---------- */
export function bootRoute(defRoute) {
  const e = fromHash();
  stack = [e || defRoute];
  syncHash();
  render(true);
}
