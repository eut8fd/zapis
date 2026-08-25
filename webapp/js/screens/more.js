import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appts, apptTitle, apptColor, now, today,
  rangeStats, todayStats, dayAppts, clientStats, updateService, deleteService, createService,
  updateEmployee, removeEmployee, createEmployee, addMoney, removeMoney, setPlan, extendPlan, blocks, removeBlock, addBroadcast,
  broadcasts, reviews, lostClients, emit, toHM, toMin, nextFreeFor, workDay, workWindow, scheduleConflicts,
  ROLES, PERMS, roleOf, roleName, setRole, cats, catName, addCat, renameCat, removeCat,
  statsBetween, daysBetween, moneyOps, finCats, finCatName, finCatInfo, addFinCat, renameFinCat, removeFinCat,
  recurring, addRecurring, updateRecurring, removeRecurring, REPEAT, plans, planById, planPrice, PERIODS,
  setupSteps, markSetup, resetTips, tipSeen, markTip, appt, BRAND_COLORS, setCompanyColor,
  canOnlyMine, catalogReady, catalogMissing, setLang, can,
  createInvite, invites, inviteState, revokeInvite, ROLES as ACCESS,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, relPast, avatar, emptyState, sheet, toast, promptSheet,
  confirmSheet, demoNote, segmented, bars, sparkline, donut, progress, nMin, nAppt, nVisit, dayKey, startOfDay,
  addDays, WD, WD_FULL, MONTHS, MON_SHORT, num, plural, wait, loadingBlock, t,
  pickImage, photoField, IMG_MAX, monthGrid, dateFull, brandGradient,
} from '../ui.js';
import { icon, catIcon } from '../icons.js';
import { bookingLink } from './owner.js';
import { LANGS, lang } from '../i18n.js';
import { pushInvite, patchInvite } from '../sync.js';
import { route, go, render } from '../router.js';
import { on, fire } from '../bus.js';
import { newApptFlow, addServiceSheet, blockFlow, openApptSheet, absenceFlow, tipOnce } from '../flows.js';
import { haptic, copy, openLink } from '../tg.js';
import { BOT_USERNAME } from '../config.js';

const rr = () => render(false);

/* =========================================================
   Ещё
   ========================================================= */
// цвета плиток — только hex: из них считается полупрозрачная подложка иконки
// шестой элемент — право; без него раздел виден всем
const TILES = [
  ['o.services', 'briefcase', 'Услуги', 'Цены и длительность', '#4C6FFF', 'services'],
  ['o.team', 'users', 'Команда', 'Мастера и графики', '#12B76A', 'team'],
  ['ai.home', 'sparkles', 'AI-помощник', 'Анализ и тексты', '#8B5CF6', 'analytics'],
  ['o.finance', 'wallet', 'Финансы', 'Доходы и расходы', '#F79009', 'finance'],
  ['o.broadcasts', 'megaphone', 'Рассылки', 'Вернуть клиентов', '#EC4899', 'clients'],
  ['o.analytics', 'chart', 'Аналитика', 'Что растёт, что падает', '#0EA5E9', 'analytics'],
  ['o.reviews', 'star', 'Отзывы', 'Оценки после визитов', '#F5A524', 'analytics'],
  ['o.help', 'info', 'Обучение', 'Как всё устроено', '#12B76A', null],
  ['o.subscription', 'crown', 'Подписка', 'Тариф и оплата', '#F5A524', 'billing'],
  ['o.settings', 'gear', 'Настройки', 'Компания и профиль', '#7C8AA5', 'settings'],
];

route('o.more', {
  tab: 'o.more',
  render() {
    const c = co();
    const days = Math.ceil((new Date(c.planUntil) - now()) / 86400000);
    return `
    <div class="top"><div class="grow"><div class="top-t">Ещё</div><div class="top-sub">${esc(c.name)}</div></div></div>
    <div class="mgrid">
      ${TILES.filter(x => !x[5] || can(x[5])).map(t => `<button class="mcard" data-a="nav" data-r="${t[0]}">
        <div class="ic" style="background:${t[4]}1f;color:${t[4]}">${icon(t[1], 21)}</div>
        <div class="t">${t[2]}</div><div class="s">${t[3]}</div>
      </button>`).join('')}
    </div>
    ${!can('billing') ? '' : `<div class="wrap sec">
      <button class="card press" style="width:100%;padding:15px;display:flex;gap:12px;align-items:center;text-align:left" data-a="nav" data-r="o.subscription">
        <div class="tint" style="background:${days < 10 ? 'var(--dan-soft);color:var(--dan)' : 'var(--warn-soft);color:var(--warn)'};width:42px;height:42px">${icon('crown', 20)}</div>
        <div class="grow"><div class="b">Тариф ${esc(c.plan)}</div>
          <div class="sm ${days < 10 ? '' : 'muted'}" style="${days < 10 ? 'color:var(--dan)' : ''}">${days > 0 ? 'осталось ' + days + ' ' + plural(days, ['день', 'дня', 'дней']) : 'подписка истекла'}</div></div>
        <span class="bdg ${days < 10 ? 'dan' : 'ok'}">${days > 0 ? 'активен' : 'истёк'}</span>
      </button>
    </div>`}
    <div class="wrap sec">
      <button class="btn gh" data-a="o.share">${icon('share', 18)}Поделиться страницей записи</button>
    </div>`;
  },
});

/* Приглашения показываем только пока они живы: погашенная ссылка —
   это история, а не задача, и место на экране она занимать не должна. */
function inviteList() {
  const live = invites().filter(i => inviteState(i) === 'активна');
  if (!live.length) return '';
  return `<div class="sec">
    <div class="sec-h"><div class="sec-t">Приглашения</div>
      <span class="tiny dim">${live.length} ${plural(live.length, ['ссылка', 'ссылки', 'ссылок'])}</span></div>
    <div class="wrap stack s">
      ${live.map(i => {
    const left = Math.max(0, Math.ceil((new Date(i.expiresAt) - now()) / 86400000));
    return `<div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('link', 18)}</div>
        <div class="grow" style="min-width:0">
          <div class="tl nowrap">${esc(i.role)}</div>
          <div class="st">${esc((ACCESS[i.access] || ACCESS.staff).t)} · осталось ${left} ${plural(left, ['день', 'дня', 'дней'])}</div>
        </div>
        <button class="ico-btn" data-a="tm.invShow" data-id="${i.id}">${icon('share', 18)}</button>
        <button class="ico-btn" data-a="tm.invKill" data-id="${i.id}" style="color:var(--dan)">${icon('trash', 18)}</button>
      </div>`;
  }).join('')}
    </div>
  </div>`;
}

/* Ссылка с уже выбранной ролью. Роль выбирает владелец здесь, а не человек
   при входе: иначе любой перешедший назначал бы себе права сам. */
const invDraft = { access: 'staff', role: 'Мастер', days: 7 };

on('tm.invite', () => {
  const s = sheet({ title: 'Пригласить в команду', body: '' });
  const draw = () => {
    const el = s.el.querySelector('#_ir');
    if (el) invDraft.role = el.value;
    s.set({
      title: 'Пригласить в команду',
      body: `<div class="field"><label>Роль в команде</label>
          <input class="inp" id="_ir" value="${esc(invDraft.role)}" placeholder="Мастер маникюра"></div>
        <div class="field"><label>Уровень доступа</label>
          <div class="stack s">
            ${['staff', 'manager'].map(k => `<button class="lrow press" style="border-radius:14px;border:1.5px solid ${invDraft.access === k ? 'var(--p)' : 'var(--bd)'};width:100%;${invDraft.access === k ? 'background:var(--p-soft)' : ''}" data-a="tm.invAccess" data-v="${k}">
              <div class="grow" style="text-align:left"><div class="tl">${ACCESS[k].t}</div>
                <div class="st">${ACCESS[k].s}</div></div>
              ${invDraft.access === k ? `<span style="color:var(--p)">${icon('checkCircle', 19)}</span>` : ''}
            </button>`).join('')}
          </div></div>
        <div class="field"><label>Ссылка живёт</label>
          <div class="pick">${[1, 3, 7, 30].map(d => `<button class="o ${invDraft.days === d ? 'on' : ''}" data-a="tm.invDays" data-v="${d}">${d} ${plural(d, ['день', 'дня', 'дней'])}</button>`).join('')}</div></div>
        <div class="tiny dim" style="padding:0 4px">Ссылка одноразовая: как только по ней войдут, она перестанет работать.</div>`,
      footer: `<button class="btn p" data-a="tm.invMake">${icon('link', 18)}Создать ссылку</button>`,
    });
  };
  window.__inv = { s, draw };
  draw();
});
on('tm.invAccess', ds => {
  const el = window.__inv.s.el.querySelector('#_ir');
  const was = ACCESS[invDraft.access].t;
  if (el) invDraft.role = el.value;
  invDraft.access = ds.v;
  // роль по умолчанию идёт за уровнем доступа, но правку руками не затираем
  if (!invDraft.role || invDraft.role === was) invDraft.role = ACCESS[ds.v].t;
  window.__inv.draw();
});
on('tm.invDays', ds => { invDraft.days = +ds.v; window.__inv.draw(); });
on('tm.invMake', () => {
  const el = window.__inv.s.el.querySelector('#_ir');
  if (el) invDraft.role = el.value.trim() || ACCESS[invDraft.access].t;
  const inv = createInvite({ access: invDraft.access, role: invDraft.role, days: invDraft.days });
  pushInvite(inv);
  window.__inv.s.close();
  setTimeout(() => showInvite(inv.id), 260);
});
on('tm.invShow', ds => showInvite(ds.id));
on('tm.invKill', async ds => {
  const ok = await confirmSheet({
    title: 'Отозвать приглашение?',
    text: 'Ссылка перестанет работать. Тем, кому вы её уже отправили, придётся прислать новую.',
    ok: 'Отозвать', danger: true,
  });
  if (!ok) return;
  revokeInvite(ds.id);
  patchInvite(ds.id, { revokedAt: new Date().toISOString() });
  toast('Приглашение отозвано', 'dan');
});

const inviteLink = id => 'https://t.me/' + BOT_USERNAME + '?start=' + id;

async function showInvite(id) {
  const inv = invites().find(i => i.id === id);
  if (!inv) return;
  const link = inviteLink(id);
  await copy(link);
  sheet({
    title: 'Ссылка готова',
    body: `<div class="center" style="padding:2px 0 14px">
        <div class="tint" style="width:52px;height:52px;margin:0 auto 10px;background:var(--p-soft);color:var(--p)">${icon('link', 26)}</div>
        <div class="b" style="font-size:16px">${esc(inv.role)}</div>
        <div class="sm muted">${esc((ACCESS[inv.access] || ACCESS.staff).t)}</div>
      </div>
      <div class="card flat" style="padding:13px;text-align:center">
        <div class="tiny muted">Ссылка скопирована</div>
        <div class="b sm" style="margin-top:4px;word-break:break-all">${esc(link)}</div>
      </div>
      <div class="tiny dim center" style="margin-top:12px">Отправьте её человеку в Telegram. Он откроет, подтвердит имя — и появится в команде с этой ролью.</div>`,
    footer: `<button class="btn p" data-a="tm.invSend" data-link="${esc(link)}">${icon('send', 18)}Отправить в Telegram</button>`,
  });
}
on('tm.invSend', ds => {
  openLink('https://t.me/share/url?url=' + encodeURIComponent(ds.link) +
    '&text=' + encodeURIComponent('Приглашаю вас в команду — откройте ссылку, чтобы присоединиться'));
});

/* =========================================================
   Услуги
   ========================================================= */

route('o.services', {
  perm: 'services',
  tab: 'o.more',
  fab: () => `<button class="fab" data-a="qa.svc">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = svcs();
    const byCat = {};
    list.forEach(s => (byCat[s.cat] = byCat[s.cat] || []).push(s));
    const s30 = rangeStats(30);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Услуги</div><div class="top-sub">${list.length} активных</div></div>
      <button class="ico-btn" data-a="sv.cats">${icon('grid', 18)}</button></div>
    ${!list.length ? emptyState({ ic: 'briefcase', title: 'Нет услуг', text: 'Добавьте первую услугу — она сразу появится на странице записи.', action: 'Добавить услугу', act: 'qa.svc' })
        : Object.keys(byCat).map(cat => `
      <div class="sec">
        <div class="sec-h"><div class="sec-t" style="font-size:13px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em">${esc(catName(cat))}</div></div>
        <div class="wrap stack s">
          ${byCat[cat].map(s => {
          const stat = s30.byService.find(x => x.name === s.name);
          return `<button class="svc press" style="width:100%" data-a="sv.open" data-id="${s.id}">
              ${s.photo ? `<div class="svc-ph" style="background-image:url('${s.photo}')"></div>`
              : `<div class="tint" style="background:${s.color}1f;color:${s.color}">${catIcon(s.cat, 18)}</div>`}
              <div class="grow" style="text-align:left">
                <div class="b" style="font-size:14.5px">${esc(s.name)}</div>
                <div class="tiny muted">${nMin(s.duration)} · ${s.employeeIds.length} ${plural(s.employeeIds.length, ['мастер', 'мастера', 'мастеров'])}${stat ? ' · ' + stat.count + ' за месяц' : ''}</div>
              </div>
              <div class="pr">${money(s.price)}</div>
            </button>`;
        }).join('')}
        </div>
      </div>`).join('')}`;
  },
});

