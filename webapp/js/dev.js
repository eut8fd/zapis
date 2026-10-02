// Скрытая DEV-панель: роли, компании, тестовая дата, тестовые уведомления.
import { S, emit, sub, now, allCompanies, emps, clients, staff, autoComplete, reset, nextAppt, co, client, apptTitle, setHome, isManager, setRole, isServer } from './store.js';
import { session } from './sync.js';
import { api } from './api.js';
import { sheet, toast, esc, confirmSheet, hhmm, dateLabel, money, avatar, plural } from './ui.js';
import { icon } from './icons.js';
import { on } from './bus.js';
import { go, resetStack, render } from './router.js';
import { haptic } from './tg.js';

import { adminAllowed, unlockWithCode, lockAdmin, isWhitelisted } from './config.js';
import { tgUser } from './tg.js';
import { promptSheet } from './ui.js';

/* Персона «Клиент с улицы» ушла вместе с каталогом: клиент бывает только
   один — тот, кто пришёл по ссылке салона. */
const ROLES = [
  ['client', 'Клиент салона', 'Пришёл по ссылке', 'cl.company'],
  ['employee', 'Мастер', 'Видит свой день', 'e.home'],
  ['manager', 'Администратор', 'Весь салон, без денег', 'e.home'],
  ['owner', 'Владелец', 'Управляет бизнесом', 'o.home'],
  ['admin', 'Super Admin', 'Панель SaaS', 'sa.home'],
];

/** Какая персона сейчас выбрана. */
const persona = () => {
  if (S.session.role === 'employee') return isManager() ? 'manager' : 'employee';
  return S.session.role;
};

const TIME = [
  ['Сейчас', 0], ['+2 часа', 2 * 3600000], ['+1 день', 86400000],
  ['+7 дней', 7 * 86400000], ['−1 день', -86400000],
];

/* кнопка вызова панели. В серверном режиме панель — инструмент
   администратора платформы: обычному владельцу переключать роли незачем,
   а клиенту — тем более. */
const adminHere = () => !!(session() && session().identity && session().identity.isAdmin);
export function mountFab() {
  const host = document.querySelector('#devdock');
  if (!host) return;
  if (isServer() && !adminHere()) { host.innerHTML = ''; return; }
  host.innerHTML = `<button class="dev-fab ${S.shift ? 'on' : ''}" data-a="dev.open" title="Демо-панель">${icon('shield', 19)}</button>`;
}
mountFab();
sub(mountFab);

on('dev.open', () => {
  if (isServer() && !adminHere()) return;
  const s = sheet({ title: isServer() ? 'Панель администратора' : 'Демо-панель', body: isServer() ? serverBody() : body() });
  window.__dev = s;
});

/* Панель в серверном режиме: открыть любую компанию как её владелец,
   зайти в Super Admin, загрузить демо-данные на пустой сервер, проверить
   доставку сообщений. Без сброса: удалять данные людей отсюда нельзя. */
function serverBody() {
  const cs = allCompanies();
  return `
  <div class="tiny muted b" style="margin-bottom:8px">РЕЖИМ</div>
  <div class="role-grid" style="margin-bottom:18px">
    <button class="role ${S.session.role !== 'admin' ? 'on' : ''}" data-a="dev.asOwner"><div class="t">Кабинет компании</div><div class="s">Глазами владельца</div></button>
    <button class="role ${S.session.role === 'admin' ? 'on' : ''}" data-a="dev.role" data-v="admin"><div class="t">Super Admin</div><div class="s">Панель платформы</div></button>
  </div>
  <div class="tiny muted b" style="margin-bottom:8px">КОМПАНИЯ</div>
  <div class="stack s" style="margin-bottom:18px">
    ${cs.length ? cs.map(c => `<button class="lrow press" style="border-radius:14px;border:1.5px solid ${S.session.companyId === c.id ? 'var(--p)' : 'var(--bd)'};width:100%;${S.session.companyId === c.id ? 'background:var(--p-soft)' : ''}" data-a="dev.co" data-id="${c.id}">
      ${avatar({ initials: c.initials, color: c.color, photo: c.logo }, 's', 'av-sq')}
      <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
        <div class="st">${emps(c.id).length} сотр. · ${clients(c.id).length} клиентов · ${c.plan}</div></div>
      ${S.session.companyId === c.id ? `<span style="color:var(--p)">${icon('checkCircle', 19)}</span>` : ''}
    </button>`).join('') : '<div class="sm muted">Компаний на сервере пока нет.</div>'}
  </div>
  <div class="tiny muted b" style="margin-bottom:8px">СЕРВЕР</div>
  <div class="stack s">
    <button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="dev.notifyTest">
      <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('bell', 18)}</div>
      <div class="grow" style="text-align:left"><div class="tl">Тестовое сообщение себе</div>
        <div class="st">Проверить, что бот и адрес приложения настроены</div></div></button>
    <button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="dev.seed">
      <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('play', 18)}</div>
      <div class="grow" style="text-align:left"><div class="tl">Загрузить демо-компании</div>
        <div class="st">Beauty Studio Lumière, BLADE и другие — для показа</div></div></button>
  </div>
  <div class="tiny dim center" style="margin-top:14px">Панель видна только администраторам платформы.</div>`;
}

