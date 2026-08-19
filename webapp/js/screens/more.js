import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appts, apptTitle, apptColor, now, today,
  rangeStats, todayStats, dayAppts, clientStats, updateService, deleteService, createService,
  updateEmployee, removeEmployee, createEmployee, addMoney, setPlan, blocks, removeBlock, addBroadcast,
  broadcasts, reviews, lostClients, emit, toHM, toMin, nextFreeFor, workDay,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, relPast, avatar, emptyState, sheet, toast, promptSheet,
  confirmSheet, demoNote, segmented, bars, sparkline, donut, progress, nMin, nAppt, nVisit, dayKey, startOfDay,
  addDays, WD, WD_FULL, MONTHS, num, plural, wait, loadingBlock,
} from '../ui.js';
import { icon, catIcon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { newApptFlow, addServiceSheet, blockFlow, openApptSheet, absenceFlow } from '../flows.js';
import { haptic, copy } from '../tg.js';

const rr = () => render(false);

/* =========================================================
   Ещё
   ========================================================= */
// цвета плиток — только hex: из них считается полупрозрачная подложка иконки
const TILES = [
  ['o.services', 'briefcase', 'Услуги', 'Цены и длительность', '#4C6FFF'],
  ['o.team', 'users', 'Команда', 'Мастера и графики', '#12B76A'],
  ['ai.home', 'sparkles', 'AI-помощник', 'Анализ и тексты', '#8B5CF6'],
  ['o.finance', 'wallet', 'Финансы', 'Доходы и расходы', '#F79009'],
  ['o.broadcasts', 'megaphone', 'Рассылки', 'Вернуть клиентов', '#EC4899'],
  ['o.analytics', 'chart', 'Аналитика', 'Что растёт, что падает', '#0EA5E9'],
  ['o.subscription', 'crown', 'Подписка', 'Тариф и оплата', '#F5A524'],
  ['o.settings', 'gear', 'Настройки', 'Компания и профиль', '#7C8AA5'],
];

route('o.more', {
  tab: 'o.more',
  render() {
    const c = co();
    const days = Math.ceil((new Date(c.planUntil) - now()) / 86400000);
    return `
    <div class="top"><div class="grow"><div class="top-t">Ещё</div><div class="top-sub">${esc(c.name)}</div></div></div>
    <div class="mgrid">
      ${TILES.map(t => `<button class="mcard" data-a="nav" data-r="${t[0]}">
        <div class="ic" style="background:${t[4]}1f;color:${t[4]}">${icon(t[1], 21)}</div>
        <div class="t">${t[2]}</div><div class="s">${t[3]}</div>
      </button>`).join('')}
    </div>
    <div class="wrap sec">
      <button class="card press" style="width:100%;padding:15px;display:flex;gap:12px;align-items:center;text-align:left" data-a="nav" data-r="o.subscription">
        <div class="tint" style="background:${days < 10 ? 'var(--dan-soft);color:var(--dan)' : 'var(--warn-soft);color:var(--warn)'};width:42px;height:42px">${icon('crown', 20)}</div>
        <div class="grow"><div class="b">Тариф ${esc(c.plan)}</div>
          <div class="sm ${days < 10 ? '' : 'muted'}" style="${days < 10 ? 'color:var(--dan)' : ''}">${days > 0 ? 'осталось ' + days + ' ' + plural(days, ['день', 'дня', 'дней']) : 'подписка истекла'}</div></div>
        <span class="bdg ${days < 10 ? 'dan' : 'ok'}">${days > 0 ? 'активен' : 'истёк'}</span>
      </button>
    </div>
    <div class="wrap sec">
      <button class="btn gh" data-a="o.share">${icon('share', 18)}Поделиться страницей записи</button>
    </div>`;
  },
});

/* =========================================================
   Услуги
   ========================================================= */
const CATN = { nails: 'Ногти', hair: 'Волосы', brow: 'Брови и ресницы', bar: 'Барбер', spa: 'Спа' };

route('o.services', {
  tab: 'o.more',
  fab: () => `<button class="fab" data-a="qa.svc">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = svcs();
    const byCat = {};
    list.forEach(s => (byCat[s.cat] = byCat[s.cat] || []).push(s));
    const s30 = rangeStats(30);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Услуги</div><div class="top-sub">${list.length} активных</div></div></div>
    ${!list.length ? emptyState({ ic: 'briefcase', title: 'Нет услуг', text: 'Добавьте первую услугу — она сразу появится на странице записи.', action: 'Добавить услугу', act: 'qa.svc' })
        : Object.keys(byCat).map(cat => `
      <div class="sec">
        <div class="sec-h"><div class="sec-t" style="font-size:13px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em">${CATN[cat] || 'Другое'}</div></div>
        <div class="wrap stack s">
          ${byCat[cat].map(s => {
          const stat = s30.byService.find(x => x.name === s.name);
          return `<button class="svc press" style="width:100%" data-a="sv.open" data-id="${s.id}">
              <div class="tint" style="background:${s.color}1f;color:${s.color}">${catIcon(s.cat, 18)}</div>
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

on('sv.open', ds => {
  const s = svc(ds.id);
  const st = { emps: s.employeeIds.slice() };
  const sh = sheet({
    title: s.name,
    body: `
      <div class="inp-row">
        <div class="field"><label>Цена, ₸</label><input class="inp" id="_p" inputmode="numeric" value="${s.price}"></div>
        <div class="field"><label>Время, мин</label><input class="inp" id="_d" inputmode="numeric" value="${s.duration}"></div>
      </div>
      <div class="field"><label>Название</label><input class="inp" id="_n" value="${esc(s.name)}"></div>
      <div class="field"><label>Кто выполняет</label>
        <div class="pick">${staff().map(e => `<button class="o ${st.emps.includes(e.id) ? 'on' : ''}" data-a="sv.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}</div></div>
      <div class="hr"></div>
      <div class="tiny muted b" style="margin-bottom:8px">ДОПОЛНИТЕЛЬНО</div>
      <div class="field"><label>Описание</label><textarea class="inp" id="_desc" placeholder="Коротко о услуге для клиентов">${esc(s.desc || '')}</textarea></div>
      <div class="field"><label>Буфер после услуги</label>
        <div class="pick">${[0, 5, 10, 15, 30].map(b => `<button class="o ${(s.buffer || 0) === b ? 'on' : ''}" data-a="sv.buf" data-b="${b}">${b ? b + ' мин' : 'нет'}</button>`).join('')}</div></div>`,
    footer: `<div class="btns"><button class="btn dan" data-a="sv.del" data-id="${s.id}">Удалить</button><button class="btn p" data-a="sv.save" data-id="${s.id}">Сохранить</button></div>`,
  });
  window.__sv = { sh, st, buf: s.buffer || 0 };
  on('sv.emp', (d2, el) => {
    const i = st.emps.indexOf(d2.id);
    if (i >= 0) st.emps.splice(i, 1); else st.emps.push(d2.id);
    el.classList.toggle('on', st.emps.includes(d2.id));
  });
  on('sv.buf', (d2, el) => {
    window.__sv.buf = +d2.b;
    sh.el.querySelectorAll('[data-a="sv.buf"]').forEach(o => o.classList.toggle('on', +o.dataset.b === +d2.b));
  });
});
on('sv.save', ds => {
  const { sh, st, buf } = window.__sv;
  updateService(ds.id, {
    name: sh.el.querySelector('#_n').value.trim(),
    price: +sh.el.querySelector('#_p').value || 0,
    duration: +sh.el.querySelector('#_d').value || 30,
    desc: sh.el.querySelector('#_desc').value.trim(),
    buffer: buf, employeeIds: st.emps,
  });
  sh.close(); toast('Услуга сохранена');
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
  tab: 'o.team',
  fab: () => `<button class="fab" data-a="tm.add">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = emps();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Команда</div><div class="top-sub">${list.length} ${plural(list.length, ['человек', 'человека', 'человек'])}</div></div></div>
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
      <div class="tiny dim">График и услуги можно настроить сразу после добавления.</div>`,
    footer: `<button class="btn p" data-a="tm.ok">Добавить сотрудника</button>`,
  });
  window.__tm = { s, role: 'Мастер маникюра', st };
  on('tm.role', (ds, el) => { window.__tm.role = ds.r; s.el.querySelectorAll('[data-a="tm.role"]').forEach(o => o.classList.toggle('on', o === el)); });
  on('tm.ok', () => {
    const n = s.el.querySelector('#_n').value.trim();
    if (!n) { toast('Введите имя', 'dan'); return; }
    const e = createEmployee({ name: n, role: window.__tm.role, phone: s.el.querySelector('#_p').value.trim() });
    s.close(); toast('Сотрудник добавлен'); go('o.employee', { id: e.id });
  });
  setTimeout(() => s.el.querySelector('#_n').focus(), 250);
});

route('o.employee', {
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
      <div class="row" style="justify-content:center;gap:6px;margin-top:8px">
        <span class="bdg ${w ? 'ok' : ''}">${w ? 'сегодня ' + w.from + '–' + w.to : 'выходной'}</span>
        ${e.rating ? `<span class="bdg warn">${icon('star', 11, 2.4)} ${e.rating}</span>` : ''}
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
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="emp.cal" data-id="${e.id}">
        <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('clock', 19)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Записи</div><div class="st">Календарь мастера</div></div>${icon('fwd', 18)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="emp.access" data-id="${e.id}">
        <div class="ic" style="background:var(--sf-3)">${icon('lock', 19)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Доступ</div><div class="st">${e.access === 'owner' ? 'Владелец' : e.access === 'manager' ? 'Администратор' : 'Сотрудник'}</div></div>${icon('fwd', 18)}</button>
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

on('emp.cal', ds => { go('o.cal'); setTimeout(() => { const b = document.querySelector(`[data-a="cal.emp"][data-id="${ds.id}"]`); if (b) b.click(); }, 60); });
on('emp.edit', ds => {
  const e = emp(ds.id);
  const s = sheet({
    title: 'Сотрудник',
    body: `<div class="field"><label>Имя</label><input class="inp" id="_n" value="${esc(e.name)}"></div>
      <div class="field"><label>Должность</label><input class="inp" id="_r" value="${esc(e.role)}"></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" value="${esc(e.phone || '')}"></div>
      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
        <div class="grow"><div class="tl">Принимает записи</div><div class="st">Появляется при онлайн-записи</div></div>
        <button class="sw ${e.takesAppointments ? 'on' : ''}" data-a="emp.takes" data-id="${e.id}"></button></div>`,
    footer: `<button class="btn p" data-a="emp.save" data-id="${e.id}">Сохранить</button>`,
  });
  window.__em = s;
});
on('emp.takes', (ds, el) => { const e = emp(ds.id); updateEmployee(ds.id, { takesAppointments: !e.takesAppointments }); el.classList.toggle('on', emp(ds.id).takesAppointments); });
on('emp.save', ds => {
  const s = window.__em;
  updateEmployee(ds.id, { name: s.el.querySelector('#_n').value.trim(), role: s.el.querySelector('#_r').value.trim(), phone: s.el.querySelector('#_p').value.trim() });
  s.close(); toast('Сохранено');
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
  const LV = [['staff', 'Сотрудник', 'Видит только свои записи и клиентов'], ['manager', 'Администратор', 'Видит всё расписание и клиентов'], ['owner', 'Владелец', 'Полный доступ, включая финансы']];
  const s = sheet({
    title: 'Уровень доступа',
    body: `<div class="stack s">${LV.map(l => `
      <button class="role ${e.access === l[0] ? 'on' : ''}" data-a="ac.set" data-id="${e.id}" data-v="${l[0]}" style="width:100%">
        <div class="t">${l[1]}</div><div class="s">${l[2]}</div></button>`).join('')}</div>`,
  });
  window.__ac = s;
});
on('ac.set', ds => { updateEmployee(ds.id, { access: ds.v }); window.__ac.close(); toast('Доступ обновлён'); });

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
   Финансы
   ========================================================= */
const fin = { period: 30 };
route('o.finance', {
  tab: 'o.more',
  render() {
    const s = rangeStats(fin.period);
    const ops = operations(fin.period);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Финансы</div><div class="top-sub">за ${fin.period} дней</div></div></div>
    <div class="wrap" style="margin-bottom:14px">${segmented('fin.p', [{ v: 7, t: '7 дней' }, { v: 30, t: '30 дней' }, { v: 90, t: '90 дней' }], fin.period)}</div>

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

    <div class="wrap sec"><div class="btns">
      <button class="btn ok" data-a="fin.add" data-t="income">${icon('plus', 18)}Доход</button>
      <button class="btn" data-a="fin.add" data-t="expense">${icon('minus', 18)}Расход</button>
    </div></div>

    <div class="wrap sec">
      <div class="card pad">
        <div class="row between" style="margin-bottom:10px"><div class="b sm">Динамика выручки</div><div class="tiny dim">${fin.period} дн.</div></div>
        ${sparkline(s.series.length > 30 ? aggregate(s.series, 15) : s.series, { h: 96 })}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Операции</div><div class="tiny dim">${ops.length}</div></div>
      <div class="wrap stack s">
        ${ops.slice(0, 30).map(o => `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
          <div class="ic" style="background:${o.type === 'income' ? 'var(--ok-soft);color:var(--ok)' : 'var(--dan-soft);color:var(--dan)'}">${icon(o.type === 'income' ? 'trendUp' : 'trendDown', 18)}</div>
          <div class="grow"><div class="tl">${esc(o.cat)}</div><div class="st">${dateLabel(new Date(o.date), now())}${o.note ? ' · ' + esc(o.note) : ''}</div></div>
          <div class="b sm" style="color:${o.type === 'income' ? 'var(--ok)' : 'var(--dan)'}">${o.type === 'income' ? '+' : '−'}${moneyShort(o.amount)} ₸</div>
        </div>`).join('') || `<div class="card pad center sm muted">Операций нет</div>`}
      </div>
    </div>`;
  },
});
function aggregate(arr, n) {
  const size = Math.ceil(arr.length / n), out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size).reduce((a, b) => a + b, 0));
  return out;
}
function operations(days) {
  const from = new Date(startOfDay(now()).getTime() - (days - 1) * 86400000);
  const out = [];
  appts().filter(a => a.status === 'done' && new Date(a.start) >= from).forEach(a => {
    const c = client(a.clientId);
    out.push({ type: 'income', amount: a.price, cat: apptTitle(a), note: c ? c.name : '', date: a.start });
  });
  S.data.incomes.filter(i => i.companyId === cid() && new Date(i.date) >= from).forEach(i => out.push(i));
  S.data.expenses.filter(i => i.companyId === cid() && new Date(i.date) >= from).forEach(i => out.push(i));
  return out.sort((a, b) => new Date(b.date) - new Date(a.date));
}
on('fin.p', ds => { fin.period = +ds.v; rr(); });
on('fin.add', ds => {
  const isInc = ds.t === 'income';
  const CATS = isInc ? ['Продажа товара', 'Сертификат', 'Прочее'] : ['Аренда', 'Материалы', 'Зарплата', 'Реклама', 'Коммунальные', 'Прочее'];
  const st = { cat: CATS[0] };
  const s = sheet({
    title: isInc ? 'Новый доход' : 'Новый расход',
    body: `<div class="field"><label>Сумма, ₸</label><input class="inp" id="_a" inputmode="numeric" placeholder="0"></div>
      <div class="field"><label>Категория</label><div class="pick">${CATS.map((c, i) => `<button class="o ${i === 0 ? 'on' : ''}" data-a="fa.cat" data-c="${esc(c)}">${c}</button>`).join('')}</div></div>
      <div class="field"><label>Комментарий</label><input class="inp" id="_n" placeholder="Необязательно"></div>`,
    footer: `<button class="btn ${isInc ? 'ok' : 'p'}" data-a="fa.ok" data-t="${ds.t}">Добавить</button>`,
  });
  window.__fa = { s, st };
  on('fa.cat', (d2, el) => { st.cat = d2.c; s.el.querySelectorAll('[data-a="fa.cat"]').forEach(o => o.classList.toggle('on', o === el)); });
  on('fa.ok', d2 => {
    const a = +s.el.querySelector('#_a').value;
    if (!a) { toast('Введите сумму', 'dan'); return; }
    addMoney({ type: d2.t, amount: a, cat: st.cat, note: s.el.querySelector('#_n').value.trim() });
    s.close(); toast(d2.t === 'income' ? 'Доход добавлен' : 'Расход добавлен');
  });
  setTimeout(() => s.el.querySelector('#_a').focus(), 250);
});

/* =========================================================
   Аналитика
   ========================================================= */
const an = { period: 30 };
route('o.analytics', {
  tab: 'o.more',
  render() {
    const s = rangeStats(an.period);
    const series = s.series.length > 14 ? aggregate(s.series, 14) : s.series;
    const labels = s.series.length > 14 ? [] : s.labels;
    const maxSvc = Math.max(1, ...s.byService.map(x => x.count));
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Аналитика</div><div class="top-sub">за ${an.period} дней</div></div></div>
    <div class="wrap" style="margin-bottom:14px">${segmented('an.p', [{ v: 7, t: '7 дней' }, { v: 30, t: '30 дней' }, { v: 90, t: '90 дней' }], an.period)}</div>

    <div class="wrap">
      <div class="card pad">
        <div class="row between"><div>
          <div class="tiny muted b">ВЫРУЧКА</div>
          <div style="font-size:26px;font-weight:780;letter-spacing:-.03em;margin-top:2px">${money(s.revenue)}</div>
        </div>
        <span class="bdg ${s.deltaRev >= 0 ? 'ok' : 'dan'}">${s.deltaRev >= 0 ? '↑' : '↓'} ${Math.abs(s.deltaRev)}%</span></div>
        <div style="margin-top:12px">${bars(series, { labels: labels.length <= 14 ? labels : [], height: 110 })}</div>
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
on('an.p', ds => { an.period = +ds.v; rr(); });

/* =========================================================
   Рассылки
   ========================================================= */
route('o.broadcasts', {
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
const PLANS = [
  { id: 'START', price: 9900, feats: ['1 сотрудник', 'Онлайн-запись', 'База клиентов', 'Напоминания'] },
  { id: 'PRO', price: 19900, feats: ['До 10 сотрудников', 'AI-помощник', 'Рассылки', 'Аналитика и финансы'] },
  { id: 'BUSINESS', price: 39900, feats: ['Без ограничений', 'Несколько филиалов', 'API и интеграции', 'Приоритетная поддержка'] },
];
route('o.subscription', {
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
        ${PLANS.map(p => `<div class="card pad" style="${p.id === c.plan ? 'border-color:var(--p);box-shadow:0 0 0 1px var(--p)' : ''}">
          <div class="row between" style="margin-bottom:8px">
            <div><div class="b" style="font-size:17px">${p.id}</div>
              <div class="tiny muted">${money(p.price)} / месяц</div></div>
            ${p.id === c.plan ? '<span class="bdg p">текущий</span>' : `<button class="btn xs p" data-a="sub.switch" data-p="${p.id}">Выбрать</button>`}
          </div>
          <div class="stack" style="gap:5px">${p.feats.map(f => `<div class="row sm" style="gap:7px;color:var(--tx-2)"><span style="color:var(--ok)">${icon('check', 14, 2.6)}</span>${f}</div>`).join('')}</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="wrap sec"><div class="tiny dim center">Оплата в демо-режиме симулируется. В продакшене — Telegram Payments или Kaspi.</div></div>`;
  },
});
on('sub.pay', async ds => {
  const s = sheet({ title: 'Оплата', body: loadingBlock('Проводим платёж…') });
  await wait(1500);
  setPlan(cid(), co().plan, 30);
  s.close(); toast('Подписка продлена на 30 дней');
});
on('sub.switch', async ds => {
  const p = PLANS.find(x => x.id === ds.p);
  const ok = await confirmSheet({ title: 'Перейти на ' + p.id + '?', text: money(p.price) + ' в месяц. Спишем сразу после подтверждения.', ok: 'Перейти' });
  if (!ok) return;
  const s = sheet({ title: 'Оплата', body: loadingBlock('Проводим платёж…') });
  await wait(1400);
  setPlan(cid(), p.id, 30);
  s.close(); toast('Тариф изменён на ' + p.id);
});

/* =========================================================
   Настройки
   ========================================================= */
route('o.settings', {
  tab: 'o.more',
  render() {
    const c = co();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Настройки</div></div></div>

    <div class="wrap sec" style="margin-top:4px">
      <div class="card pad row" style="gap:14px">
        <div class="av l av-sq" style="background:${c.color === '#0D1220' ? 'var(--tx)' : c.color}">${esc(c.initials)}</div>
        <div class="grow"><div class="b" style="font-size:16px">${esc(c.name)}</div>
          <div class="sm muted">${esc(c.cat)} · ${esc(c.city)}</div></div>
        <button class="ico-btn" data-a="set.company">${icon('pencil', 17)}</button>
      </div>
    </div>

    <div class="wrap sec"><div class="stack s">
      ${row('clock', 'Часы работы', 'Когда принимаете клиентов', 'set.hours')}
      ${row('link', 'Страница записи', 't.me/' + c.tgLink, 'o.share')}
      ${row('bell', 'Напоминания', 'За 24 часа и за 2 часа', 'set.reminders')}
      ${row('sparkles', 'AI-помощник', S.aiMode === 'live' ? 'Режим LIVE' : 'Режим DEMO', 'set.ai')}
    </div></div>

    <div class="wrap sec"><div class="stack s">
      <div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
        <div class="ic">${icon(document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun', 18)}</div>
        <div class="grow"><div class="tl">Оформление</div><div class="st">${S.theme === 'auto' ? 'Как в Telegram' : S.theme === 'dark' ? 'Тёмное' : 'Светлое'}</div></div>
        <div class="seg" style="width:150px">
          ${[['auto', 'Авто'], ['light', 'Свет'], ['dark', 'Тьма']].map(t => `<button class="${S.theme === t[0] ? 'on' : ''}" data-a="set.theme" data-v="${t[0]}">${t[1]}</button>`).join('')}
        </div>
      </div>
    </div></div>

    <div class="wrap sec"><div class="stack s">
      ${row('shield', 'Демо-режим', 'Роли, компании, машина времени', 'dev.open')}
      ${row('refresh', 'Сбросить демо-данные', 'Вернуть исходное состояние', 'set.reset')}
    </div></div>

    <div class="wrap sec"><div class="center tiny dim" data-a="set.secret" style="padding:10px;user-select:none">Zapis · демо-версия 2.0<br>Все данные хранятся только на вашем устройстве</div></div>`;
  },
});
const row = (ic, t, s, a, extra = '') => `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="${a}" ${extra}>
  <div class="ic">${icon(ic, 18)}</div>
  <div class="grow" style="text-align:left"><div class="tl">${t}</div><div class="st">${s}</div></div>
  <span class="chev">${icon('fwd', 17, 2)}</span></button>`;

on('set.theme', async ds => { S.theme = ds.v; const m = await import('../main.js'); m.applyTheme(); emit(); });
on('set.company', () => {
  const c = co();
  const s = sheet({
    title: 'О компании',
    body: `<div class="field"><label>Название</label><input class="inp" id="_n" value="${esc(c.name)}"></div>
      <div class="field"><label>Категория</label><input class="inp" id="_c" value="${esc(c.cat)}"></div>
      <div class="field"><label>Адрес</label><input class="inp" id="_a" value="${esc(c.addr)}"></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" value="${esc(c.phone)}"></div>
      <div class="field"><label>Описание</label><textarea class="inp" id="_d">${esc(c.about || '')}</textarea></div>`,
    footer: `<button class="btn p" data-a="set.companySave">Сохранить</button>`,
  });
  window.__sc = s;
});
on('set.companySave', () => {
  const s = window.__sc, c = co();
  c.name = s.el.querySelector('#_n').value.trim() || c.name;
  c.cat = s.el.querySelector('#_c').value.trim();
  c.addr = s.el.querySelector('#_a').value.trim();
  c.phone = s.el.querySelector('#_p').value.trim();
  c.about = s.el.querySelector('#_d').value.trim();
  c.initials = c.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  emit(); s.close(); toast('Сохранено');
});
on('set.hours', () => {
  const c = co();
  const s = sheet({
    title: 'Часы работы',
    body: `<div class="stack s">${[1, 2, 3, 4, 5, 6, 0].map(d => {
      const w = c.hours[d];
      return `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
        <div class="grow"><div class="tl" style="text-transform:capitalize">${WD_FULL[d]}</div>
          <div class="st">${w.on ? w.from + ' — ' + w.to : 'Выходной'}</div></div>
        <button class="sw ${w.on ? 'on' : ''}" data-a="ch.day" data-d="${d}"></button></div>`;
    }).join('')}</div>
    <div class="tiny dim" style="margin-top:10px">Это общие часы салона. Индивидуальный график мастера — в его карточке.</div>`,
    footer: `<button class="btn gh" data-a="ch.apply">Применить ко всем мастерам</button>`,
  });
  window.__ch = s;
});
on('ch.day', (ds, el) => { const c = co(); c.hours[ds.d].on = !c.hours[ds.d].on; el.classList.toggle('on', c.hours[ds.d].on); emit(); });
on('ch.apply', () => {
  const c = co();
  emps().forEach(e => { e.schedule = JSON.parse(JSON.stringify(c.hours)); });
  emit(); window.__ch.close(); toast('График применён ко всем');
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
    <div class="tiny dim" style="margin-top:10px">В демо напоминания можно отправить вручную из панели разработчика.</div>`,
    footer: `<button class="btn p" data-a="rm.test">${icon('send', 17)}Отправить тестовое</button>`,
  });
});
on('rm.t', (ds, el) => el.classList.toggle('on'));
on('rm.test', () => demoNote('Напоминания', 'В демо напоминания не отправляются в Telegram. Посмотреть, как выглядит напоминание мастеру с AI-шпаргалкой, можно в демо-панели — кнопка «Тестовое напоминание».', 'В рабочей версии их шлёт бот за 24 часа и за 2 часа до визита.'));
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