on('sv.cats', () => {
  const s = sheet({ title: 'Категории услуг', body: '' });
  const draw = () => {
    const list = cats();
    s.set({
      title: 'Категории услуг',
      body: `<div class="stack s">${Object.entries(list).map(([k, v]) => {
        const n = svcs().filter(x => x.cat === k).length;
        const own = (co().cats || {})[k];
        return `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
          <div class="tint" style="background:${v.color}1f;color:${v.color}">${catIcon(k, 18)}</div>
          <div class="grow"><div class="tl">${esc(v.t)}</div>
            <div class="st">${n} ${plural(n, ['услуга', 'услуги', 'услуг'])}</div></div>
          ${own ? `<button class="ico-btn flat" data-a="cat.ren" data-k="${k}">${icon('pencil', 16)}</button>
                   <button class="ico-btn flat" data-a="cat.del" data-k="${k}">${icon('trash', 16)}</button>` : '<span class="bdg">базовая</span>'}
        </div>`;
      }).join('')}</div>
      <div class="tiny dim" style="margin-top:10px">Базовые категории удалить нельзя. Свои — можно переименовать и удалить, услуги при этом сохранятся.</div>`,
      footer: `<button class="btn p" data-a="cat.add">${icon('plus', 17)}Новая категория</button>`,
    });
  };
  window.__cat = { s, draw };
  draw();
});
on('cat.add', async () => {
  const v = await promptSheet({ title: 'Новая категория', label: 'Название', placeholder: 'Например, Массаж' });
  if (!v) return;
  addCat(v); window.__cat.draw(); toast('Категория добавлена');
});
on('cat.ren', async ds => {
  const v = await promptSheet({ title: 'Переименовать', label: 'Название', value: catName(ds.k) });
  if (!v) return;
  renameCat(ds.k, v); window.__cat.draw(); toast('Переименовано');
});
on('cat.del', async ds => {
  const n = svcs().filter(x => x.cat === ds.k).length;
  const ok = await confirmSheet({
    title: 'Удалить категорию?',
    text: n ? `${n} ${plural(n, ['услуга перейдёт', 'услуги перейдут', 'услуг перейдут'])} в «Другое». Сами услуги останутся.` : 'Категория пустая.',
    ok: 'Удалить', danger: true,
  });
  if (!ok) return;
  removeCat(ds.k); window.__cat.draw(); toast('Категория удалена', 'dan');
});

on('sv.open', ds => {
  const s0 = svc(ds.id);
  const st = { emps: s0.employeeIds.slice(), buf: s0.buffer || 0 };
  const d = { name: s0.name, price: String(s0.price), dur: String(s0.duration), desc: s0.desc || '' };
  const sh = sheet({ title: s0.name, body: '' });
  const capture = () => {
    const g = id => { const el = sh.el.querySelector(id); return el ? el.value : null; };
    const n = g('#_n'), p = g('#_p'), du = g('#_d'), de = g('#_desc');
    if (n != null) d.name = n; if (p != null) d.price = p;
    if (du != null) d.dur = du; if (de != null) d.desc = de;
  };
  const draw = () => {
    const s = svc(ds.id);
    sh.set({
      title: s.name,
      body: `
      ${photoField({
        src: s.photo, label: 'Фотография', actPick: 'sv.photo', actDel: 'sv.photoDel',
        hint: 'Клиент видит её при выборе услуги.',
      })}
      <div class="inp-row">
        <div class="field"><label>Цена, ₸</label><input class="inp" id="_p" inputmode="numeric" value="${esc(d.price)}"></div>
        <div class="field"><label>Время, мин</label><input class="inp" id="_d" inputmode="numeric" value="${esc(d.dur)}"></div>
      </div>
      <div class="field"><label>Название</label><input class="inp" id="_n" value="${esc(d.name)}"></div>
      <div class="field"><label>Кто выполняет</label>
        <div class="pick">${staff().map(e => `<button class="o ${st.emps.includes(e.id) ? 'on' : ''}" data-a="sv.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}</div></div>
      <div class="hr"></div>
      <div class="tiny muted b" style="margin-bottom:8px">ДОПОЛНИТЕЛЬНО</div>
      <div class="field"><label>Описание</label><textarea class="inp" id="_desc" placeholder="Коротко о услуге для клиентов">${esc(d.desc)}</textarea></div>
      <div class="field"><label>Буфер после услуги</label>
        <div class="pick">${[0, 5, 10, 15, 30].map(b => `<button class="o ${st.buf === b ? 'on' : ''}" data-a="sv.buf" data-b="${b}">${b ? b + ' мин' : 'нет'}</button>`).join('')}</div></div>`,
      footer: `<div class="btns"><button class="btn dan" data-a="sv.del" data-id="${s.id}">Удалить</button><button class="btn p" data-a="sv.save" data-id="${s.id}">Сохранить</button></div>`,
    });
  };
  window.__sv = { sh, st, d, draw, capture, id: ds.id };
  draw();
});
on('sv.emp', (d2, el) => {
  const { st } = window.__sv;
  const i = st.emps.indexOf(d2.id);
  if (i >= 0) st.emps.splice(i, 1); else st.emps.push(d2.id);
  el.classList.toggle('on', st.emps.includes(d2.id));
});
on('sv.buf', (d2, el) => {
  const { sh, st } = window.__sv;
  st.buf = +d2.b;
  sh.el.querySelectorAll('[data-a="sv.buf"]').forEach(o => o.classList.toggle('on', +o.dataset.b === +d2.b));
});
on('sv.photo', async () => {
  const sv2 = window.__sv; sv2.capture();
  const v = await pickImage(IMG_MAX.photo);
  if (!v) return;
  updateService(sv2.id, { photo: v }); sv2.draw(); toast('Фотография загружена');
});
on('sv.photoDel', () => {
  const sv2 = window.__sv; sv2.capture();
  updateService(sv2.id, { photo: null }); sv2.draw(); toast('Фотография удалена', 'dan');
});
on('sv.save', ds => {
  const sv2 = window.__sv; sv2.capture();
  const { st, d } = sv2;
  if (!d.name.trim()) { toast('Введите название', 'dan'); return; }
  updateService(ds.id, {
    name: d.name.trim(),
    price: +d.price || 0,
    duration: +d.dur || 30,
    desc: d.desc.trim(),
    buffer: st.buf, employeeIds: st.emps,
  });
  sv2.sh.close(); toast('Услуга сохранена');
});
on('sv.del', async ds => {
  const ok = await confirmSheet({ title: 'Удалить услугу?', text: 'Она исчезнет из страницы записи. Прошлые записи сохранятся.', ok: 'Удалить', danger: true });
  if (!ok) return;
  deleteService(ds.id); window.__sv.sh.close(); toast('Услуга удалена', 'dan');
});

/* =========================================================
   Команда
   ========================================================= */
route('o.team', {
  perm: 'team',
  tab: 'o.team',
  mount() {
    tipOnce('team', {
      title: 'Роль решает, что видно',
      text: 'Откройте сотрудника → «Роль»: там списком показано, к чему у него есть доступ. Мастер видит только свой день.',
      ic: 'users',
    });
  },
  fab: () => `<button class="fab" data-a="tm.add">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = emps();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Команда</div><div class="top-sub">${list.length} ${plural(list.length, ['человек', 'человека', 'человек'])}</div></div></div>
    <div class="wrap sec">
      <button class="btn gh" data-a="tm.invite">${icon('link', 17)}Пригласить по ссылке</button>
    </div>
    ${inviteList()}
    <div class="wrap stack s">
      ${list.map(e => {
      const t = todayStats(cid(), e.id);
      const w = workDay(e, now());
      return `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="o.employee" data-id="${e.id}">
          ${avatar(e, 'm')}
          <div class="grow" style="text-align:left">
            <div class="tl">${esc(e.name)}${e.isOwner ? ' <span class="bdg p" style="margin-left:4px">вы</span>' : ''}</div>
            <div class="st">${esc(e.role)}</div>
            <div class="row tiny" style="gap:8px;margin-top:3px;color:var(--tx-3)">
              <span class="row" style="gap:4px"><i class="dot ${w ? '' : 'off'}"></i>${w ? 'работает ' + w.from + '–' + w.to : 'выходной'}</span>
              ${e.takesAppointments ? `<span>· сегодня ${t.count}</span>` : ''}
            </div>
          </div>
          <span class="chev">${icon('fwd', 18, 2)}</span>
        </button>`;
    }).join('')}
    </div>
    ${emps().length <= 1 ? `<div class="wrap sec">${emptyState({ ic: 'users', title: 'Вы пока работаете один', text: 'Добавьте сотрудников, когда команда расширится.', action: 'Добавить сотрудника', act: 'tm.add' })}</div>` : ''}`;
  },
});

on('tm.add', () => {
  const st = { svcs: svcs().map(s => s.id) };
  const s = sheet({
    title: 'Новый сотрудник',
    body: `<div class="field"><label>Имя</label><input class="inp" id="_n" placeholder="Например, Асель Нурланова"></div>
      <div class="field"><label>Должность</label>
        <div class="pick">${['Мастер маникюра', 'Парикмахер', 'Барбер', 'Бровист', 'Массажист', 'Администратор'].map((r, i) => `<button class="o ${i === 0 ? 'on' : ''}" data-a="tm.role" data-r="${esc(r)}">${r}</button>`).join('')}</div></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" placeholder="+7 ___ ___ __ __" inputmode="tel"></div>
      <div class="field"><label>Роль</label>
        <div class="pick">${Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, r], i) => `<button class="o ${i === 0 ? 'on' : ''}" data-a="tm.access" data-v="${k}">${r.t}</button>`).join('')}</div></div>
      <div class="tiny dim">После добавления сразу предложим настроить график и услуги.</div>`,
    footer: `<button class="btn p" data-a="tm.ok">Добавить сотрудника</button>`,
  });
  window.__tm = { s, role: 'Мастер маникюра', access: 'staff', st };
  on('tm.role', (ds, el) => { window.__tm.role = ds.r; s.el.querySelectorAll('[data-a="tm.role"]').forEach(o => o.classList.toggle('on', o === el)); });
  on('tm.access', (ds, el) => { window.__tm.access = ds.v; s.el.querySelectorAll('[data-a="tm.access"]').forEach(o => o.classList.toggle('on', o === el)); });
  on('tm.ok', () => {
    const n = s.el.querySelector('#_n').value.trim();
    if (!n) { toast('Введите имя', 'dan'); return; }
    const e = createEmployee({ name: n, role: window.__tm.role, phone: s.el.querySelector('#_p').value.trim() });
    setRole(e.id, window.__tm.access || 'staff');
    s.close(); toast('Добавлен: ' + ROLES[window.__tm.access || 'staff'].t); go('o.employee', { id: e.id });
  });
  setTimeout(() => s.el.querySelector('#_n').focus(), 250);
});

route('o.employee', {
  perm: 'team',
  tab: 'o.team',
  render(p) {
    const e = emp(p.id);
    if (!e) return emptyState({ ic: 'users', title: 'Сотрудник не найден' });
    const t = todayStats(cid(), e.id);
    const s30 = rangeStats(30);
    const mine = s30.byEmployee.find(x => x.name === e.name) || { count: 0, sum: 0 };
    const w = workDay(e, now());
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button><div class="grow"></div>
      <button class="ico-btn" data-a="emp.edit" data-id="${e.id}">${icon('pencil', 18)}</button></div>
    <div class="center wrap">
      ${avatar(e, 'xl')}
      <div style="font-size:22px;font-weight:780;letter-spacing:-.03em;margin-top:12px">${esc(e.name)}</div>
      <div class="sm muted">${esc(e.role)}</div>
      <div class="row" style="justify-content:center;gap:6px;margin-top:8px;flex-wrap:wrap">
        <span class="bdg ${w ? 'ok' : ''}">${w ? 'сегодня ' + w.from + '–' + w.to : 'выходной'}</span>
        ${e.rating ? `<span class="bdg warn">${icon('star', 11, 2.4)} ${e.rating}</span>` : ''}
        ${expBadge(e)}
      </div>
    </div>
    <div class="wrap sec"><div class="grid3">
      <div class="st-card center"><div class="v">${t.count}</div><div class="l">сегодня</div></div>
      <div class="st-card center"><div class="v">${moneyShort(t.potential)}</div><div class="l">₸ сегодня</div></div>
      <div class="st-card center"><div class="v">${mine.count}</div><div class="l">за месяц</div></div>
    </div></div>

    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="o.schedule" data-id="${e.id}">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('calendar', 19)}</div>
        <div class="grow" style="text-align:left"><div class="tl">График</div><div class="st">Рабочие дни и перерывы</div></div>${icon('fwd', 18)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="emp.svcs" data-id="${e.id}">
        <div class="ic" style="background:var(--ai-soft);color:var(--ai)">${icon('briefcase', 19)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Услуги</div><div class="st">${e.serviceIds.length} из ${svcs().length}</div></div>${icon('fwd', 18)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px dashed var(--bd-2);width:100%" data-a="emp.newSvc" data-id="${e.id}">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('plus', 19)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Новая услуга</div><div class="st">Сразу закрепим за этим мастером</div></div>${icon('fwd', 18)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="emp.cal" data-id="${e.id}">
        <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('clock', 19)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Записи</div><div class="st">Календарь мастера</div></div>${icon('fwd', 18)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="emp.access" data-id="${e.id}">
        <div class="ic" style="background:var(--sf-3)">${icon('shield', 19)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Роль: ${roleName(e)}</div>
          <div class="st">${ROLES[roleOf(e)].perms.length} ${plural(ROLES[roleOf(e)].perms.length, ['право', 'права', 'прав'])} доступа</div></div>${icon('fwd', 18)}</button>
    </div></div>

    <div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">Сегодня</div>
      <div class="stack s">${t.list.length ? t.list.map(a => {
      const c = client(a.clientId);
      return `<button class="appt press" style="--c:${apptColor(a)};width:100%;text-align:left" data-a="ap.card" data-id="${a.id}">
          <div class="t">${hhmm(new Date(a.start))}<small>${a.duration}м</small></div>
          <div class="grow"><div class="n">${esc(c.name)}</div><div class="s">${esc(apptTitle(a))}</div></div>
          <div class="b sm">${moneyShort(a.price)}</div></button>`;
    }).join('') : `<div class="card pad center sm muted">Записей на сегодня нет</div>`}</div>
    </div>

    ${!e.isOwner ? `<div class="wrap sec"><button class="btn dan" data-a="emp.fire" data-id="${e.id}">${icon('logout', 18)}Удалить из команды</button></div>` : ''}`;
  },
});

/** Стаж мастера — показываем, только если год указан (§68). */
export function expBadge(e, forClient = false) {
  if (!e || !e.since) return '';
  if (forClient && e.showExp === false) return '';
  const y = Math.max(0, now().getFullYear() - e.since);
  if (!y) return `<span class="bdg">первый год</span>`;
  return `<span class="bdg">${icon('history', 11, 2.4)} опыт ${y} ${plural(y, ['год', 'года', 'лет'])}</span>`;
}

on('emp.cal', ds => { go('o.cal'); setTimeout(() => { const b = document.querySelector(`[data-a="cal.emp"][data-id="${ds.id}"]`); if (b) b.click(); }, 60); });