function body() {
  const cs = allCompanies().filter(c => !c.id.startsWith('bg'));
  const t = now();
  const nx = nextAppt();
  return `
  <div class="tiny muted b" style="margin-bottom:8px">РОЛЬ</div>
  <div class="role-grid" style="margin-bottom:18px">
    ${ROLES.map(r => {
    const locked = r[0] === 'admin' && !adminAllowed(tgUser());
    return `<button class="role ${persona() === r[0] ? 'on' : ''}" data-a="dev.role" data-v="${r[0]}">
      <div class="t">${r[1]} ${locked ? `<span style="color:var(--tx-3);vertical-align:-2px">${icon('lock', 13, 2.4)}</span>` : ''}</div>
      <div class="s">${locked ? 'нужен доступ' : r[2]}</div></button>`;
  }).join('')}
  </div>

  <div class="tiny muted b" style="margin-bottom:8px">КОМПАНИЯ</div>
  <div class="stack s" style="margin-bottom:18px">
    ${cs.map(c => `<button class="lrow press" style="border-radius:14px;border:1.5px solid ${S.session.companyId === c.id ? 'var(--p)' : 'var(--bd)'};width:100%;${S.session.companyId === c.id ? 'background:var(--p-soft)' : ''}" data-a="dev.co" data-id="${c.id}">
      ${avatar({ initials: c.initials, color: c.color, photo: c.logo }, 's', 'av-sq')}
      <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
        <div class="st">${emps(c.id).length} сотр. · ${clients(c.id).length} клиентов · ${c.plan}</div></div>
      ${S.session.companyId === c.id ? `<span style="color:var(--p)">${icon('checkCircle', 19)}</span>` : ''}
    </button>`).join('')}
  </div>

  <div class="tiny muted b" style="margin-bottom:8px">ТЕСТОВАЯ ДАТА</div>
  <div class="card flat" style="padding:12px 14px;margin-bottom:10px">
    <div class="row between"><span class="sm muted">Сейчас в демо</span>
      <b>${t.getDate()} ${['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][t.getMonth()]}, ${hhmm(t)}</b></div>
    ${S.shift ? `<div class="tiny" style="color:var(--warn);margin-top:4px">сдвиг ${S.shift > 0 ? '+' : ''}${Math.round(S.shift / 3600000)} ч</div>` : ''}
  </div>
  <div class="pick" style="margin-bottom:18px">
    ${TIME.map(x => `<button class="o ${x[1] === 0 && !S.shift ? 'on' : ''}" data-a="dev.time" data-ms="${x[1]}">${x[0]}</button>`).join('')}
  </div>

  <div class="tiny muted b" style="margin-bottom:8px">ТЕСТ</div>
  <div class="stack s">
    <button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="dev.reminder">
      <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('bell', 18)}</div>
      <div class="grow" style="text-align:left"><div class="tl">Тестовое напоминание</div>
        <div class="st">${nx ? 'по записи ' + hhmm(new Date(nx.start)) : 'нет ближайших записей'}</div></div></button>
    <button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="dev.onb">
      <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('play', 18)}</div>
      <div class="grow" style="text-align:left"><div class="tl">Пройти онбординг</div>
        <div class="st">Создать новый бизнес с нуля</div></div></button>
    <button class="lrow press" style="border-radius:14px;border:1px solid var(--dan-soft);background:var(--dan-soft);width:100%" data-a="dev.reset">
      <div class="ic" style="background:var(--dan);color:#fff">${icon('refresh', 18)}</div>
      <div class="grow" style="text-align:left"><div class="tl" style="color:var(--dan)">Сбросить демо</div>
        <div class="st">Вернуть исходные данные</div></div></button>
  </div>
  <div class="tiny dim center" style="margin-top:14px">Панель нужна только для демонстрации.<br>В продакшене она отключена.</div>`;
}

