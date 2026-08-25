/* =========================================================
   Вход в команду по приглашению
   ---------------------------------------------------------
   Владелец делает ссылку с уже выбранной ролью, человек по ней переходит
   и оказывается в команде. Ссылка одноразовая.

   Приглашение лежит в общем складе, а не в браузере владельца: ссылку
   создают на одном устройстве, открывают на другом. Поэтому экран сначала
   спрашивает сервер и только потом решает, что показать.

   Имя и username берём из Telegram — человек их уже вводил один раз,
   второй раз спрашивать незачем. Телефон Telegram отдаёт только по явному
   согласию, отдельным запросом: есть метод — кнопка, нет — поле для ввода.
   ========================================================= */
import { S, co, acceptInvite, inviteById, inviteState, ROLES, emit } from '../store.js';
import { esc, sheet, toast, avatar, loadingBlock, wait, t } from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render, resetStack } from '../router.js';
import { on } from '../bus.js';
import { haptic, tgUsername, tgFullName, tgId, requestPhone, canRequestPhone } from '../tg.js';
import { fetchInvite, patchInvite } from '../sync.js';

const rr = () => render(false);

// Состояние экрана: приглашение ещё грузится, уже загружено или не найдено.
const st = { id: null, loading: true, inv: null, name: '', phone: '', asked: false };

/** Открыть экран приглашения. Зовётся из main.js по ссылке. */
export function openInvite(id) {
  st.id = id;
  st.loading = true;
  st.inv = null;
  st.name = tgFullName();
  st.phone = '';
  st.asked = false;
  resetStack('inv.join', { id });
}

route('inv.join', {
  noTab: true,
  async mount(p) {
    const id = p.id || st.id;
    // Пришли прямо по ссылке — состояние ещё пустое, поднимаем его здесь.
    if (id !== st.id) { st.id = id; st.loading = true; st.inv = null; st.phone = ''; }
    if (!st.name) st.name = tgFullName();
    if (!st.loading) return;
    // Сначала смотрим у себя: владелец, открывший собственную ссылку,
    // не должен ждать сети.
    let inv = inviteById(id);
    if (!inv) inv = await fetchInvite(id);
    st.inv = inv;
    st.loading = false;
    rr();
  },
  render(p) {
    if (st.loading) {
      return `<div class="wrap" style="padding-top:80px">${loadingBlock(t('Проверяем приглашение…'))}</div>`;
    }
    const inv = st.inv;
    const state = inviteState(inv);
    if (state !== 'активна') return dead(state);

    const c = co(inv.companyId);
    if (!c) return dead('нет компании');
    const perms = (ROLES[inv.access] || ROLES.staff).perms.length;
    const uname = tgUsername();

    return `
    <div class="wrap" style="padding-top:calc(var(--safe-t) + 28px);text-align:center">
      ${avatar({ initials: c.initials, color: c.color, photo: c.logo || c.cover }, 'xl', 'av-sq')}
      <h1 style="font-size:24px;font-weight:800;letter-spacing:-.03em;margin:16px 0 6px">
        ${t('Вас приглашают в команду')}</h1>
      <div class="sm" style="color:var(--tx-2);line-height:1.5">
        ${esc(c.name)} · ${esc(c.city)}</div>
    </div>

    <div class="wrap sec">
      <div class="card pad">
        <div class="row between" style="margin-bottom:10px">
          <div><div class="tiny muted">${t('Ваша роль')}</div>
            <div class="b" style="font-size:17px">${esc(inv.role)}</div></div>
          <span class="bdg p">${esc((ROLES[inv.access] || ROLES.staff).t)}</span>
        </div>
        <div class="sm" style="color:var(--tx-2)">${esc((ROLES[inv.access] || ROLES.staff).s)}
          · ${perms} ${t('прав')}</div>
      </div>
    </div>

    <div class="wrap sec"><div class="stack s">
      <div class="field"><label>${t('Как вас зовут')}</label>
        <input class="inp" id="_in" value="${esc(st.name)}" placeholder="${t('Имя')}"></div>

      ${uname ? `<div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('send', 18)}</div>
        <div class="grow"><div class="tl">@${esc(uname)}</div>
          <div class="st">${t('Из вашего профиля Telegram')}</div></div>
        <span style="color:var(--ok)">${icon('checkCircle', 19)}</span>
      </div>` : ''}

      ${st.phone ? `<div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
        <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('phone', 18)}</div>
        <div class="grow"><div class="tl">${esc(st.phone)}</div>
          <div class="st">${t('Телефон получен')}</div></div>
        <span style="color:var(--ok)">${icon('checkCircle', 19)}</span>
      </div>`
        : canRequestPhone()
          ? `<button class="btn gh" data-a="inv.phone">${icon('phone', 17)}${t('Взять телефон из Telegram')}</button>`
          : `<div class="field"><label>${t('Телефон')}</label>
              <input class="inp" id="_ip" type="tel" inputmode="tel" placeholder="+7 700 000 00 00"></div>
             <div class="tiny dim" style="padding:0 4px">${t('Telegram отдаёт номер только из своего приложения — здесь введите вручную.')}</div>`}
    </div></div>

    <div class="wrap sec">
      <button class="btn p" style="height:52px" data-a="inv.accept">${t('Присоединиться к команде')}</button>
      <div class="tiny dim center" style="margin-top:10px">
        ${t('Ссылка одноразовая — после входа она перестанет работать')}</div>
    </div>`;
  },
});

