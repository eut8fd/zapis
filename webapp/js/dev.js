// Скрытая DEV-панель: роли, компании, машина времени, тестовые уведомления.
import { S, emit, sub, now, allCompanies, emps, clients, staff, autoComplete, reset, nextAppt, co, client, apptTitle } from './store.js';
import { sheet, toast, esc, confirmSheet, hhmm, dateLabel, money, avatar, plural } from './ui.js';
import { icon } from './icons.js';
import { on } from './bus.js';
import { go, resetStack, render } from './router.js';
import { haptic } from './tg.js';

import { adminAllowed, unlockWithCode, lockAdmin, isWhitelisted } from './config.js';
import { tgUser } from './tg.js';
import { promptSheet } from './ui.js';

const ROLES = [
  ['client', 'Клиент', 'Записывается через ссылку', 'cl.company'],
  ['employee', 'Сотрудник', 'Видит свои записи', 'e.home'],
  ['owner', 'Владелец', 'Управляет бизнесом', 'o.home'],
  ['admin', 'Super Admin', 'Панель SaaS', 'sa.home'],
];

const TIME = [
  ['Сейчас', 0], ['+2 часа', 2 * 3600000], ['+1 день', 86400000],
  ['+7 дней', 7 * 86400000], ['−1 день', -86400000],
];

/* кнопка вызова панели */
function mountFab() {
  const host = document.querySelector('#devdock');
  host.innerHTML = `<button class="dev-fab ${S.shift ? 'on' : ''}" data-a="dev.open" title="Демо-панель">${icon('shield', 19)}</button>`;
}
mountFab();
sub(mountFab);

on('dev.open', () => {
  const s = sheet({ title: 'Демо-панель', body: body() });
  window.__dev = s;
});

function body() {
  const cs = allCompanies().filter(c => !c.id.startsWith('bg'));
  const t = now();
  const nx = nextAppt();
  return `
  <div class="tiny muted b" style="margin-bottom:8px">РОЛЬ</div>
  <div class="role-grid" style="margin-bottom:18px">
    ${ROLES.map(r => {
    const locked = r[0] === 'admin' && !adminAllowed(tgUser());
    return `<button class="role ${S.session.role === r[0] ? 'on' : ''}" data-a="dev.role" data-v="${r[0]}">
      <div class="t">${r[1]} ${locked ? `<span style="color:var(--tx-3);vertical-align:-2px">${icon('lock', 13, 2.4)}</span>` : ''}</div>
      <div class="s">${locked ? 'нужен доступ' : r[2]}</div></button>`;
  }).join('')}
  </div>

  <div class="tiny muted b" style="margin-bottom:8px">КОМПАНИЯ</div>
  <div class="stack s" style="margin-bottom:18px">
    ${cs.map(c => `<button class="lrow press" style="border-radius:14px;border:1.5px solid ${S.session.companyId === c.id ? 'var(--p)' : 'var(--bd)'};width:100%;${S.session.companyId === c.id ? 'background:var(--p-soft)' : ''}" data-a="dev.co" data-id="${c.id}">
      <div class="av s av-sq" style="background:${c.color === '#0D1220' ? 'var(--tx)' : c.color}">${esc(c.initials)}</div>
      <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
        <div class="st">${emps(c.id).length} сотр. · ${clients(c.id).length} клиентов · ${c.plan}</div></div>
      ${S.session.companyId === c.id ? `<span style="color:var(--p)">${icon('checkCircle', 19)}</span>` : ''}
    </button>`).join('')}
  </div>

  <div class="tiny muted b" style="margin-bottom:8px">МАШИНА ВРЕМЕНИ</div>
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

function redraw() { if (window.__dev) window.__dev.set({ title: 'Демо-панель', body: body() }); }

function rootFor(role) {
  return role === 'client' ? 'cl.company' : role === 'employee' ? 'e.home' : role === 'admin' ? 'sa.home' : 'o.home';
}

export function switchRole(role, companyId) {
  const cidNew = companyId || S.session.companyId;
  S.session.role = role;
  S.session.companyId = cidNew;
  const st = staff(cidNew);
  const owner = emps(cidNew).find(e => e.isOwner) || st[0];
  S.session.employeeId = role === 'owner' ? (owner ? owner.id : null) : (st[0] ? st[0].id : null);
  const cl = clients(cidNew)[0];
  S.session.clientId = cl ? cl.id : null;
  emit();
  resetStack(rootFor(role));
}

on('dev.role', async ds => {
  if (ds.v === 'admin' && !adminAllowed(tgUser())) { await askAdminCode(); return; }
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
  switchRole(S.session.role, ds.id);
  window.__dev && window.__dev.close();
  const c = allCompanies().find(x => x.id === ds.id);
  toast('Компания: ' + c.name);
});
on('dev.time', ds => {
  const ms = +ds.ms;
  if (ms === 0) S.shift = 0; else S.shift += ms;
  autoComplete();
  emit(); redraw(); mountFab();
  toast(ms === 0 ? 'Время сброшено' : 'Время сдвинуто');
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