function redraw() { if (window.__dev) window.__dev.set({ title: isServer() ? 'Панель администратора' : 'Демо-панель', body: isServer() ? serverBody() : body() }); }

on('dev.asOwner', () => {
  const c = allCompanies().find(x => x.id === S.session.companyId) || allCompanies()[0];
  if (!c) { toast('Компаний нет', 'dan'); return; }
  switchRole('owner', c.id);
  window.__dev && window.__dev.close();
});
on('dev.notifyTest', async () => {
  try { await api.notifyTest(); toast('Сообщение отправлено — проверьте чат с ботом'); }
  catch (e) { toast(e.message || 'Не удалось', 'dan'); }
});
on('dev.seed', async () => {
  const ok = await confirmSheet({
    title: 'Загрузить демо-компании?',
    text: 'На сервер добавятся демо-салоны с мастерами, услугами и историей записей. Они нужны для показа и не мешают настоящим компаниям.',
    ok: 'Загрузить',
  });
  if (!ok) return;
  const { buildSeed } = await import('./seed.js');
  const { startOfDay } = await import('./ui.js');
  const seed = buildSeed(startOfDay(new Date()));
  const data = {};
  // платформенные таблицы и журналы не трогаем: тарифы на сервере уже есть
  ['companies', 'employees', 'services', 'clients', 'appointments', 'blocks', 'incomes', 'expenses', 'recurring', 'reviews', 'broadcasts']
    .forEach(k => { data[k] = seed[k] || []; });
  try {
    const r = await api.admin.seed(data);
    toast('Загружено записей: ' + r.applied);
    window.__dev && window.__dev.close();
    setTimeout(() => location.reload(), 600);
  } catch (e) { toast(e.message || 'Не удалось загрузить', 'dan'); }
});

function rootFor(role) {
  return role === 'client' ? 'cl.company'
    : (role === 'employee' || role === 'manager') ? 'e.home'
      : role === 'admin' ? 'sa.home' : 'o.home';
}

export function switchRole(role, companyId) {
  const manager = role === 'manager';
  const real = manager ? 'employee' : role;
  // В списке панели только основные компании. Если сейчас открыт один из
  // дополнительных салонов сида (bg*), переключаться надо на демонстрационный —
  // иначе роль привяжется к компании, которой в списке нет.
  const cur = String(S.session.companyId || '');
  const cidNew = companyId || (cur.startsWith('bg') ? 'c1' : cur);
  S.session.role = real;
  S.session.companyId = cidNew;
  const st = staff(cidNew);
  const owner = emps(cidNew).find(e => e.isOwner) || st[0];
  // На роль сотрудника берём не владельца: в маленькой компании владелец сам
  // принимает клиентов и попадает в staff(), а ему can() разрешает всё —
  // и демонстрация прав превращалась в демонстрацию их отсутствия.
  const worker = st.find(x => !x.isOwner) || st[0];
  S.session.employeeId = real === 'owner' ? (owner ? owner.id : null) : (worker ? worker.id : null);
  // Администратор и мастер — один и тот же экранный набор, разница в правах.
  // Поэтому персону выставляем уровнем доступа выбранного сотрудника.
  if (real === 'employee' && S.session.employeeId) setRole(S.session.employeeId, manager ? 'manager' : 'staff');
  const cl = clients(cidNew)[0];
  S.session.clientId = cl ? cl.id : null;
  if (real === 'client') {
    // персона клиента берётся заново целиком: история из прошлого салона
    // в новом человеку не принадлежит
    S.session.homeId = null; S.session.person = null; S.session.clientIds = {};
    setHome(cidNew);
  }
  emit();
  resetStack(rootFor(role));
}