/** Ссылка уже погашена или просрочена — объясняем, а не показываем пустоту. */
function dead(state) {
  const why = {
    'использована': t('По этой ссылке уже вошли. Попросите новую — каждая работает один раз.'),
    'истекла': t('Срок ссылки вышел. Попросите владельца сделать новую.'),
    'отозвана': t('Приглашение отозвали.'),
  }[state] || t('Такого приглашения нет. Проверьте ссылку.');
  return `<div class="wrap" style="padding-top:70px"><div class="empty">
    <div class="il">${icon('lock', 34, 1.7)}</div>
    <div class="t">${t('Ссылка не работает')}</div>
    <div class="s">${esc(why)}</div>
  </div></div>`;
}

function capture() {
  const n = document.querySelector('#_in');
  if (n) st.name = n.value;
  const p = document.querySelector('#_ip');
  if (p) st.phone = p.value.trim() || st.phone;
}

on('inv.phone', async () => {
  capture();
  const sh = sheet({ title: t('Телефон'), body: loadingBlock(t('Ждём подтверждения в Telegram…')) });
  const phone = await requestPhone();
  sh.close();
  if (!phone) { toast(t('Телефон не получен — можно ввести вручную'), 'dan'); st.asked = true; rr(); return; }
  st.phone = phone;
  haptic('success');
  rr();
});

on('inv.accept', async () => {
  capture();
  if (!String(st.name).trim()) { toast(t('Введите имя'), 'dan'); return; }
  const sh = sheet({ title: t('Входим в команду'), body: loadingBlock(t('Оформляем…')) });
  await wait(900);
  const res = acceptInvite(st.id, {
    name: st.name, phone: st.phone,
    tg: tgUsername(), tgId: tgId(),
  });
  sh.close();
  if (!res.ok) { toast(t('Ссылка не работает'), 'dan'); st.inv = inviteById(st.id); rr(); return; }

  // Гасим ссылку и на сервере — иначе ею воспользуются с другого устройства
  patchInvite(st.id, { usedAt: new Date().toISOString(), usedBy: res.employee.id });

  S.session.role = 'employee';
  S.session.companyId = res.employee.companyId;
  S.session.employeeId = res.employee.id;
  emit();
  haptic('success');
  toast(t('Добро пожаловать в команду'));
  resetStack('e.home');
});