/* §72 — услуга, созданная из карточки мастера, сразу закрепляется за ним */
on('emp.newSvc', ds => {
  addServiceSheet({
    only: [ds.id],
    after: sv => { toast('Услуга добавлена мастеру'); rr(); },
  });
});
on('emp.edit', ds => {
  const e0 = emp(ds.id);
  // Черновик держим отдельно от модели: перерисовка формы (фото, тумблеры)
  // иначе стирает введённое, а мусорные поля утекают в localStorage.
  const d = { name: e0.name, role: e0.role, phone: e0.phone || '', since: e0.since || '' };
  const s = sheet({ title: 'Сотрудник', body: '' });
  const capture = () => {
    const g = id => { const el = s.el.querySelector(id); return el ? el.value : null; };
    const n = g('#_n'), r = g('#_r'), p = g('#_p'), y = g('#_y');
    if (n != null) d.name = n; if (r != null) d.role = r;
    if (p != null) d.phone = p; if (y != null) d.since = y;
  };
  const draw = () => {
    const e = emp(ds.id);
    const yr = /^\d{4}$/.test(String(d.since)) ? +d.since : null;
    const years = yr ? Math.max(0, now().getFullYear() - yr) : 0;
    s.set({
      title: 'Сотрудник',
      body: `
      ${photoField({
        src: e.photo, label: 'Фотография', actPick: 'emp.photo', actDel: 'emp.photoDel', round: true,
        ic: 'user', hint: 'Заменит инициалы в календаре, команде и на странице записи.',
      })}
      <div class="field"><label>Имя</label><input class="inp" id="_n" value="${esc(d.name)}"></div>
      <div class="field"><label>Должность</label><input class="inp" id="_r" value="${esc(d.role)}"></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" value="${esc(d.phone)}"></div>
      <div class="field"><label>В профессии с какого года</label>
        <input class="inp" id="_y" inputmode="numeric" placeholder="например, ${now().getFullYear() - 5}" value="${esc(d.since)}">
        ${yr ? `<div class="tiny dim" style="margin-top:6px">Опыт — ${years} ${plural(years, ['год', 'года', 'лет'])}</div>` : ''}
      </div>
      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd);margin-bottom:10px">
        <div class="grow"><div class="tl">Показывать стаж клиентам</div><div class="st">На странице записи рядом с именем</div></div>
        <button class="sw ${e.showExp !== false ? 'on' : ''}" data-a="emp.showExp" data-id="${e.id}"></button></div>
      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
        <div class="grow"><div class="tl">Принимает записи</div><div class="st">Появляется при онлайн-записи</div></div>
        <button class="sw ${e.takesAppointments ? 'on' : ''}" data-a="emp.takes" data-id="${e.id}"></button></div>`,
      footer: `<button class="btn p" data-a="emp.save" data-id="${e.id}">Сохранить</button>`,
    });
  };
  window.__em = { s, draw, capture, id: ds.id, d };
  draw();
});
on('emp.photo', async () => {
  const em = window.__em; em.capture();
  const v = await pickImage(IMG_MAX.avatar);
  if (!v) return;
  updateEmployee(em.id, { photo: v }); em.draw(); toast('Фотография загружена');
});
on('emp.photoDel', () => {
  const em = window.__em; em.capture();
  updateEmployee(em.id, { photo: null }); em.draw(); toast('Фотография удалена', 'dan');
});
on('emp.showExp', (ds, el) => {
  const e = emp(ds.id);
  if (window.__em) window.__em.capture();
  updateEmployee(ds.id, { showExp: e.showExp === false });
  el.classList.toggle('on', emp(ds.id).showExp !== false);
});
on('emp.takes', (ds, el) => {
  const e = emp(ds.id);
  if (window.__em) window.__em.capture();
  updateEmployee(ds.id, { takesAppointments: !e.takesAppointments });
  el.classList.toggle('on', emp(ds.id).takesAppointments);
});
on('emp.save', ds => {
  const em = window.__em; em.capture();
  const y = String(em.d.since || '').trim();
  const year = /^\d{4}$/.test(y) ? +y : null;
  if (y && !year) { toast('Год укажите четырьмя цифрами', 'dan'); return; }
  if (year && (year < 1950 || year > now().getFullYear())) { toast('Проверьте год', 'dan'); return; }
  updateEmployee(ds.id, {
    name: em.d.name.trim() || emp(ds.id).name,
    role: em.d.role.trim(),
    phone: em.d.phone.trim(),
    since: year,
  });
  em.s.close(); toast('Сохранено');
});
on('emp.fire', async ds => {
  const ok = await confirmSheet({ title: 'Удалить сотрудника?', text: 'Его будущие записи останутся, но он исчезнет из команды.', ok: 'Удалить', danger: true });
  if (!ok) return;
  removeEmployee(ds.id); toast('Сотрудник удалён', 'dan'); go('o.team', {}, { replace: true });
});
on('emp.svcs', ds => {
  const e = emp(ds.id);
  const st = { ids: e.serviceIds.slice() };
  const s = sheet({
    title: 'Услуги мастера',
    body: `<div class="stack s">${svcs().map(x => `
      <button class="svc press" style="width:100%" data-a="es.t" data-id="${x.id}">
        <div class="tint" style="background:${x.color}1f;color:${x.color}">${catIcon(x.cat, 18)}</div>
        <div class="grow" style="text-align:left"><div class="b sm">${esc(x.name)}</div><div class="tiny muted">${nMin(x.duration)} · ${money(x.price)}</div></div>
        <span data-chk="${x.id}" style="color:${st.ids.includes(x.id) ? 'var(--p)' : 'var(--tx-3)'}">${icon(st.ids.includes(x.id) ? 'checkCircle' : 'plus', 20)}</span>
      </button>`).join('')}</div>`,
    footer: `<button class="btn p" data-a="es.ok" data-id="${e.id}">Сохранить</button>`,
  });
  window.__es = { s, st };
  on('es.t', d2 => {
    const i = st.ids.indexOf(d2.id);
    if (i >= 0) st.ids.splice(i, 1); else st.ids.push(d2.id);
    const chk = s.el.querySelector(`[data-chk="${d2.id}"]`);
    const onx = st.ids.includes(d2.id);
    chk.style.color = onx ? 'var(--p)' : 'var(--tx-3)';
    chk.innerHTML = icon(onx ? 'checkCircle' : 'plus', 20);
  });
  on('es.ok', d2 => { updateEmployee(d2.id, { serviceIds: window.__es.st.ids }); window.__es.s.close(); toast('Услуги обновлены'); });
});
on('emp.access', ds => {
  const e = emp(ds.id);
  const s = sheet({ title: 'Роль и права', body: '' });
  const draw = () => {
    const cur = roleOf(emp(ds.id));
    s.set({
      title: 'Роль и права',
      body: `
        <div class="tiny muted b" style="margin-bottom:8px">РОЛЬ</div>
        <div class="stack s" style="margin-bottom:18px">
          ${Object.entries(ROLES).map(([k, r]) => `
            <button class="role ${cur === k ? 'on' : ''}" data-a="ac.set" data-id="${ds.id}" data-v="${k}" style="width:100%;display:flex;align-items:center;gap:10px">
              <div class="grow"><div class="t">${r.t}</div><div class="s">${r.s}</div></div>
              ${cur === k ? `<span style="color:var(--p)">${icon('checkCircle', 19)}</span>` : ''}
            </button>`).join('')}
        </div>

        <div class="tiny muted b" style="margin-bottom:8px">ЧТО РАЗРЕШЕНО</div>
        <div class="card" style="padding:4px 0">
          ${Object.entries(PERMS).map(([k, t]) => {
            const has = ROLES[cur].perms.includes(k);
            return `<div class="lrow" style="padding:10px 14px;background:transparent">
              <span style="color:${has ? 'var(--ok)' : 'var(--tx-3)'};flex:none">${icon(has ? 'checkCircle' : 'xCircle', 17)}</span>
              <div class="grow"><div class="tl" style="font-size:13.5px;font-weight:${has ? 600 : 400};color:${has ? 'var(--tx)' : 'var(--tx-3)'}">${t}</div></div>
            </div>`;
          }).join('')}
        </div>
        <div class="tiny dim" style="margin-top:10px">Права меняются вместе с ролью. Мастер видит только свой день и своих клиентов.</div>`,
    });
  };
  window.__ac = { s, draw };
  draw();
});
on('ac.set', ds => { setRole(ds.id, ds.v); window.__ac.draw(); toast('Роль: ' + ROLES[ds.v].t); });

/* =========================================================
   График
   ========================================================= */