on('dev.role', async ds => {
  if (isServer() && !adminHere()) return;
  if (!isServer() && ds.v === 'admin' && !adminAllowed(tgUser())) { await askAdminCode(); return; }
  switchRole(ds.v);
  window.__dev && window.__dev.close();
  toast('Роль: ' + (ROLES.find(r => r[0] === ds.v) || [])[1]);
});

/** Запрос секретного кода супер-админа */
export async function askAdminCode() {
  const code = await promptSheet({
    title: 'Доступ к Super Admin',
    label: 'Секретный код',
    placeholder: 'введите код',
    ok: 'Войти',
    password: true,
  });
  if (code === null) return false;
  const ok = await unlockWithCode(code);
  if (!ok) { toast('Неверный код', 'dan'); return false; }
  toast('Доступ открыт');
  switchRole('admin');
  window.__dev && window.__dev.close();
  return true;
}
on('sa.lock', () => {
  lockAdmin();
  toast('Доступ к Super Admin закрыт');
  switchRole('owner');
});
on('sa.askCode', () => askAdminCode());
on('dev.co', ds => {
  // смена компании не должна превращать человека с улицы в клиента салона
  switchRole(persona(), ds.id);
  window.__dev && window.__dev.close();
  const c = allCompanies().find(x => x.id === ds.id);
  toast('Компания: ' + c.name);
});
on('dev.time', ds => {
  const ms = +ds.ms;
  if (ms === 0) S.shift = 0; else S.shift += ms;
  autoComplete();
  emit(); redraw(); mountFab();
  toast(ms === 0 ? 'Тестовая дата сброшена' : 'Тестовая дата сдвинута');
});
on('dev.reminder', () => {
  const a = nextAppt();
  window.__dev && window.__dev.close();
  setTimeout(() => {
    if (!a) { toast('Нет ближайших записей', 'dan'); return; }
    const c = client(a.clientId);
    const ai = c && c.ai;
    sheet({
      title: 'Напоминание',
      body: `<div class="card pad" style="background:var(--p-soft);border-color:transparent;margin-bottom:12px">
          <div class="row" style="gap:8px;color:var(--p);margin-bottom:6px">${icon('bell', 18)}<b class="sm">Через 30 минут — ${esc(c ? c.name.split(' ')[0] : 'клиент')}</b></div>
          <div class="sm" style="color:var(--tx-2)">${hhmm(new Date(a.start))} · ${esc(apptTitle(a))} · ${money(a.price)}</div>
        </div>
        ${ai && (ai.prefs.length || ai.care.length) ? `<div class="card pad" style="background:var(--ai-soft);border-color:transparent">
          <div class="row" style="gap:8px;color:var(--ai);margin-bottom:6px">${icon('sparkles', 17)}<b class="sm">AI-шпаргалка</b></div>
          <div class="sm" style="line-height:1.6;color:var(--tx-2)">${[...ai.prefs, ...ai.care, ...ai.next].map(x => '• ' + esc(x)).join('<br>')}</div>
        </div>` : '<div class="sm muted">У клиента пока нет AI-заметок.</div>'}`,
      footer: `<button class="btn p" data-a="ap.card" data-id="${a.id}">Открыть запись</button>`,
    });
  }, 280);
});
on('dev.onb', () => { window.__dev && window.__dev.close(); setTimeout(() => resetStack('onb'), 240); });
on('dev.reset', async () => {
  const ok = await confirmSheet({ title: 'Сбросить демо?', text: 'Все изменения исчезнут, вернутся исходные данные.', ok: 'Сбросить', danger: true });
  if (!ok) return;
  reset();
  window.__dev && window.__dev.close();
  toast('Демо сброшено');
  resetStack('o.home');
});