route('o.schedule', {
  tab: 'o.team',
  render(p) {
    const e = emp(p.id) || staff()[0];
    const days = [1, 2, 3, 4, 5, 6, 0];
    const bl = blocks().filter(b => b.employeeId === e.id && new Date(b.end) > now()).sort((a, b) => new Date(a.start) - new Date(b.start));
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">График</div><div class="top-sub">${esc(e.name)}</div></div></div>
    <div class="wrap stack s">
      ${days.map(d => {
      const w = e.schedule[d];
      return `<div class="card" style="padding:12px 14px">
          <div class="row between">
            <div class="grow">
              <div class="b" style="text-transform:capitalize">${WD_FULL[d]}</div>
              <div class="sm muted">${w.on ? w.from + ' — ' + w.to : 'Выходной'}</div>
            </div>
            <button class="sw ${w.on ? 'on' : ''}" data-a="sch.day" data-id="${e.id}" data-d="${d}"></button>
          </div>
          ${w.on ? `<div class="row" style="gap:8px;margin-top:10px">
            <button class="btn xs gh" data-a="sch.time" data-id="${e.id}" data-d="${d}" data-k="from">${icon('clock', 14)}${w.from}</button>
            <span class="dim">—</span>
            <button class="btn xs gh" data-a="sch.time" data-id="${e.id}" data-d="${d}" data-k="to">${w.to}</button>
            <div class="grow"></div>
            <button class="btn xs" data-a="sch.break" data-id="${e.id}" data-d="${d}">${icon('coffee', 14)}${(w.breaks || []).length ? w.breaks.map(b => b.from + '–' + b.to).join(', ') : 'Перерыв'}</button>
          </div>` : ''}
        </div>`;
    }).join('')}
    </div>
    <div class="wrap sec"><div class="btns">
      <button class="btn gh" data-a="sch.copy" data-id="${e.id}">${icon('copy', 18)}Копировать график</button>
      <button class="btn gh" data-a="sch.block" data-id="${e.id}">${icon('lock', 18)}Занять время</button>
    </div></div>
    <div class="sec">
      <div class="sec-h"><div class="sec-t">Отсутствия и блокировки</div>
        <button class="sec-a" data-a="sch.away" data-id="${e.id}">${icon('plus', 14)} Отпуск / больничный</button></div>
      <div class="wrap stack s">
        ${bl.length ? bl.map(b => `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
          <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('lock', 18)}</div>
          <div class="grow"><div class="tl">${esc(b.reason)}</div>
            <div class="st">${dateLabel(new Date(b.start), now())}, ${hhmm(new Date(b.start))}–${hhmm(new Date(b.end))}</div></div>
          <button class="ico-btn flat" data-a="sch.unblock" data-id="${b.id}">${icon('trash', 17)}</button>
        </div>`).join('') : `<div class="card pad center sm muted">Блокировок нет</div>`}
      </div>
    </div>`;
  },
});

on('sch.day', ds => {
  const e = emp(ds.id); const w = e.schedule[ds.d];
  w.on = !w.on; updateEmployee(ds.id, {}); toast(w.on ? 'Рабочий день' : 'Выходной');
});
on('sch.time', ds => {
  const e = emp(ds.id); const w = e.schedule[ds.d];
  timePick(w[ds.k], v => { w[ds.k] = v; updateEmployee(ds.id, {}); toast('График обновлён'); });
});
on('sch.break', ds => {
  const e = emp(ds.id); const w = e.schedule[ds.d];
  const has = (w.breaks || []).length;
  const s = sheet({
    title: 'Перерыв',
    body: has ? `<div class="stack s">${w.breaks.map((b, i) => `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
        <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('coffee', 18)}</div>
        <div class="grow"><div class="tl">${b.from} — ${b.to}</div></div>
        <button class="ico-btn flat" data-a="br.del" data-id="${ds.id}" data-d="${ds.d}" data-i="${i}">${icon('trash', 17)}</button></div>`).join('')}</div>`
      : `<div class="sm muted" style="padding-bottom:8px">Перерывов нет. Добавьте обед или паузу — это время не будет доступно для записи.</div>`,
    footer: `<div class="pick">${[['12:00', '13:00'], ['13:00', '14:00'], ['14:00', '15:00'], ['15:00', '15:30']].map(b => `<button class="o" data-a="br.add" data-id="${ds.id}" data-d="${ds.d}" data-f="${b[0]}" data-t="${b[1]}">${b[0]}–${b[1]}</button>`).join('')}</div>`,
  });
  window.__br = s;
});
on('br.add', ds => {
  const e = emp(ds.id); const w = e.schedule[ds.d];
  w.breaks = w.breaks || []; w.breaks.push({ from: ds.f, to: ds.t });
  updateEmployee(ds.id, {}); window.__br.close(); toast('Перерыв добавлен');
});
on('br.del', ds => {
  const e = emp(ds.id); const w = e.schedule[ds.d];
  w.breaks.splice(+ds.i, 1); updateEmployee(ds.id, {}); window.__br.close(); toast('Перерыв удалён');
});
on('sch.copy', async ds => {
  const e = emp(ds.id);
  const src = e.schedule[1];
  const ok = await confirmSheet({ title: 'Применить график понедельника?', text: `${src.on ? src.from + '–' + src.to : 'Выходной'} будет установлен на все будние дни.`, ok: 'Применить' });
  if (!ok) return;
  [2, 3, 4, 5].forEach(d => { e.schedule[d] = JSON.parse(JSON.stringify(src)); });
  updateEmployee(ds.id, {}); toast('График обновлён');
});
on('sch.block', ds => blockFlow({ empId: ds.id }));
on('sch.away', ds => absenceFlow({ empId: ds.id }));
on('sch.unblock', ds => { removeBlock(ds.id); toast('Блокировка снята'); });

export function timePick(current, cb) {
  const times = [];
  for (let h = 6; h <= 23; h++) { times.push(String(h).padStart(2, '0') + ':00'); times.push(String(h).padStart(2, '0') + ':30'); }
  const s = sheet({
    title: 'Выберите время',
    body: `<div class="slots">${times.map(t => `<button class="slot ${t === current ? 'on' : ''}" data-a="tp.p" data-t="${t}">${t}</button>`).join('')}</div>`,
  });
  window.__tp = { s, cb };
}
on('tp.p', ds => { const { s, cb } = window.__tp; s.close(); cb(ds.t); });

/* =========================================================
   Период: общий компонент для финансов и аналитики
   (§60, §83, §84, §92) — пресеты плюс свой отрезок из календаря.
   ========================================================= */
const PRESETS = [
  { v: 7, t: '7 дней' }, { v: 30, t: '30 дней' }, { v: 90, t: '90 дней' },
  { v: 180, t: 'Полгода' }, { v: 365, t: 'Год' },
];
const GROUPS = [['day', 'По дням'], ['week', 'По неделям'], ['month', 'По месяцам']];

/** Отрезок дат по состоянию панели. */
function periodRange(st) {
  if (st.from && st.to) return { start: startOfDay(st.from), end: startOfDay(st.to) };
  const end = now();
  return { start: new Date(startOfDay(end).getTime() - (st.preset - 1) * 86400000), end };
}
function periodLabel(st) {
  if (st.from && st.to) {
    const n = daysBetween(st.from, st.to);
    return dateFull(st.from) + ' — ' + dateFull(st.to) + ' · ' + n + ' ' + plural(n, ['день', 'дня', 'дней']);
  }
  return 'за ' + (PRESETS.find(p => p.v === st.preset) || { t: st.preset + ' дней' }).t.toLowerCase();
}
function periodBar(st, act) {
  const custom = !!(st.from && st.to);
  return `<div class="chips" style="margin-bottom:10px">
    ${PRESETS.map(p => `<button class="chip ${!custom && st.preset === p.v ? 'on' : ''}" data-a="${act}.p" data-v="${p.v}">${p.t}</button>`).join('')}
    <button class="chip ${custom ? 'on' : ''}" data-a="${act}.custom">${icon('calendar', 13, 2.2)} ${custom ? dateFull(st.from) + '–' + dateFull(st.to) : 'Свой период'}</button>
  </div>`;
}
function groupBar(st, act, current) {
  return `<div class="chips" style="margin-bottom:12px">
    ${GROUPS.map(g => `<button class="chip sm ${(st.group || 'auto') === g[0] ? 'on' : ''}" data-a="${act}.g" data-v="${g[0]}">${g[1]}</button>`).join('')}
    ${st.group ? `<button class="chip sm" data-a="${act}.g" data-v="">Авто${current ? ' (' + (GROUPS.find(g => g[0] === current) || [, ''])[1].toLowerCase() + ')' : ''}</button>` : ''}
  </div>`;
}
/** Шторка выбора своего отрезка: две границы на месячной сетке. */
function periodPicker(st, after) {
  const w = { pick: 'from', from: st.from || periodRange(st).start, to: st.to || startOfDay(now()), month: startOfDay(now()) };
  const s = sheet({ title: 'Свой период', body: '' });
  const draw = () => {
    const n = daysBetween(w.from, w.to);
    s.set({
      title: w.pick === 'from' ? 'С какого дня?' : 'По какой день?',
      body: `
        <div class="inp-row" style="margin-bottom:14px">
          <button class="card flat press" style="flex:1;padding:12px 14px;text-align:left;${w.pick === 'from' ? 'border-color:var(--p)' : ''}" data-a="pp.from">
            <div class="tiny dim">С</div><div class="b">${dateFull(w.from)}</div></button>
          <button class="card flat press" style="flex:1;padding:12px 14px;text-align:left;${w.pick === 'to' ? 'border-color:var(--p)' : ''}" data-a="pp.to">
            <div class="tiny dim">По</div><div class="b">${dateFull(w.to)}</div></button>
        </div>
        ${monthGrid(w.month, {
        selected: w.pick === 'from' ? w.from : w.to,
        action: 'pp.pick', navAction: 'pp.month',
        minDate: w.pick === 'to' ? w.from : null,
        maxDate: startOfDay(now()),
        showCounts: false,
      })}
        <div class="tiny dim center" style="margin-top:10px">Выбрано ${n} ${plural(n, ['день', 'дня', 'дней'])}</div>`,
      footer: `<button class="btn p" data-a="pp.ok">Показать период</button>`,
    });
  };
  on('pp.from', () => { w.pick = 'from'; w.month = startOfDay(w.from); draw(); });
  on('pp.to', () => { w.pick = 'to'; w.month = startOfDay(w.to); draw(); });
  on('pp.month', ds => { w.month = startOfDay(new Date(+ds.d)); draw(); });
  on('pp.pick', ds => {
    const v = startOfDay(new Date(+ds.d));
    if (w.pick === 'from') { w.from = v; if (w.to < v) w.to = v; w.pick = 'to'; }
    else w.to = v;
    draw();
  });
  on('pp.ok', () => { st.from = w.from; st.to = w.to; s.close(); after(); });
  draw();
  return s;
}

/* =========================================================
   Финансы
   ========================================================= */
const fin = { preset: 30, from: null, to: null, group: null, tab: 'ops' };
route('o.finance', {
  perm: 'finance',
  tab: 'o.more',
  mount() {
    tipOnce('fin', {
      title: 'Аренда и зарплата — регулярные',
      text: 'Заведите их один раз в блоке «Регулярные платежи»: дальше они сами попадут в расчёт любого периода.',
      ic: 'wallet',
    });
  },
  render() {
    const { start, end } = periodRange(fin);
    const s = statsBetween(start, end, cid(), { group: fin.group || 'auto' });
    const ops = moneyOps(start, end, cid());
    const rec = recurring();
    const maxCat = Math.max(1, ...s.byExpenseCat.map(x => x.sum));

    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Финансы</div><div class="top-sub">${periodLabel(fin)}</div></div></div>
    <div class="wrap">${periodBar(fin, 'fin')}</div>

    <div class="wrap">
      <div class="hero" style="background:linear-gradient(135deg,#12B76A,#0E9F6E 60%,#059669)">
        <div class="lb">Чистая прибыль</div>
        <div class="tm" style="font-size:34px">${money(s.profit)}</div>
        <div class="hero-meta">
          <span>${icon('trendUp', 13, 2)} Доход ${moneyShort(s.income)} ₸</span>
          <span>${icon('trendDown', 13, 2)} Расход ${moneyShort(s.expenses)} ₸</span>
        </div>
      </div>
    </div>

    <div class="wrap sec"><div class="grid2">
      <div class="st-card"><div class="l">Выручка по факту</div><div class="v">${moneyShort(s.revenue)} ₸</div>
        <div class="tiny dim">${s.count} ${plural(s.count, ['визит', 'визита', 'визитов'])}</div></div>
      <div class="st-card"><div class="l">Ожидается</div><div class="v" style="color:var(--p)">${moneyShort(s.expected)} ₸</div>
        <div class="tiny dim">${s.upcoming} ${plural(s.upcoming, ['запись', 'записи', 'записей'])} впереди</div></div>
    </div></div>

    <div class="wrap sec"><div class="btns">
      <button class="btn ok" data-a="fin.add" data-t="income">${icon('plus', 18)}Доход</button>
      <button class="btn" data-a="fin.add" data-t="expense">${icon('minus', 18)}Расход</button>
    </div></div>

    <div class="wrap sec">
      <div class="card pad">
        <div class="row between" style="margin-bottom:10px"><div class="b sm">Динамика выручки</div>
          <div class="tiny dim">${s.labels.length} ${s.group === 'day' ? 'дней' : s.group === 'week' ? 'недель' : 'месяцев'}</div></div>
        ${groupBar(fin, 'fin', s.group)}
        ${bars(s.series, { labels: s.labels.length <= 14 ? s.labels : [], height: 104 })}
        ${s.expected ? `<div class="tiny dim" style="margin-top:8px">Показана фактическая выручка. Ожидаемая по будущим записям — ${money(s.expected)}.</div>` : ''}
      </div>
    </div>

    ${s.byExpenseCat.length ? `<div class="wrap sec">
      <div class="row between" style="margin-bottom:8px"><div class="sec-t">Расходы по категориям</div>
        <button class="sec-a" data-a="fin.cats">Настроить ${icon('fwd', 13, 2.4)}</button></div>
      <div class="card pad stack s">
        ${s.byExpenseCat.slice(0, 8).map(x => `<div>
          <div class="row between" style="margin-bottom:5px">
            <span class="sm b nowrap">${esc(x.name)}</span>
            <span class="tiny muted">${money(x.sum)}</span></div>
          ${progress(x.sum / maxCat * 100, x.color)}
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Регулярные платежи</div>
        <button class="sec-a" data-a="fin.recAdd">${icon('plus', 14)} Добавить</button></div>
      <div class="wrap stack s">
        ${rec.length ? rec.map(r => {
      const info = finCatInfo(r.type, r.cat);
      const ended = r.to && new Date(r.to) < now();
      return `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%;${r.active === false || ended ? 'opacity:.55' : ''}" data-a="fin.recOpen" data-id="${r.id}">
          <div class="ic" style="background:${info.color}1f;color:${info.color}">${icon('refresh', 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl">${esc(info.t)}${r.note ? ' · ' + esc(r.note) : ''}</div>
            <div class="st">${(REPEAT[r.every] || {}).t || r.every}${ended ? ' · закончился' : r.active === false ? ' · выключен' : ''}</div></div>
          <div class="b sm" style="color:${r.type === 'income' ? 'var(--ok)' : 'var(--dan)'}">${r.type === 'income' ? '+' : '−'}${moneyShort(r.amount)} ₸</div>
        </button>`;
    }).join('') : `<div class="card pad center sm muted">Аренда, зарплата, подписки — добавьте один раз, и они будут учитываться сами</div>`}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Операции</div><div class="tiny dim">${ops.length}</div></div>
      <div class="wrap stack s">
        ${ops.slice(0, 40).map(o => {
      const nm = o.catName || finCatName(o.type, o.cat);
      const info = o.fromAppt ? { color: '#12B76A' } : finCatInfo(o.type, o.cat);
      return `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
          <div class="ic" style="background:${o.type === 'income' ? 'var(--ok-soft);color:var(--ok)' : 'var(--dan-soft);color:var(--dan)'}">${icon(o.recurringId ? 'refresh' : o.type === 'income' ? 'trendUp' : 'trendDown', 18)}</div>
          <div class="grow"><div class="tl">${esc(nm)}</div>
            <div class="st">${dateLabel(new Date(o.date), now())}${o.note ? ' · ' + esc(o.note) : ''}${o.recurringId ? ' · регулярный' : ''}</div></div>
          <div class="b sm" style="color:${o.type === 'income' ? 'var(--ok)' : 'var(--dan)'}">${o.type === 'income' ? '+' : '−'}${moneyShort(o.amount)} ₸</div>
          ${!o.fromAppt && !o.recurringId ? `<button class="ico-btn flat" data-a="fin.del" data-id="${o.id}">${icon('trash', 16)}</button>` : ''}
        </div>`;
    }).join('') || `<div class="card pad center sm muted">Операций нет</div>`}
      </div>
    </div>`;
  },
});
on('fin.p', ds => { fin.preset = +ds.v; fin.from = fin.to = null; rr(); });
on('fin.custom', () => periodPicker(fin, rr));
on('fin.g', ds => { fin.group = ds.v || null; rr(); });
on('fin.del', async ds => {
  const ok = await confirmSheet({ title: 'Удалить операцию?', text: 'Она исчезнет из расчёта прибыли.', ok: 'Удалить', danger: true });
  if (!ok) return;
  removeMoney(ds.id); toast('Операция удалена', 'dan');
});

/* Разовый доход или расход — с выбором категории и даты */
on('fin.add', ds => {
  const type = ds.t;
  const st = { cat: Object.keys(finCats(type))[0], date: startOfDay(now()), amount: '', note: '', picking: false, month: startOfDay(now()) };
  const s = sheet({ title: '', body: '' });
  const capture = () => {
    const a = s.el.querySelector('#_a'), n = s.el.querySelector('#_n');
    if (a) st.amount = a.value; if (n) st.note = n.value;
  };
  const draw = () => {
    const list = finCats(type);
    s.set({
      title: st.picking ? 'Когда?' : (type === 'income' ? 'Новый доход' : 'Новый расход'),
      back: st.picking ? () => { st.picking = false; draw(); } : null,
      body: st.picking
        ? monthGrid(st.month, { selected: st.date, action: 'fa.pick', navAction: 'fa.month', showCounts: false })
        : `<div class="field"><label>Сумма, ₸</label><input class="inp" id="_a" inputmode="numeric" placeholder="0" value="${esc(st.amount)}"></div>
      <div class="field"><label>Категория</label>
        <div class="pick">
          ${Object.entries(list).map(([k, v]) => `<button class="o ${st.cat === k ? 'on' : ''}" data-a="fa.cat" data-c="${k}"
            style="${st.cat === k ? 'background:' + v.color + '1f;color:' + v.color + ';border-color:' + v.color : ''}">${esc(v.t)}</button>`).join('')}
          <button class="o" data-a="fa.newCat" style="border-style:dashed">${icon('plus', 13)} Своя</button>
        </div>
      </div>
      <div class="field"><label>Дата</label>
        <button class="card flat press" style="width:100%;padding:12px 14px;text-align:left" data-a="fa.date">
          <div class="b">${dateFull(st.date)}${dayKey(st.date) === dayKey(now()) ? ' · сегодня' : ''}</div></button></div>
      <div class="field"><label>Комментарий</label><input class="inp" id="_n" placeholder="Необязательно" value="${esc(st.note)}"></div>
      <button class="btn gh sm" style="width:100%" data-a="fa.toRec">${icon('refresh', 16)}Сделать регулярным</button>`,
      footer: st.picking ? '' : `<button class="btn ${type === 'income' ? 'ok' : 'p'}" data-a="fa.ok" data-t="${type}">Добавить</button>`,
    });
  };
  window.__fa = { s, st, draw, capture, type };
  draw();
  setTimeout(() => { const i = s.el.querySelector('#_a'); if (i) i.focus(); }, 250);
});
on('fa.cat', ds => { const f = window.__fa; f.capture(); f.st.cat = ds.c; f.draw(); });
on('fa.newCat', async () => {
  const f = window.__fa; f.capture();
  const v = await promptSheet({ title: 'Новая категория', label: 'Название', placeholder: 'Например, Обучение' });
  if (!v) { f.draw(); return; }
  const key = addFinCat(f.type, v);
  if (key) f.st.cat = key;
  f.draw(); toast('Категория добавлена');
});
on('fa.date', () => { const f = window.__fa; f.capture(); f.st.picking = true; f.st.month = startOfDay(f.st.date); f.draw(); });
on('fa.month', ds => { const f = window.__fa; f.st.month = startOfDay(new Date(+ds.d)); f.draw(); });
on('fa.pick', ds => { const f = window.__fa; f.st.date = startOfDay(new Date(+ds.d)); f.st.picking = false; f.draw(); });
on('fa.toRec', () => {
  const f = window.__fa; f.capture();
  f.s.close();
  setTimeout(() => recurringSheet({ type: f.type, cat: f.st.cat, amount: f.st.amount, note: f.st.note }), 260);
});
on('fa.ok', ds => {
  const f = window.__fa; f.capture();
  const a = +f.st.amount;
  if (!a) { toast('Введите сумму', 'dan'); return; }
  addMoney({ type: ds.t, amount: a, cat: f.st.cat, note: f.st.note.trim(), date: f.st.date });
  f.s.close(); toast(ds.t === 'income' ? 'Доход добавлен' : 'Расход добавлен');
});

/* Категории доходов и расходов (§85, §86) */
on('fin.cats', () => {
  const st = { type: 'expense' };
  const s = sheet({ title: 'Категории', body: '' });
  const draw = () => {
    const list = finCats(st.type);
    const own = (co().finCats || {})[st.type] || {};
    s.set({
      title: 'Категории',
      body: `
        <div style="margin-bottom:14px">${segmented('fc.type', [{ v: 'expense', t: 'Расходы' }, { v: 'income', t: 'Доходы' }], st.type)}</div>
        <div class="stack s">${Object.entries(list).map(([k, v]) => {
        const n = (st.type === 'income' ? S.data.incomes : S.data.expenses).filter(x => x.companyId === cid() && x.cat === k).length;
        return `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
            <div class="tint" style="background:${v.color}1f;color:${v.color}">${icon(st.type === 'income' ? 'trendUp' : 'trendDown', 18)}</div>
            <div class="grow"><div class="tl">${esc(v.t)}</div>
              <div class="st">${n} ${plural(n, ['операция', 'операции', 'операций'])}</div></div>
            ${own[k] ? `<button class="ico-btn flat" data-a="fc.ren" data-k="${k}">${icon('pencil', 16)}</button>
                        <button class="ico-btn flat" data-a="fc.del" data-k="${k}">${icon('trash', 16)}</button>` : '<span class="bdg">базовая</span>'}
          </div>`;
      }).join('')}</div>
        <div class="tiny dim" style="margin-top:10px">Свои категории можно переименовать и удалить — операции при этом перейдут в «Прочее».</div>`,
      footer: `<button class="btn p" data-a="fc.add">${icon('plus', 17)}Новая категория</button>`,
    });
  };
  window.__fc = { s, st, draw };
  draw();
});
on('fc.type', ds => { window.__fc.st.type = ds.v; window.__fc.draw(); });
on('fc.add', async () => {
  const f = window.__fc;
  const v = await promptSheet({ title: 'Новая категория', label: 'Название', placeholder: 'Например, Обучение' });
  if (!v) return;
  addFinCat(f.st.type, v); f.draw(); toast('Категория добавлена');
});
on('fc.ren', async ds => {
  const f = window.__fc;
  const v = await promptSheet({ title: 'Переименовать', label: 'Название', value: finCatName(f.st.type, ds.k) });
  if (!v) return;
  renameFinCat(f.st.type, ds.k, v); f.draw(); toast('Переименовано');
});
on('fc.del', async ds => {
  const f = window.__fc;
  const ok = await confirmSheet({ title: 'Удалить категорию?', text: 'Операции этой категории перейдут в «Прочее». Суммы сохранятся.', ok: 'Удалить', danger: true });
  if (!ok) return;
  removeFinCat(f.st.type, ds.k); f.draw(); toast('Категория удалена', 'dan');
});

/* Регулярные платежи (§87–§90) */
export function recurringSheet(pre = {}) {
  const editing = pre.id ? recurring().find(r => r.id === pre.id) : null;
  const st = {
    type: editing ? editing.type : (pre.type || 'expense'),
    cat: editing ? editing.cat : (pre.cat || Object.keys(finCats(pre.type || 'expense'))[0]),
    amount: editing ? String(editing.amount) : String(pre.amount || ''),
    note: editing ? editing.note : (pre.note || ''),
    every: editing ? editing.every : 'month',
    from: editing ? startOfDay(new Date(editing.from)) : startOfDay(now()),
    to: editing && editing.to ? startOfDay(new Date(editing.to)) : null,
    hasEnd: !!(editing && editing.to),
    picking: null, month: startOfDay(now()),
  };
  const s = sheet({ title: '', body: '' });
  const capture = () => {
    const a = s.el.querySelector('#_ra'), n = s.el.querySelector('#_rn');
    if (a) st.amount = a.value; if (n) st.note = n.value;
  };
  const draw = () => {
    const list = finCats(st.type);
    s.set({
      title: st.picking ? (st.picking === 'from' ? 'Начиная с какого дня?' : 'До какого дня?') : (editing ? 'Регулярный платёж' : 'Новый регулярный платёж'),
      back: st.picking ? () => { st.picking = null; draw(); } : null,
      body: st.picking
        ? monthGrid(st.month, {
          selected: st.picking === 'from' ? st.from : (st.to || st.from),
          action: 'rc.pick', navAction: 'rc.month',
          minDate: st.picking === 'to' ? st.from : null, showCounts: false,
        })
        : `
      <div style="margin-bottom:14px">${segmented('rc.type', [{ v: 'expense', t: 'Расход' }, { v: 'income', t: 'Доход' }], st.type)}</div>
      <div class="field"><label>Сумма, ₸</label><input class="inp" id="_ra" inputmode="numeric" placeholder="0" value="${esc(st.amount)}"></div>
      <div class="field"><label>Категория</label>
        <div class="pick">${Object.entries(list).map(([k, v]) => `<button class="o ${st.cat === k ? 'on' : ''}" data-a="rc.cat" data-c="${k}"
          style="${st.cat === k ? 'background:' + v.color + '1f;color:' + v.color + ';border-color:' + v.color : ''}">${esc(v.t)}</button>`).join('')}</div></div>
      <div class="field"><label>Как часто</label>
        <div class="pick">${Object.entries(REPEAT).map(([k, v]) => `<button class="o ${st.every === k ? 'on' : ''}" data-a="rc.every" data-k="${k}">${v.t}</button>`).join('')}</div></div>
      <div class="field"><label>Начало</label>
        <button class="card flat press" style="width:100%;padding:12px 14px;text-align:left" data-a="rc.from">
          <div class="b">${dateFull(st.from)}</div></button></div>
      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd);margin-bottom:${st.hasEnd ? '10' : '14'}px">
        <div class="grow"><div class="tl">Есть дата окончания</div><div class="st">Например, реклама на три месяца</div></div>
        <button class="sw ${st.hasEnd ? 'on' : ''}" data-a="rc.hasEnd"></button></div>
      ${st.hasEnd ? `<div class="field"><label>Окончание</label>
        <button class="card flat press" style="width:100%;padding:12px 14px;text-align:left" data-a="rc.to">
          <div class="b">${st.to ? dateFull(st.to) : 'Выберите дату'}</div></button></div>` : ''}
      <div class="field"><label>Комментарий</label><input class="inp" id="_rn" placeholder="Необязательно" value="${esc(st.note)}"></div>
      <div class="tiny dim">Платёж не создаёт записи заранее — он сам попадает в расчёт каждого периода.</div>`,
      footer: st.picking ? '' : (editing
        ? `<div class="btns"><button class="btn dan" data-a="rc.del" data-id="${editing.id}">Удалить</button>
             <button class="btn p" data-a="rc.ok" data-id="${editing.id}">Сохранить</button></div>`
        : `<button class="btn p" data-a="rc.ok">Добавить</button>`),
    });
  };
  window.__rc = { s, st, draw, capture, editing };
  draw();
  return s;
}
on('fin.recAdd', () => recurringSheet({}));
on('fin.recOpen', ds => recurringSheet({ id: ds.id }));
on('rc.type', ds => {
  const r = window.__rc; r.capture(); r.st.type = ds.v;
  if (!finCats(ds.v)[r.st.cat]) r.st.cat = Object.keys(finCats(ds.v))[0];
  r.draw();
});
on('rc.cat', ds => { const r = window.__rc; r.capture(); r.st.cat = ds.c; r.draw(); });
on('rc.every', ds => { const r = window.__rc; r.capture(); r.st.every = ds.k; r.draw(); });
on('rc.from', () => { const r = window.__rc; r.capture(); r.st.picking = 'from'; r.st.month = startOfDay(r.st.from); r.draw(); });
on('rc.to', () => { const r = window.__rc; r.capture(); r.st.picking = 'to'; r.st.month = startOfDay(r.st.to || r.st.from); r.draw(); });
on('rc.hasEnd', () => {
  const r = window.__rc; r.capture();
  r.st.hasEnd = !r.st.hasEnd;
  if (!r.st.hasEnd) r.st.to = null;
  r.draw();
});
on('rc.month', ds => { const r = window.__rc; r.st.month = startOfDay(new Date(+ds.d)); r.draw(); });
on('rc.pick', ds => {
  const r = window.__rc, v = startOfDay(new Date(+ds.d));
  if (r.st.picking === 'from') { r.st.from = v; if (r.st.to && r.st.to < v) r.st.to = v; }
  else { r.st.to = v; r.st.hasEnd = true; }
  r.st.picking = null; r.draw();
});
on('rc.del', async ds => {
  const ok = await confirmSheet({ title: 'Удалить регулярный платёж?', text: 'Он перестанет учитываться во всех периодах.', ok: 'Удалить', danger: true });
  if (!ok) return;
  removeRecurring(ds.id); window.__rc.s.close(); toast('Платёж удалён', 'dan');
});
on('rc.ok', ds => {
  const r = window.__rc; r.capture();
  const a = +r.st.amount;
  if (!a) { toast('Введите сумму', 'dan'); return; }
  if (r.st.hasEnd && !r.st.to) { toast('Выберите дату окончания', 'dan'); return; }
  const patch = {
    type: r.st.type, amount: a, cat: r.st.cat, note: r.st.note.trim(), every: r.st.every,
    from: r.st.from.toISOString(), to: r.st.hasEnd && r.st.to ? r.st.to.toISOString() : null,
  };
  if (ds.id) { updateRecurring(ds.id, patch); toast('Платёж обновлён'); }
  else { addRecurring({ ...patch, from: r.st.from, to: patch.to }); toast('Регулярный платёж добавлен'); }
  r.s.close();
});

/* =========================================================
   Аналитика
   ========================================================= */
const an = { preset: 30, from: null, to: null, group: null };
route('o.analytics', {
  perm: 'analytics',
  tab: 'o.more',
  mount() {
    tipOnce('an', {
      title: 'Период выбирается свободно',
      text: 'Кроме готовых кнопок есть «Свой период» — любой отрезок дат из календаря. Графики группируются по дням, неделям или месяцам.',
      ic: 'chart',
    });
  },
  render() {
    const { start, end } = periodRange(an);
    const s = statsBetween(start, end, cid(), { group: an.group || 'auto' });
    const maxSvc = Math.max(1, ...s.byService.map(x => x.count));
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Аналитика</div><div class="top-sub">${periodLabel(an)}</div></div></div>
    <div class="wrap">${periodBar(an, 'an')}</div>

    <div class="wrap">
      <div class="card pad">
        <div class="row between"><div>
          <div class="tiny muted b">ВЫРУЧКА ПО ФАКТУ</div>
          <div style="font-size:26px;font-weight:780;letter-spacing:-.03em;margin-top:2px">${money(s.revenue)}</div>
          ${s.expected ? `<div class="tiny" style="color:var(--p);font-weight:650;margin-top:2px">+ ${money(s.expected)} ожидается по будущим записям</div>` : ''}
        </div>
        <span class="bdg ${s.deltaRev >= 0 ? 'ok' : 'dan'}">${s.deltaRev >= 0 ? '↑' : '↓'} ${Math.abs(s.deltaRev)}%</span></div>
        <div style="margin-top:12px">${groupBar(an, 'an', s.group)}</div>
        <div>${bars(s.series, { labels: s.labels.length <= 14 ? s.labels : [], height: 110 })}</div>
        <div class="tiny dim" style="margin-top:6px">Сравнение с предыдущим таким же периодом: ${money(s.prevRevenue)}</div>
      </div>
    </div>

    <div class="wrap sec"><div class="grid2">
      <div class="st-card"><div class="l">Записей</div><div class="v">${s.count}</div>
        <div class="tiny ${s.deltaCount >= 0 ? 'up' : 'down'}">${s.deltaCount >= 0 ? '+' : ''}${s.deltaCount} к прошлому</div></div>
      <div class="st-card"><div class="l">Средний чек</div><div class="v">${moneyShort(s.avg)} ₸</div>
        <div class="tiny dim">за визит</div></div>
      <div class="st-card"><div class="l">Новые клиенты</div><div class="v">${s.newClients}</div>
        <div class="tiny dim">из ${s.totalClients} в базе</div></div>
      <div class="st-card"><div class="l">Отмены</div><div class="v">${s.cancelled}</div>
        <div class="tiny dim">${Math.round(s.cancelled / Math.max(1, s.count + s.cancelled) * 100)}% записей</div></div>
    </div></div>

    <div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">Популярные услуги</div>
      <div class="card pad stack s">
        ${s.byService.slice(0, 6).map(x => `<div>
          <div class="row between" style="margin-bottom:5px"><span class="sm b nowrap">${esc(x.name)}</span><span class="tiny muted">${x.count} · ${moneyShort(x.sum)} ₸</span></div>
          ${progress(x.count / maxSvc * 100, x.color)}
        </div>`).join('') || '<div class="center sm muted">Нет данных</div>'}
      </div>
    </div>

    <div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">Загрузка мастеров</div>
      <div class="card pad stack s">
        ${s.byEmployee.map(x => `<div class="row" style="gap:10px">
          <div class="av s" style="background:${x.color}">${esc(x.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
          <div class="grow">
            <div class="row between" style="margin-bottom:4px"><span class="sm b">${esc(x.name.split(' ')[0])}</span><span class="tiny muted">${nAppt(x.count)}</span></div>
            ${progress(x.sum / Math.max(1, s.byEmployee[0].sum) * 100, x.color)}
          </div>
          <div class="b sm" style="width:58px;text-align:right">${moneyShort(x.sum)} ₸</div>
        </div>`).join('') || '<div class="center sm muted">Нет данных</div>'}
      </div>
    </div>

    <div class="wrap sec">
      <div class="card pad">
        <div class="row between"><div class="b sm">Повторные визиты</div><div class="b">${Math.round(s.repeat / Math.max(1, s.count) * 100)}%</div></div>
        <div style="margin-top:8px">${progress(s.repeat / Math.max(1, s.count) * 100, 'var(--ai)')}</div>
        <div class="tiny dim" style="margin-top:8px">Клиенты, которые пришли не в первый раз. Чем выше — тем стабильнее бизнес.</div>
      </div>
    </div>`;
  },
});
on('an.p', ds => { an.preset = +ds.v; an.from = an.to = null; rr(); });
on('an.custom', () => periodPicker(an, rr));
on('an.g', ds => { an.group = ds.v || null; rr(); });

/* =========================================================
   Обучение и помощь (§96–§99)
   Видео в демо нет, поэтому вместо ложной кнопки «Play» —
   честный разбор раздела текстом и переход прямо в него.
   ========================================================= */
const LESSONS = [
  {
    k: 'cal', ic: 'calendar', color: '#4C6FFF', t: 'Календарь и записи', min: 2,
    s: 'День, неделя, месяц и работа со свободными окнами',
    steps: [
      'Переключайте День / Неделя / Месяц кнопками сверху — в месяце видно загрузку каждого дня.',
      'Нажмите на заголовок с датой, чтобы прыгнуть на любое число.',
      'Тап по свободному окну открывает меню: записать, заблокировать, перерыв или отсутствие.',
      'В карточке записи есть перенос, отмена, звонок и AI-шпаргалка по клиенту.',
    ],
    go: 'o.cal',
  },
  {
    k: 'svc', ic: 'briefcase', color: '#8B5CF6', t: 'Услуги и категории', min: 2,
    s: 'Цены, длительность и свои категории',
    steps: [
      'Кнопка «+» создаёт услугу: название, цена, длительность и кто её выполняет.',
      'Длительность можно задать свою — например, 75 минут.',
      'Иконка сетки в шапке открывает категории: свои создаются кнопкой «Новая категория».',
      'Фотография услуги видна клиенту при выборе.',
    ],
    go: 'o.services',
  },
  {
    k: 'team', ic: 'users', color: '#12B76A', t: 'Команда и графики', min: 3,
    s: 'Роли, права, часы и отсутствия',
    steps: [
      'У каждого сотрудника своя роль: Мастер, Администратор или Владелец — список прав виден целиком.',
      'График задаётся по дням недели, с перерывами.',
      'Отпуск и больничный отмечаются сразу на диапазон дат.',
      'График мастера не может выходить за часы салона — лишнее время просто не предлагается клиентам.',
    ],
    go: 'o.team',
  },
  {
    k: 'fin', ic: 'wallet', color: '#F79009', t: 'Финансы', min: 3,
    s: 'Доходы, расходы и регулярные платежи',
    steps: [
      'Период выбирается кнопками или календарём — вплоть до своего отрезка дат.',
      'Выручка по факту и ожидаемая по будущим записям считаются раздельно.',
      'Аренду и зарплату заведите как регулярный платёж — дальше они учитываются сами.',
      'Категории расходов можно добавлять свои.',
    ],
    go: 'o.finance',
  },
  {
    k: 'ai', ic: 'sparkles', color: '#EC4899', t: 'AI-помощник', min: 2,
    s: 'Итоги недели, возврат клиентов, тексты',
    steps: [
      'Итоги недели считаются по вашим реальным данным, а не по шаблону.',
      'Помощник находит свободные окна и предлагает, кого на них позвать.',
      'Заметку о клиенте можно надиктовать голосом — AI сам разложит её по полочкам.',
    ],
    go: 'ai.home',
  },
  {
    k: 'client', ic: 'share', color: '#0EA5E9', t: 'Как это видит клиент', min: 1,
    s: 'Страница записи и напоминания',
    steps: [
      'Клиент открывает ссылку в Telegram и выбирает услугу, мастера, дату и время.',
      'Занятые дни в календаре зачёркнуты — записаться на них нельзя.',
      'После визита клиент может оценить его; оценки видите только вы.',
    ],
    go: null,
  },
];

route('o.help', {
  tab: 'o.more',
  render() {
    const steps = setupSteps();
    const done = steps.filter(s => s.done).length;
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Обучение</div><div class="top-sub">Короткие разборы разделов</div></div></div>

    <div class="wrap">
      <div class="card pad">
        <div class="row between" style="margin-bottom:8px">
          <div class="b">Первая настройка</div>
          <span class="bdg ${done === steps.length ? 'ok' : 'warn'}">${done} из ${steps.length}</span>
        </div>
        ${progress(done / steps.length * 100, done === steps.length ? 'var(--ok)' : 'var(--p)')}
        <div class="stack s" style="margin-top:12px">
          ${steps.map(st => `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%;${st.done ? 'opacity:.6' : ''}"
            data-a="hp.step" data-k="${st.k}" data-act="${st.act}">
            <span style="color:${st.done ? 'var(--ok)' : 'var(--tx-3)'};flex:none">${icon(st.done ? 'checkCircle' : 'plus', 20)}</span>
            <div class="grow" style="text-align:left"><div class="tl">${esc(st.t)}</div><div class="st">${esc(st.s)}</div></div>
            ${st.done ? '' : icon('fwd', 17)}
          </button>`).join('')}
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Разборы разделов</div></div>
      <div class="wrap stack s">
        ${LESSONS.map(l => `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="hp.lesson" data-k="${l.k}">
          <div class="ic" style="background:${l.color}1f;color:${l.color}">${icon(l.ic, 19)}</div>
          <div class="grow" style="text-align:left"><div class="tl">${esc(l.t)}</div><div class="st">${esc(l.s)}</div></div>
          <span class="tiny dim" style="flex:none">${l.min} мин</span>
          ${icon('fwd', 17)}
        </button>`).join('')}
      </div>
    </div>

    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="hp.tips">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('info', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Показать подсказки заново</div>
          <div class="st">Всплывающие пояснения при первом входе в раздел</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="hp.support">
        <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('msg', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Написать в поддержку</div>
          <div class="st">Ответим в Telegram</div></div>${icon('fwd', 17)}</button>
    </div></div>`;
  },
});
on('hp.step', ds => {
  const act = ds.act;
  if (act === 'o.share') { go('o.more'); setTimeout(() => fire('o.share'), 200); return; }
  if (act === 'tm.add') { go('o.team'); setTimeout(() => fire('tm.add'), 200); return; }
  fire(act);
});
on('hp.lesson', ds => {
  const l = LESSONS.find(x => x.k === ds.k);
  const s = sheet({
    title: l.t,
    body: `
      <div class="row" style="gap:12px;align-items:center;margin-bottom:14px">
        <div class="tint" style="background:${l.color}1f;color:${l.color};width:46px;height:46px">${icon(l.ic, 22)}</div>
        <div class="grow"><div class="b">${esc(l.s)}</div><div class="tiny dim">${l.min} ${plural(l.min, ['минута', 'минуты', 'минут'])} чтения</div></div>
      </div>
      <div class="stack s">
        ${l.steps.map((t, i) => `<div class="row" style="gap:10px;align-items:flex-start">
          <div class="tint" style="width:26px;height:26px;flex:none;background:var(--sf-3);color:var(--tx-2);font-size:12px;font-weight:700;border-radius:9px">${i + 1}</div>
          <div class="sm" style="line-height:1.5;color:var(--tx-2);padding-top:3px">${esc(t)}</div>
        </div>`).join('')}
      </div>`,
    footer: l.go ? `<button class="btn p" data-a="hp.goto" data-r="${l.go}">Открыть раздел</button>` : `<button class="btn gh" data-a="hp.close">Понятно</button>`,
  });
  window.__hp = s;
});
on('hp.goto', ds => { window.__hp && window.__hp.close(); setTimeout(() => go(ds.r), 240); });
on('hp.close', () => window.__hp && window.__hp.close());
on('hp.tips', async () => {
  const ok = await confirmSheet({
    title: 'Показать подсказки заново?',
    text: 'Короткие пояснения снова появятся при входе в разделы — по одному разу в каждом.',
    ok: 'Показать',
  });
  if (!ok) return;
  resetTips(); toast('Подсказки включены');
});
on('hp.support', () => demoNote('Поддержка',
  'В рабочей версии кнопка открывает чат с поддержкой прямо в Telegram.',
  'В демо переписки нет — показываем, как это будет выглядеть.'));

/* =========================================================
   Отзывы (§80, §81)
   Наружу не публикуются: это внутренний инструмент качества.
   ========================================================= */
const rvf = { emp: null, stars: 0 };
route('o.reviews', {
  perm: 'analytics',
  tab: 'o.more',
  render() {
    let list = reviews().slice().sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    const total = list.length;
    const avg = total ? (list.reduce((s, r) => s + r.rating, 0) / total).toFixed(1) : '—';
    const dist = [5, 4, 3, 2, 1].map(n => ({ n, c: list.filter(r => r.rating === n).length }));
    if (rvf.emp) list = list.filter(r => r.employeeId === rvf.emp);
    if (rvf.stars) list = list.filter(r => r.rating === rvf.stars);

    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Отзывы</div><div class="top-sub">${total} ${plural(total, ['оценка', 'оценки', 'оценок'])}</div></div></div>

    ${!total ? `<div class="wrap">${emptyState({ ic: 'star', title: 'Отзывов пока нет', text: 'Клиент может оценить визит сразу после его завершения — предложение появляется у него в «Моих записях».' })}</div>` : `
    <div class="wrap">
      <div class="card pad row" style="gap:18px;align-items:center">
        <div class="center" style="flex:none">
          <div style="font-size:38px;font-weight:800;letter-spacing:-.04em;line-height:1">${avg}</div>
          <div class="row" style="gap:2px;color:#F5A524;margin-top:4px">${[1, 2, 3, 4, 5].map(n => icon('star', 13, 2.4)).join('')}</div>
          <div class="tiny dim" style="margin-top:4px">${total} ${plural(total, ['отзыв', 'отзыва', 'отзывов'])}</div>
        </div>
        <div class="grow stack" style="gap:5px">
          ${dist.map(d => `<div class="row" style="gap:8px;align-items:center">
            <span class="tiny dim" style="width:10px">${d.n}</span>
            <div class="grow">${progress(d.c / Math.max(1, total) * 100, '#F5A524')}</div>
            <span class="tiny dim" style="width:22px;text-align:right">${d.c}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="chips" style="margin-top:14px">
      <button class="chip ${!rvf.emp && !rvf.stars ? 'on' : ''}" data-a="rvf.all">Все</button>
      ${[5, 4, 3, 2, 1].filter(n => dist.find(d => d.n === n).c).map(n => `<button class="chip ${rvf.stars === n ? 'on' : ''}" data-a="rvf.stars" data-n="${n}">${n} ${icon('star', 11, 2.4)}</button>`).join('')}
      ${staff().map(e => `<button class="chip ${rvf.emp === e.id ? 'on' : ''}" data-a="rvf.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}
    </div>

    <div class="wrap stack s" style="margin-top:12px">
      ${list.length ? list.slice(0, 40).map(r => {
      const cl = client(r.clientId), e = emp(r.employeeId), a = r.apptId ? appts().find(x => x.id === r.apptId) : null;
      return `<div class="card pad">
          <div class="row" style="gap:10px;align-items:center;margin-bottom:8px">
            ${avatar(cl || { initials: '?' }, 's')}
            <div class="grow"><div class="b sm">${esc(cl ? cl.name : 'Клиент')}</div>
              <div class="tiny muted">${esc(e ? e.name.split(' ')[0] : '')}${a ? ' · ' + esc(apptTitle(a)) : ''}</div></div>
            <div class="row" style="gap:1px;color:#F5A524;flex:none">${Array.from({ length: r.rating }, () => icon('star', 13, 2.4)).join('')}</div>
          </div>
          ${r.text ? `<div class="sm" style="line-height:1.5;color:var(--tx-2)">${esc(r.text)}</div>` : '<div class="tiny dim">Без комментария</div>'}
          <div class="tiny dim" style="margin-top:8px">${relPast(new Date(r.createdAt || r.date), now())}</div>
        </div>`;
    }).join('') : `<div class="card pad center sm muted">По этому фильтру отзывов нет</div>`}
    </div>
    <div class="wrap sec"><div class="tiny dim center">Отзывы видны только вам: на странице записи они не публикуются.</div></div>`}`;
  },
});
on('rvf.all', () => { rvf.emp = null; rvf.stars = 0; rr(); });
on('rvf.stars', ds => { rvf.stars = rvf.stars === +ds.n ? 0 : +ds.n; rr(); });
on('rvf.emp', ds => { rvf.emp = rvf.emp === ds.id ? null : ds.id; rr(); });

/* =========================================================
   Рассылки
   ========================================================= */
route('o.broadcasts', {
  perm: 'clients',
  tab: 'o.more',
  fab: () => `<button class="fab" data-a="bc.new">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = broadcasts();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Рассылки</div><div class="top-sub">${list.length} отправлено</div></div></div>
    <div class="wrap stack s">
      ${list.length ? list.map(b => `<div class="card pad">
        <div class="row between" style="margin-bottom:6px">
          <div class="b">${esc(b.title)}</div>
          <span class="bdg ok">отправлено</span>
        </div>
        <div class="sm muted" style="line-height:1.45">${esc(String(b.text).slice(0, 110))}${String(b.text).length > 110 ? '…' : ''}</div>
        <div class="hr"></div>
        <div class="row" style="gap:16px">
          <div><div class="tiny dim">Получили</div><div class="b sm">${b.to}</div></div>
          <div><div class="tiny dim">Открыли</div><div class="b sm">${b.open}</div></div>
          <div><div class="tiny dim">Записались</div><div class="b sm" style="color:var(--ok)">${b.booked}</div></div>
          <div class="grow"></div>
          <div class="tiny dim">${relPast(new Date(b.sentAt), now())}</div>
        </div>
      </div>`).join('') : emptyState({ ic: 'megaphone', title: 'Рассылок пока нет', text: 'Напомните о себе клиентам, которые давно не были.', action: 'Создать рассылку', act: 'bc.new' })}
    </div>`;
  },
});
on('bc.new', () => broadcastFlow({}));

export function broadcastFlow(pre = {}) {
  const all = clients();
  const lost = lostClients(cid(), 45).map(x => x.c);
  const noNext = all.filter(c => !clientStats(c.id).next);
  const AUD = [
    { v: 'all', t: 'Все клиенты', n: all.length, list: all },
    { v: 'lost', t: 'Давно не были', n: lost.length, list: lost },
    { v: 'free', t: 'Без будущей записи', n: noNext.length, list: noNext },
  ];
  const st = { aud: pre.aud || 'lost', text: pre.text || '', title: pre.title || 'Рассылка', step: 1 };
  const s = sheet({ title: 'Новая рассылка', body: '' });
  const audience = () => AUD.find(a => a.v === st.aud);

  const draw = () => {
    if (st.step === 1) s.set({
      title: 'Кому отправим?',
      body: `<div class="stack s">${AUD.map(a => `
        <button class="role ${st.aud === a.v ? 'on' : ''}" style="width:100%;display:flex;align-items:center;gap:12px" data-a="bc.aud" data-v="${a.v}">
          <div class="grow"><div class="t">${a.t}</div><div class="s">${a.n} ${plural(a.n, ['клиент', 'клиента', 'клиентов'])}</div></div>
          ${st.aud === a.v ? `<span style="color:var(--p)">${icon('checkCircle', 20)}</span>` : ''}
        </button>`).join('')}</div>`,
      footer: `<button class="btn p" data-a="bc.s2" ${!audience().n ? 'disabled' : ''}>Далее · ${audience().n} получателей</button>`,
    });
    else if (st.step === 2) s.set({
      title: 'Текст сообщения',
      back: () => { st.step = 1; draw(); },
      body: `<div class="field"><label>Заголовок</label><input class="inp" id="_t" value="${esc(st.title)}"></div>
        <div class="field"><label>Сообщение</label><textarea class="inp" id="_m" style="min-height:130px" placeholder="Текст рассылки">${esc(st.text)}</textarea></div>
        <button class="btn ai sm" style="width:100%" data-a="bc.ai">${icon('sparkles', 16)}Сгенерировать через AI</button>`,
      footer: `<button class="btn p" data-a="bc.s3">Далее</button>`,
    });
    else if (st.step === 3) s.set({
      title: 'Проверьте и отправьте',
      back: () => { st.step = 2; draw(); },
      body: `<div class="card flat" style="padding:14px;margin-bottom:12px">
          <div class="b sm" style="margin-bottom:6px">${esc(st.title)}</div>
          <div class="sm" style="white-space:pre-wrap;line-height:1.5">${esc(st.text)}</div>
        </div>
        <div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('users', 18)}</div>
          <div class="grow"><div class="tl">${audience().t}</div><div class="st">${audience().n} получателей</div></div>
        </div>
        <div class="tiny dim" style="margin-top:10px">В демо-режиме сообщения не уходят в Telegram — показываем реалистичный результат.</div>`,
      footer: `<div class="btns"><button class="btn gh" data-a="bc.test">Тест себе</button><button class="btn p" data-a="bc.send">Отправить</button></div>`,
    });
    else if (st.step === 4) s.set({
      title: 'Отправляем…', body: loadingBlock('Отправляем ' + audience().n + ' сообщений…'),
    });
    else s.set({
      title: 'Готово',
      body: `<div class="succ" style="padding:20px 0 10px">
          <div class="check">${icon('check', 44, 3)}</div>
          <div class="t">Отправлено</div>
          <div class="s">${st.res.to} ${plural(st.res.to, ['клиенту', 'клиентам', 'клиентам'])}</div>
        </div>
        <div class="grid3" style="margin-top:6px">
          <div class="st-card center"><div class="v">${st.res.to}</div><div class="l">получили</div></div>
          <div class="st-card center"><div class="v">${st.res.open}</div><div class="l">открыли</div></div>
          <div class="st-card center"><div class="v" style="color:var(--ok)">${st.res.booked}</div><div class="l">записались</div></div>
        </div>
        <div class="tiny dim center" style="margin-top:12px">Результат обновляется в разделе «Рассылки»</div>`,
      footer: `<button class="btn p" data-a="bc.done">Понятно</button>`,
    });
  };
  on('bc.aud', ds => { st.aud = ds.v; draw(); });
  on('bc.s2', () => {
    if (!st.text) {
      st.text = st.aud === 'lost'
        ? `${co().short} скучает по вам 🤍\n\nВы давно не заглядывали. Дарим 15% на любую услугу при записи на этой неделе.`
        : `Привет! Это ${co().short} ✨\n\nЕсть свободные окна на ближайшие дни — записывайтесь в один клик.`;
      st.title = st.aud === 'lost' ? 'Возвращаем клиентов' : 'Свободные окна';
    }
    st.step = 2; draw();
  });
  on('bc.s3', () => {
    st.title = s.el.querySelector('#_t').value.trim() || 'Рассылка';
    st.text = s.el.querySelector('#_m').value.trim();
    if (!st.text) { toast('Введите текст', 'dan'); return; }
    st.step = 3; draw();
  });
  on('bc.ai', async () => {
    const m = s.el.querySelector('#_m');
    m.value = 'Генерирую…'; m.disabled = true;
    await wait(900);
    const { storyVariants } = await import('../ai-engine.js');
    m.value = storyVariants(st.aud === 'lost' ? 'back' : 'gaps')[Math.floor(Math.random() * 3)];
    m.disabled = false; haptic('success');
  });
  on('bc.test', () => demoNote('Тестовая отправка', 'В демо-версии сообщения не уходят в Telegram по-настоящему — рассылка симулируется, чтобы показать весь сценарий целиком.', 'В рабочей версии тест приходит вам в личные сообщения от бота.'));
  on('bc.send', async () => {
    st.step = 4; draw();
    await wait(1600);
    const n = audience().n;
    const open = Math.round(n * (0.55 + Math.random() * 0.2));
    const booked = Math.max(1, Math.round(open * (0.12 + Math.random() * 0.12)));
    st.res = { to: n, open, booked };
    addBroadcast({ title: st.title, text: st.text, to: n, open, booked });
    st.step = 5; draw(); haptic('success');
  });
  on('bc.done', () => { s.close(); go('o.broadcasts'); });
  draw();
  return s;
}

/* =========================================================
   Подписка
   ========================================================= */
route('o.subscription', {
  perm: 'billing',
  tab: 'o.more',
  render() {
    const c = co();
    const days = Math.ceil((new Date(c.planUntil) - now()) / 86400000);
    const s30 = rangeStats(30);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Подписка</div><div class="top-sub">${esc(c.name)}</div></div></div>
    <div class="wrap">
      <div class="hero" style="background:linear-gradient(135deg,#F79009,#F04462)">
        <div class="lb">Текущий тариф</div>
        <div class="tm" style="font-size:30px">${esc(c.plan)}</div>
        <div class="sv">${days > 0 ? 'Активен до ' + new Date(c.planUntil).getDate() + ' ' + MONTHS[new Date(c.planUntil).getMonth()] : 'Подписка истекла'}</div>
        <div class="hero-meta"><span>${icon('users', 13, 2)} ${emps().length} сотрудников</span><span>${icon('calendar', 13, 2)} ${s30.count} записей за месяц</span></div>
        <button class="btn" data-a="sub.pay" data-p="${c.plan}">${days > 0 ? 'Продлить на месяц' : 'Оплатить'}</button>
      </div>
    </div>
    ${days < 10 ? `<div class="wrap sec"><div class="card pad" style="border-color:var(--dan-soft);background:var(--dan-soft)">
      <div class="row" style="gap:8px;color:var(--dan)">${icon('alert', 18)}<b class="sm">${days > 0 ? 'Осталось ' + days + ' ' + plural(days, ['день', 'дня', 'дней']) : 'Подписка истекла'}</b></div>
      <div class="sm" style="margin-top:6px;color:var(--tx-2)">После окончания страница записи перестанет принимать новых клиентов.</div>
    </div></div>` : ''}
    <div class="sec">
      <div class="sec-h"><div class="sec-t">Тарифы</div></div>
      <div class="wrap stack">
        ${plans().filter(p => p.active !== false || p.id === c.plan).map(p => `<div class="card pad" style="${p.id === c.plan ? 'border-color:transparent;box-shadow:inset 0 0 0 2px var(--p),var(--sh-2)' : ''}">
          <div class="row between" style="margin-bottom:8px">
            <div><div class="b" style="font-size:17px">${esc(p.name)}</div>
              <div class="tiny muted">${money(p.price)} / ${(PERIODS[p.period] || PERIODS.month).t}</div></div>
            ${p.id === c.plan ? '<span class="bdg p">текущий</span>' : `<button class="btn xs p" data-a="sub.switch" data-p="${p.id}">Выбрать</button>`}
          </div>
          <div class="stack" style="gap:5px">${(p.feats || []).map(f => `<div class="row sm" style="gap:7px;color:var(--tx-2)"><span style="color:var(--ok)">${icon('check', 14, 2.6)}</span>${esc(f)}</div>`).join('')}</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="wrap sec"><div class="tiny dim center">Оплата в демо-режиме симулируется. В продакшене — Telegram Payments или Kaspi.</div></div>`;
  },
});
on('sub.pay', async ds => {
  const s = sheet({ title: 'Оплата', body: loadingBlock('Проводим платёж…') });
  await wait(1500);
  const days = extendPlan(cid());
  s.close(); toast('Подписка продлена на ' + days + ' ' + plural(days, ['день', 'дня', 'дней']));
});
on('sub.switch', async ds => {
  const p = planById(ds.p);
  if (!p) return;
  const per = (PERIODS[p.period] || PERIODS.month).t;
  const ok = await confirmSheet({ title: 'Перейти на ' + p.name + '?', text: money(p.price) + ' за ' + per + '. Спишем сразу после подтверждения.', ok: 'Перейти' });
  if (!ok) return;
  const s = sheet({ title: 'Оплата', body: loadingBlock('Проводим платёж…') });
  await wait(1400);
  extendPlan(cid(), p.id);
  s.close(); toast('Тариф изменён на ' + p.name);
});

/* =========================================================
   Настройки
   ========================================================= */
route('o.settings', {
  perm: 'settings',
  tab: 'o.more',
  render() {
    const c = co();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Настройки</div></div></div>

    <div class="wrap sec" style="margin-top:4px">
      <div class="card" style="padding:0;overflow:hidden">
        ${c.cover ? `<div class="cover" style="background-image:url('${c.cover}')"></div>` : ''}
        <div class="pad row" style="gap:14px">
          ${avatar({ initials: c.initials, color: c.color, photo: c.logo }, 'l', 'av-sq')}
          <div class="grow"><div class="b" style="font-size:16px">${esc(c.name)}</div>
            <div class="sm muted">${esc(c.cat)} · ${esc(c.city)}</div></div>
        </div>
      </div>
    </div>

    <div class="wrap sec"><div class="stack s">
      ${row('building', 'О компании', 'Название, адрес, телефон и цвет', 'set.company')}
      ${row('image', 'Фото и логотип', c.logo || c.cover ? 'Показываются на странице записи' : 'Пока не загружены', 'set.photos')}
    </div></div>

    <div class="wrap sec"><div class="stack s">
      ${row('clock', 'Часы работы', 'Когда принимаете клиентов', 'set.hours')}
      ${row('link', 'Страница записи', bookingLink(c).replace('https://', ''), 'o.share')}
      ${row('bell', 'Напоминания', 'За 24 часа и за 2 часа', 'set.reminders')}
      ${row('sparkles', 'AI-помощник', S.aiMode === 'live' ? 'Режим LIVE' : 'Режим DEMO', 'set.ai')}
    </div></div>

    ${catalogSection(c)}

    <div class="wrap sec"><div class="stack s">
      <div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
        <div class="ic">${icon('msg', 18)}</div>
        <div class="grow"><div class="tl">${t('Язык')}</div>
          <div class="st">${esc((LANGS.find(l => l.id === lang()) || LANGS[0]).t)}</div></div>
        <div class="seg" style="width:150px">
          ${LANGS.map(l => `<button class="${lang() === l.id ? 'on' : ''}" data-a="set.lang" data-v="${l.id}">${esc(l.short)}</button>`).join('')}
        </div>
      </div>
      <div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
        <div class="ic">${icon(document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun', 18)}</div>
        <div class="grow"><div class="tl">Оформление</div><div class="st">${S.theme === 'auto' ? 'Как в Telegram' : S.theme === 'dark' ? 'Тёмное' : 'Светлое'}</div></div>
        <div class="seg" style="width:150px">
          ${[['auto', 'Авто'], ['light', 'Свет'], ['dark', 'Тьма']].map(t => `<button class="${S.theme === t[0] ? 'on' : ''}" data-a="set.theme" data-v="${t[0]}">${t[1]}</button>`).join('')}
        </div>
      </div>
    </div></div>

    <div class="wrap sec"><div class="stack s">
      ${row('shield', 'Демо-режим', 'Роли, компании, тестовая дата', 'dev.open')}
      ${row('refresh', 'Сбросить демо-данные', 'Вернуть исходное состояние', 'set.reset')}
    </div></div>

    <div class="wrap sec"><div class="center tiny dim" data-a="set.secret" style="padding:10px;user-select:none">Zapis · демо-версия 2.0<br>Все данные хранятся только на вашем устройстве</div></div>`;
  },
});
/* Клиенты, пришедшие по ссылке салона, видят в приложении тихий вход
   в каталог других салонов. Это приток клиентов из каталога в обе стороны,
   но салону, который платит за привлечение, нужна возможность закрыть его
   совсем — иначе рядом с его записями стоит ссылка на соседей. */
function catalogSection(c) {
  const allowed = canOnlyMine(c);
  const on = allowed && !!c.onlyMine;
  // Пока карточка не дозаполнена, салона в каталоге нет. Владелец должен
  // узнать об этом здесь, а не гадать, почему его никто не находит.
  const missing = catalogMissing(c);
  const listed = catalogReady(c);
  return `<div class="wrap sec"><div class="stack s">
    ${listed ? '' : `<div class="lrow" style="border-radius:16px;border:1px solid var(--warn-soft);background:var(--warn-soft)">
      <div class="ic" style="background:var(--warn);color:#fff">${icon('alert', 18)}</div>
      <div class="grow"><div class="tl">Салона нет в каталоге</div>
        <div class="st">Осталось заполнить: ${esc(missing.join(', '))}</div></div>
    </div>`}
    <div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
      <div class="ic">${icon('search', 18)}</div>
      <div class="grow"><div class="tl">Только мой салон</div>
        <div class="st">${!allowed ? 'Доступно на тарифе PRO' : on ? 'Каталог скрыт' : 'Каталог виден клиентам'}</div></div>
      <button class="sw ${on ? 'on' : ''}" data-a="set.onlyMine" ${allowed ? '' : 'disabled style="opacity:.4"'}></button>
    </div>
    <div class="tiny dim" style="padding:0 4px">${on
      ? 'Ваши клиенты видят только ваш салон. Найти вас в каталоге посторонние по-прежнему могут.'
      : 'Сейчас в «Моих записях» и профиле у клиента есть строка «Записаться в другом месте». На вашей странице её нет.'}</div>
  </div></div>`;
}

const row = (ic, t, s, a, extra = '') => `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="${a}" ${extra}>
  <div class="ic">${icon(ic, 18)}</div>
  <div class="grow" style="text-align:left"><div class="tl">${t}</div><div class="st">${s}</div></div>
  <span class="chev">${icon('fwd', 17, 2)}</span></button>`;

on('set.lang', ds => { setLang(ds.v); });
on('set.onlyMine', ds => {
  const c = co();
  if (!canOnlyMine(c)) { toast('Доступно на тарифе PRO', 'dan'); return; }
  c.onlyMine = !c.onlyMine;
  emit();
  toast(c.onlyMine ? 'Каталог скрыт от ваших клиентов' : 'Каталог снова виден клиентам');
});
on('set.theme', async ds => { S.theme = ds.v; const m = await import('../main.js'); m.applyTheme(); emit(); });
on('set.company', () => {
  const c0 = co();
  // черновик отдельно от модели: выбор цвета перерисовывает форму,
  // а введённое название при этом теряться не должно
  const d = { name: c0.name, cat: c0.cat, addr: c0.addr, phone: c0.phone, about: c0.about || '' };
  const s = sheet({ title: 'О компании', body: '' });
  const capture = () => {
    const g = q => { const el = s.el.querySelector(q); return el ? el.value : null; };
    const n = g('#_n'), cat = g('#_c'), a = g('#_a'), p = g('#_p'), ab = g('#_d');
    if (n != null) d.name = n; if (cat != null) d.cat = cat; if (a != null) d.addr = a;
    if (p != null) d.phone = p; if (ab != null) d.about = ab;
  };
  const draw = () => {
    const c = co();
    s.set({
      title: 'О компании',
      body: `<div class="field"><label>Название</label><input class="inp" id="_n" value="${esc(d.name)}"></div>
      <div class="field"><label>Категория</label><input class="inp" id="_c" value="${esc(d.cat)}"></div>
      <div class="field"><label>Адрес</label><input class="inp" id="_a" value="${esc(d.addr)}"></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" value="${esc(d.phone)}"></div>
      <div class="field"><label>Описание</label><textarea class="inp" id="_d">${esc(d.about)}</textarea></div>

      <div class="field"><label>Фирменный цвет</label>
        <div class="col-pick">
          ${BRAND_COLORS.map(x => `<button class="col-dot ${c.color === x.v ? 'on' : ''}" title="${esc(x.t)}"
            style="background:${x.v}" data-a="set.color" data-v="${x.v}"></button>`).join('')}
        </div>
        <div class="col-prev" style="background:${brandGradient(c.color)}">
          <span>${esc(d.name || c.name)}</span>
          <i>так выглядит страница записи</i>
        </div>
        <div class="tiny dim" style="margin-top:8px">Цвет виден клиентам на странице записи${c.cover ? '. Сейчас поверх него стоит фото салона — цвет остаётся на кнопке и плашке' : ''}.</div>
      </div>`,
      footer: `<button class="btn p" data-a="set.companySave">Сохранить</button>`,
    });
  };
  window.__sc = { s, d, draw, capture };
  draw();
});
on('set.color', ds => {
  const sc = window.__sc;
  sc.capture();
  setCompanyColor(ds.v);
  sc.draw();
});
on('set.companySave', () => {
  const sc = window.__sc; sc.capture();
  const c = co(), d = sc.d;
  c.name = d.name.trim() || c.name;
  c.cat = d.cat.trim();
  c.addr = d.addr.trim();
  c.phone = d.phone.trim();
  c.about = d.about.trim();
  c.initials = c.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  emit(); sc.s.close(); toast('Сохранено');
});

/* Фото и логотип компании (§32, §33) */
on('set.photos', () => {
  const s = sheet({ title: 'Фото и логотип', body: '' });
  const draw = () => {
    const c = co();
    s.set({
      title: 'Фото и логотип',
      body: `
        ${photoField({
        src: c.logo, label: 'Логотип', actPick: 'ph.logo', actDel: 'ph.logoDel', round: false,
        hint: 'Квадратный. Показывается в шапке кабинета и на странице записи.',
      })}
        ${photoField({
        src: c.cover, label: 'Фото салона', actPick: 'ph.cover', actDel: 'ph.coverDel',
        hint: 'Широкое фото интерьера — станет обложкой страницы записи.',
      })}
        <div class="tiny dim">Изображения хранятся прямо в браузере и уменьшаются автоматически,
        поэтому даже большая фотография с телефона не замедлит приложение.</div>`,
    });
  };
  window.__ph = { s, draw };
  draw();
});
on('ph.logo', async () => {
  const v = await pickImage(IMG_MAX.logo);
  if (!v) return;
  co().logo = v; emit(); window.__ph.draw(); toast('Логотип загружен');
});
on('ph.logoDel', () => { co().logo = null; emit(); window.__ph.draw(); toast('Логотип удалён', 'dan'); });
on('ph.cover', async () => {
  const v = await pickImage(IMG_MAX.photo);
  if (!v) return;
  co().cover = v; emit(); window.__ph.draw(); toast('Фото загружено');
});
on('ph.coverDel', () => { co().cover = null; emit(); window.__ph.draw(); toast('Фото удалено', 'dan'); });

on('set.hours', () => {
  markSetup('hours');
  const s = sheet({ title: 'Часы работы', body: '' });
  const draw = () => {
    const c = co();
    s.set({
      title: 'Часы работы',
      body: `<div class="stack s">${[1, 2, 3, 4, 5, 6, 0].map(d => {
        const w = c.hours[d];
        return `<div class="card" style="padding:12px 14px">
          <div class="row between">
            <div class="grow">
              <div class="b" style="text-transform:capitalize">${WD_FULL[d]}</div>
              <div class="sm ${w.on ? 'muted' : 'dim'}">${w.on ? w.from + ' — ' + w.to : 'Выходной'}</div>
            </div>
            <button class="sw ${w.on ? 'on' : ''}" data-a="ch.day" data-d="${d}"></button>
          </div>
          ${w.on ? `<div class="row" style="gap:8px;margin-top:10px">
            <button class="btn xs gh" data-a="ch.time" data-d="${d}" data-k="from">${icon('clock', 14)}${w.from}</button>
            <span class="dim">—</span>
            <button class="btn xs gh" data-a="ch.time" data-d="${d}" data-k="to">${w.to}</button>
            <div class="grow"></div>
            <button class="btn xs" data-a="ch.copy" data-d="${d}">${icon('copy', 13)}На все дни</button>
          </div>` : ''}
        </div>`;
      }).join('')}</div>
      ${conflictsCard()}
      <div class="tiny dim" style="margin-top:10px">
        У каждого дня своё время — сокращённые суббота и воскресенье настраиваются здесь.
        Индивидуальный график мастера задаётся в его карточке и не может выходить за эти рамки.
      </div>`,
      footer: `<button class="btn gh" data-a="ch.apply">Применить ко всем мастерам</button>`,
    });
  };
  window.__ch = { s, draw };
  draw();
});
/* §37 — часы салона главнее личного графика: если мастер выставлен шире,
   лишнее время всё равно не будет доступно для записи. Молча резать нельзя,
   иначе владелец не поймёт, куда делись слоты, — поэтому предупреждаем. */
function conflictsCard() {
  const list = scheduleConflicts();
  if (!list.length) return '';
  const byEmp = {};
  list.forEach(x => { (byEmp[x.emp.id] = byEmp[x.emp.id] || { e: x.emp, days: [] }).days.push(x); });
  const rows = Object.values(byEmp).slice(0, 6);
  return `<div class="card pad" style="margin-top:14px;background:var(--warn-soft);border-color:transparent">
    <div class="row" style="gap:8px;color:var(--warn);margin-bottom:8px">${icon('alert', 18)}
      <b class="sm">График шире, чем часы салона</b></div>
    <div class="stack" style="gap:6px">
      ${rows.map(r => `<div class="sm" style="color:var(--tx-2)">
        <b>${esc(r.e.name.split(' ')[0])}</b> — ${r.days.map(d => WD[d.day] + (d.kind === 'closed' ? ' (салон закрыт)' : ' ' + d.empFrom + '–' + d.empTo)).join(', ')}
      </div>`).join('')}
    </div>
    <div class="tiny" style="margin-top:8px;color:var(--tx-2)">
      Записи принимаются только внутри часов салона. Поправьте график мастера или расширьте часы.
    </div>
    <button class="btn xs gh" style="margin-top:10px;width:auto" data-a="ch.fix">${icon('check', 14)}Подогнать графики под салон</button>
  </div>`;
}
on('ch.fix', async () => {
  const list = scheduleConflicts();
  const ok = await confirmSheet({
    title: 'Подогнать графики?',
    text: `У ${Object.keys(list.reduce((m, x) => (m[x.emp.id] = 1, m), {})).length} мастеров время выйдет ровно в рамки салона. Выходные и перерывы останутся как есть.`,
    ok: 'Подогнать',
  });
  if (!ok) return;
  const c = co();
  emps().forEach(e => {
    for (let d = 0; d < 7; d++) {
      const w = e.schedule && e.schedule[d]; const ch = c.hours[d];
      if (!w || !w.on) continue;
      if (!ch || !ch.on) { w.on = false; continue; }
      if (toMin(w.from) < toMin(ch.from)) w.from = ch.from;
      if (toMin(w.to) > toMin(ch.to)) w.to = ch.to;
    }
  });
  emit(); window.__ch.draw(); toast('Графики подогнаны под часы салона');
});

on('ch.day', ds => {
  const c = co(); c.hours[ds.d].on = !c.hours[ds.d].on; emit();
  window.__ch.draw();
});
on('ch.time', ds => {
  const c = co();
  timePick(c.hours[ds.d][ds.k], v => {
    const w = c.hours[ds.d];
    w[ds.k] = v;
    // конец не может быть раньше начала
    if (toMin(w.to) <= toMin(w.from)) w.to = toHM(Math.min(23 * 60 + 30, toMin(w.from) + 60));
    emit(); window.__ch.draw(); toast('Часы обновлены');
  });
});
on('ch.copy', ds => {
  const c = co(), src = c.hours[ds.d];
  [1, 2, 3, 4, 5, 6, 0].forEach(d => {
    if (String(d) === String(ds.d)) return;
    if (!c.hours[d].on) return;         // выходные не трогаем
    c.hours[d].from = src.from; c.hours[d].to = src.to;
  });
  emit(); window.__ch.draw(); toast('Время скопировано на рабочие дни');
});
on('ch.apply', async () => {
  const c = co();
  const ok = await confirmSheet({
    title: 'Применить график ко всем мастерам?',
    text: 'Личные графики мастеров будут заменены общими часами салона. Отпуска и перерывы сохранятся.',
    ok: 'Применить',
  });
  if (!ok) return;
  emps().forEach(e => { e.schedule = JSON.parse(JSON.stringify(c.hours)); });
  emit(); window.__ch.s.close(); toast('График применён ко всем');
});

on('set.reminders', () => {
  sheet({
    title: 'Напоминания',
    body: `<div class="stack s">
      ${['За 24 часа до визита', 'За 2 часа до визита', 'После визита — просьба об отзыве', 'Мастеру — сводка на день'].map((t, i) => `
        <div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('bell', 18)}</div>
          <div class="grow"><div class="tl" style="font-size:13.5px">${t}</div></div>
          <button class="sw ${i < 3 ? 'on' : ''}" data-a="rm.t"></button></div>`).join('')}
    </div>
    <div class="tiny dim" style="margin-top:10px">Напоминания за 24 часа и за 2 часа бот отправляет сам. Проверить очередь можно в самом боте — «Очередь напоминаний».</div>`,
    footer: `<button class="btn p" data-a="rm.test">${icon('send', 17)}Отправить тестовое</button>`,
  });
});
on('rm.t', (ds, el) => el.classList.toggle('on'));
on('rm.test', () => demoNote('Напоминания',
  'Бот действительно шлёт напоминания за 24 часа и за 2 часа — но только по записям, сделанным в чате бота: у него своя база. Записи из приложения живут в браузере этого устройства и до бота не доходят.',
  'Очередь напоминаний видна в боте: меню бизнеса → «Очередь напоминаний». Как выглядит напоминание мастеру с AI-шпаргалкой — в демо-панели.'));
on('set.ai', () => {
  const s = sheet({
    title: 'AI-помощник',
    body: `<div class="stack s">
      <button class="role ${S.aiMode === 'demo' ? 'on' : ''}" style="width:100%" data-a="ai.mode" data-v="demo">
        <div class="t">DEMO</div><div class="s">Работает без API-ключа, использует данные вашей демо-базы</div></button>
      <button class="role ${S.aiMode === 'live' ? 'on' : ''}" style="width:100%" data-a="ai.mode" data-v="live">
        <div class="t">LIVE</div><div class="s">Реальные ответы модели по API-ключу</div></button>
    </div>
    <div class="field" style="margin-top:14px"><label>API-ключ (хранится в браузере)</label>
      <input class="inp" id="_k" placeholder="sk-ant-…" value="${esc(localStorage.getItem('zapis.ai.key') || '')}"></div>`,
    footer: `<button class="btn p" data-a="ai.saveKey">Сохранить</button>`,
  });
  window.__ai = s;
});
on('ai.mode', ds => { S.aiMode = ds.v; emit(); window.__ai.el.querySelectorAll('.role').forEach(r => r.classList.toggle('on', r.dataset.v === ds.v)); });
on('ai.saveKey', () => {
  const k = window.__ai.el.querySelector('#_k').value.trim();
  if (k) localStorage.setItem('zapis.ai.key', k); else localStorage.removeItem('zapis.ai.key');
  window.__ai.close(); toast('Настройки AI сохранены');
});
// скрытый вход в Super Admin: 5 быстрых нажатий по строке версии
let tapCount = 0, tapTimer = null;
on('set.secret', async () => {
  tapCount++;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => { tapCount = 0; }, 1200);
  if (tapCount < 5) return;
  tapCount = 0;
  const cfg = await import('../config.js');
  const dev = await import('../dev.js');
  if (cfg.adminAllowed((await import('../tg.js')).tgUser())) { dev.switchRole('admin'); toast('Super Admin'); return; }
  dev.askAdminCode();
});

on('set.reset', async () => {
  const ok = await confirmSheet({ title: 'Сбросить демо?', text: 'Все изменения исчезнут, вернутся исходные данные.', ok: 'Сбросить', danger: true });
  if (!ok) return;
  const { reset } = await import('../store.js');
  reset(); toast('Демо сброшено'); go('o.home', {}, { root: true });
});
