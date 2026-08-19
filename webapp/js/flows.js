// Общие сценарии: карточка записи, создание записи, блокировка времени,
// добавление клиента/услуги, голосовая AI-заметка.
import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor, apptEnd,
  now, today, slotsFor, slotFree, toMin, toHM, createAppointment, cancelAppointment, completeAppointment,
  moveAppointment, createClient, createService, addBlock, addAbsence, ABSENCE, clientStats, updateClient,
  nextFreeFor, workDay,
} from './store.js';
import {
  sheet, toast, confirmSheet, esc, money, hhmm, dateLabel, dateFull, nMin, avatar, WD, dayKey,
  startOfDay, addDays, emptyState, promptSheet, wait, loadingBlock, relPast, plural, monthGrid,
} from './ui.js';
import { icon, catIcon } from './icons.js';
import { on } from './bus.js';
import { go } from './router.js';
import { haptic, openLink, copy } from './tg.js';
import { parseNote, demoVoice } from './ai-engine.js';

/* =========================================================
   Карточка записи
   ========================================================= */
export function openApptSheet(id) {
  const a = appt(id); if (!a) return;
  const c = client(a.clientId), e = emp(a.employeeId);
  const st = new Date(a.start), en = apptEnd(a);
  const isPast = en < now();
  const S_ = { planned: ['p', 'Запланирована'], done: ['ok', 'Выполнена'], cancelled: ['dan', 'Отменена'] }[a.status];
  const ai = c && c.ai;

  const body = `
    <div class="row" style="gap:14px;margin-bottom:14px">
      ${avatar(c, 'l')}
      <div class="grow">
        <div style="font-size:19px;font-weight:750;letter-spacing:-.02em">${esc(c ? c.name : 'Клиент')}</div>
        <div class="sm muted">${esc(c && c.phone || '')}</div>
      </div>
      <span class="bdg ${S_[0]}">${S_[1]}</span>
    </div>

    <div class="card flat" style="padding:14px;margin-bottom:12px">
      <div class="row between"><span class="sm muted">Когда</span><b>${dateLabel(st, now())}, ${hhmm(st)}–${hhmm(en)}</b></div>
      <div class="hr"></div>
      <div class="row between" style="align-items:flex-start"><span class="sm muted" style="flex:none">Услуга</span><b style="max-width:64%;text-align:right;line-height:1.3">${esc(apptTitle(a))}</b></div>
      <div class="hr"></div>
      <div class="row between"><span class="sm muted">Мастер</span><b>${esc(e ? e.name : '—')}</b></div>
      <div class="hr"></div>
      <div class="row between"><span class="sm muted">Стоимость</span><b style="font-size:17px">${money(a.price)}</b></div>
    </div>

    ${a.note ? `<div class="card flat" style="padding:12px 14px;margin-bottom:12px">
      <div class="tiny muted b" style="margin-bottom:3px">Заметка к записи</div>
      <div class="sm">${esc(a.note)}</div></div>` : ''}

    ${ai && (ai.prefs.length || ai.care.length || ai.next.length) ? `
    <div class="card" style="padding:13px 14px;margin-bottom:12px;border-color:var(--ai-soft);background:var(--ai-soft)">
      <div class="row" style="gap:7px;margin-bottom:6px;color:var(--ai)">${icon('sparkles', 16)}<b class="sm">AI-шпаргалка по клиенту</b></div>
      <div class="sm" style="line-height:1.6">
        ${ai.prefs.map(x => '• ' + esc(x)).join('<br>')}
        ${ai.care.length ? (ai.prefs.length ? '<br>' : '') + ai.care.map(x => '• ' + esc(x)).join('<br>') : ''}
        ${ai.next.length ? '<br>' + ai.next.map(x => '• ' + esc(x)).join('<br>') : ''}
      </div>
    </div>` : ''}

    <div class="acts" style="margin-bottom:6px">
      <button class="act" data-a="ap.call" data-id="${a.id}">${icon('phone', 20)}Позвонить</button>
      <button class="act" data-a="ap.msg" data-id="${a.id}">${icon('msg', 20)}Написать</button>
      <button class="act" data-a="ap.open" data-id="${a.id}">${icon('user', 20)}Клиент</button>
      ${a.status !== 'cancelled' ? `<button class="act" data-a="ap.cancel" data-id="${a.id}" style="color:var(--dan)">${icon('xCircle', 20)}Отменить</button>` : ''}
    </div>`;

  const footer = a.status === 'planned'
    ? `<div class="btns">
         <button class="btn gh" data-a="ap.move" data-id="${a.id}">${icon('history', 18)}Перенести</button>
         <button class="btn ${isPast ? 'ok' : 'p'}" data-a="ap.done" data-id="${a.id}">${icon('check', 18)}Завершить</button>
       </div>`
    : a.status === 'done'
      ? `<div class="btns">
           <button class="btn gh" data-a="ap.voice" data-id="${a.id}">${icon('mic', 18)}Заметка</button>
           <button class="btn p" data-a="ap.repeat" data-id="${a.id}">${icon('refresh', 18)}Повторить</button>
         </div>`
      : `<button class="btn p" data-a="ap.repeat" data-id="${a.id}">${icon('refresh', 18)}Записать снова</button>`;

  const s = sheet({ title: 'Запись', body, footer });
  s.el.dataset.apptSheet = a.id;
  return s;
}

function closeApptSheet() {
  const el = document.querySelector('[data-appt-sheet]');
  if (el && el._api) el._api.close();
}

on('ap.open', ds => { const a = appt(ds.id); document.querySelectorAll('.sheet').forEach(s => s.querySelector('[data-sheet-close]').click()); if (a) go('o.client', { id: a.clientId }); });
on('ap.call', ds => { const a = appt(ds.id), c = client(a.clientId); if (c && c.phone) openLink('tel:' + c.phone.replace(/\s/g, '')); else toast('Нет номера', 'dan'); });
on('ap.msg', ds => { const a = appt(ds.id), c = client(a.clientId); openLink('https://t.me/' + String(c && c.tg || '').replace('@', '')); });

on('ap.done', async ds => {
  completeAppointment(ds.id);
  document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click());
  await wait(320);
  toast('Запись выполнена');
  const a = appt(ds.id);
  const ok = await confirmSheet({
    title: 'Добавить заметку о клиенте?',
    text: 'Надиктуйте пару слов — AI сам разложит их по полочкам в карточке клиента.',
    ok: 'Записать голосом', cancel: 'Позже',
  });
  if (ok) voiceNoteSheet(a.clientId);
});

on('ap.cancel', async ds => {
  const ok = await confirmSheet({ title: 'Отменить запись?', text: 'Слот снова станет свободным, клиент получит уведомление.', ok: 'Отменить запись', cancel: 'Оставить', danger: true });
  if (!ok) return;
  cancelAppointment(ds.id, S.session.role);
  document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click());
  toast('Запись отменена', 'dan');
});

on('ap.repeat', ds => {
  const a = appt(ds.id);
  document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click());
  setTimeout(() => newApptFlow({ clientId: a.clientId, serviceIds: a.serviceIds.slice(), employeeId: a.employeeId }), 300);
});

on('ap.voice', ds => { const a = appt(ds.id); document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click()); setTimeout(() => voiceNoteSheet(a.clientId), 300); });

on('ap.move', ds => moveFlow(ds.id));
on('ap.note', async ds => {
  const a = appt(ds.id);
  const v = await promptSheet({ title: 'Заметка к записи', label: 'Текст', value: a.note, multiline: true });
  if (v != null) { a.note = v; toast('Заметка сохранена'); }
});

/* =========================================================
   Перенос записи
   ========================================================= */
export function moveFlow(id) {
  const a = appt(id); if (!a) return;
  let date = startOfDay(new Date(a.start));
  if (date < today()) date = today();
  let pick = null;
  const s = sheet({ title: 'Перенести запись', body: '' });
  const draw = () => {
    const slots = slotsFor([a.employeeId], date, a.duration, { ignoreId: a.id });
    s.set({
      title: 'Перенести запись',
      body: `
        <div class="sm muted" style="margin-bottom:12px">${esc(client(a.clientId).name)} · ${esc(apptTitle(a))} · ${nMin(a.duration)}</div>
        <div style="margin:0 -18px 14px">${dateStrip(date, 'mv.date', 14)}</div>
        ${slots.length ? `<div class="slots">${slots.map(x => `<button class="slot ${x.free ? '' : 'busy'} ${pick === x.min ? 'on' : ''}" data-a="mv.slot" data-m="${x.min}" data-f="${x.free ? 1 : 0}">${x.t}</button>`).join('')}</div>`
          : `<div class="empty" style="padding:24px"><div class="t" style="font-size:15px">Выходной</div><div class="s">У мастера в этот день нет рабочих часов</div></div>`}`,
      footer: `<button class="btn p" data-a="mv.ok" ${pick == null ? 'disabled' : ''}>Перенести${pick != null ? ' на ' + toHM(pick) : ''}</button>`,
    });
  };
  on('mv.date', ds => { date = new Date(+ds.d); pick = null; draw(); });
  on('mv.slot', ds => { if (ds.f !== '1') return; pick = +ds.m; haptic('select'); draw(); });
  on('mv.ok', () => {
    const d = new Date(date); d.setHours(Math.floor(pick / 60), pick % 60, 0, 0);
    moveAppointment(id, d, null);
    s.close(); toast('Запись перенесена на ' + dateLabel(d, now()).toLowerCase() + ', ' + toHM(pick));
  });
  draw();
}

/* =========================================================
   Быстрое добавление (FAB)
   ========================================================= */
export function quickAdd() {
  const items = [
    ['calendarPlus', 'Добавить запись', 'Клиент, услуга и время', 'qa.appt', '#4C6FFF'],
    ['lock', 'Заблокировать время', 'Перерыв, обед, личные дела', 'qa.block', '#F79009'],
    ['userPlus', 'Добавить клиента', 'В базу без записи', 'qa.client', '#12B76A'],
    ['briefcase', 'Добавить услугу', 'Название, цена, время', 'qa.svc', '#8B5CF6'],
  ];
  const s = sheet({
    title: 'Что добавим?',
    body: `<div class="stack s" style="padding-bottom:6px">${items.map(i => `
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd)" data-a="${i[3]}">
        <div class="ic" style="background:${i[4]}1f;color:${i[4]}">${icon(i[0], 20)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${i[1]}</div><div class="st">${i[2]}</div></div>
        ${icon('fwd', 18)}
      </button>`).join('')}</div>`,
  });
  window.__qa = s;
}
on('qa.appt', () => { window.__qa && window.__qa.close(); setTimeout(() => newApptFlow({}), 260); });
on('qa.block', () => { window.__qa && window.__qa.close(); setTimeout(() => blockFlow({}), 260); });
on('qa.client', () => { window.__qa && window.__qa.close(); setTimeout(() => addClientSheet(), 260); });
on('qa.svc', () => { window.__qa && window.__qa.close(); setTimeout(() => addServiceSheet(), 260); });
on('fab', () => quickAdd());

/* =========================================================
   Полоса дат
   ========================================================= */
export function dateStrip(selected, action, days = 14, from = null) {
  const base = from || today();
  const cells = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(base, i);
    const on = dayKey(d) === dayKey(selected);
    cells.push(`<button class="dcard ${on ? 'on' : ''}" data-a="${action}" data-d="${d.getTime()}">
      <div class="w">${WD[d.getDay()]}</div><div class="n">${d.getDate()}</div>
      <div class="m">${i === 0 ? 'сегодня' : ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()]}</div>
    </button>`);
  }
  return `<div class="hscroll">${cells.join('')}</div>`;
}

/* =========================================================
   Новая запись (мастер/владелец)
   ========================================================= */
export function newApptFlow(pre = {}) {
  const state = {
    step: pre.clientId ? (pre.serviceIds && pre.serviceIds.length ? 3 : 2) : 1,
    clientId: pre.clientId || null,
    serviceIds: pre.serviceIds ? pre.serviceIds.slice() : [],
    employeeId: pre.employeeId || null,
    date: pre.date ? startOfDay(pre.date) : today(),
    min: pre.startMin != null ? pre.startMin : null,
    q: '',
  };
  const s = sheet({ title: 'Новая запись', body: '' });
  window.__na = { s, state, draw: () => draw() };

  const duration = () => state.serviceIds.reduce((x, id) => x + ((svc(id) || {}).duration || 0), 0) || 60;
  const price = () => state.serviceIds.reduce((x, id) => x + ((svc(id) || {}).price || 0), 0);

  function stepClient() {
    const q = state.q.toLowerCase();
    const list = clients().filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      .map(c => ({ c, st: clientStats(c.id) }))
      .sort((a, b) => (b.st.last ? new Date(b.st.last.start) : 0) - (a.st.last ? new Date(a.st.last.start) : 0))
      .slice(0, 40);
    return {
      title: 'Кто придёт?',
      body: `
        <div class="search" style="margin-bottom:12px">${icon('search', 18)}<input id="_q" placeholder="Имя или телефон" value="${esc(state.q)}"></div>
        <button class="lrow press" style="border-radius:14px;border:1px dashed var(--bd-2);background:transparent;width:100%;margin-bottom:12px" data-a="na.new">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('userPlus', 19)}</div>
          <div class="grow" style="text-align:left"><div class="tl">Новый клиент</div><div class="st">Добавить в базу</div></div>
        </button>
        <div class="stack s">${list.map(({ c, st }) => `
          <button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="na.client" data-id="${c.id}">
            ${avatar(c, 's')}
            <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
              <div class="st">${st.visits ? st.visits + ' виз. · ' + (st.last ? relPast(new Date(st.last.start), now()) : '') : 'Новый клиент'}</div></div>
          </button>`).join('') || '<div class="empty"><div class="t">Не найдено</div></div>'}</div>`,
      mount: el => {
        const i = el.querySelector('#_q');
        if (i) i.oninput = e => { state.q = e.target.value; drawSoft(); };
      },
    };
  }

  function stepService() {
    const list = svcs().filter(x => !state.employeeId || x.employeeIds.includes(state.employeeId));
    const byCat = {};
    list.forEach(x => { (byCat[x.cat] = byCat[x.cat] || []).push(x); });
    return {
      title: 'Какая услуга?',
      back: () => { state.step = 1; draw(); },
      body: `<div class="stack s">${list.map(x => `
        <button class="svc press" style="width:100%" data-a="na.svc" data-id="${x.id}">
          <div class="tint" style="background:${x.color}1f;color:${x.color}">${catIcon(x.cat, 18)}</div>
          <div class="grow" style="text-align:left">
            <div class="b" style="font-size:14.5px">${esc(x.name)}</div>
            <div class="tiny muted">${nMin(x.duration)}</div>
          </div>
          <div class="pr">${money(x.price)}</div>
          ${state.serviceIds.includes(x.id) ? `<span style="color:var(--p)">${icon('checkCircle', 20)}</span>` : ''}
        </button>`).join('')}</div>`,
      footer: state.serviceIds.length ? `<button class="btn p" data-a="na.next3">Далее · ${money(price())} · ${nMin(duration())}</button>` : '',
    };
  }

  // если на выбранный день свободных слотов нет — сразу показываем ближайший рабочий день
  function ensureDate() {
    if (state._auto || pre.date || pre.startMin != null) return;
    state._auto = true;
    const cands = staff().filter(e => !state.serviceIds.length || state.serviceIds.every(id => (svc(id) || { employeeIds: [] }).employeeIds.includes(e.id)));
    const ids = state.employeeId ? [state.employeeId] : cands.map(e => e.id);
    for (let i = 0; i < 14; i++) {
      const d = addDays(today(), i);
      if (slotsFor(ids, d, duration()).some(x => x.free)) { state.date = d; return; }
    }
  }

  function stepTime() {
    ensureDate();
    const cands = staff().filter(e => !state.serviceIds.length || state.serviceIds.every(id => (svc(id) || { employeeIds: [] }).employeeIds.includes(e.id)));
    const empIds = state.employeeId ? [state.employeeId] : cands.map(e => e.id);
    const slots = slotsFor(empIds, state.date, duration());
    const cl = client(state.clientId);
    return {
      title: 'Когда?',
      back: () => { state.step = 2; draw(); },
      body: `
        <div class="row" style="gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--sf-2);border-radius:14px">
          ${avatar(cl, 's')}
          <div class="grow"><div class="b sm">${esc(cl ? cl.name : '')}</div>
          <div class="tiny muted nowrap">${esc(state.serviceIds.map(id => (svc(id) || {}).name).join(' + '))}</div></div>
          <div class="b sm">${money(price())}</div>
        </div>
        <div class="chips" style="padding-left:0;padding-right:0;margin-bottom:12px">
          <button class="chip p ${!state.employeeId ? 'on' : ''}" data-a="na.emp" data-id="">Любой мастер</button>
          ${cands.map(e => `<button class="chip p ${state.employeeId === e.id ? 'on' : ''}" data-a="na.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}
        </div>
        <div style="margin:0 -18px 14px">${dateStrip(state.date, 'na.date', 14)}</div>
        ${slots.length ? `<div class="slots">${slots.map(x => `<button class="slot ${x.free ? '' : 'busy'} ${state.min === x.min ? 'on' : ''}" data-a="na.slot" data-m="${x.min}" data-f="${x.free ? 1 : 0}" data-e="${x.empId || ''}">${x.t}</button>`).join('')}</div>`
          : `<div class="empty" style="padding:22px"><div class="t" style="font-size:15px">Выходной день</div><div class="s">Выберите другую дату</div></div>`}`,
      footer: `<button class="btn p" data-a="na.create" ${state.min == null ? 'disabled' : ''}>
        ${state.min == null ? 'Выберите время' : 'Создать запись · ' + dateLabel(state.date, now()).toLowerCase() + ', ' + toHM(state.min)}</button>`,
    };
  }

  function draw() {
    const v = state.step === 1 ? stepClient() : state.step === 2 ? stepService() : stepTime();
    s.set(v);
  }
  function drawSoft() {
    // перерисовка списка клиентов без потери фокуса
    const b = s.el.querySelector('.sheet-b');
    const q = state.q.toLowerCase();
    const list = clients().filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)).slice(0, 40);
    const host = b.querySelector('.stack');
    if (host) host.innerHTML = list.map(c => {
      const st = clientStats(c.id);
      return `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="na.client" data-id="${c.id}">
        ${avatar(c, 's')}<div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
        <div class="st">${st.visits ? st.visits + ' виз.' : 'Новый клиент'}</div></div></button>`;
    }).join('') || '<div class="empty"><div class="t">Не найдено</div></div>';
  }

  on('na.client', ds => { state.clientId = ds.id; state.step = 2; draw(); });
  on('na.new', async () => {
    const v = await promptSheet({ title: 'Новый клиент', label: 'Имя', placeholder: 'Например, Алия' });
    if (!v) return;
    const c = createClient({ name: v });
    state.clientId = c.id; state.step = 2; draw(); toast('Клиент добавлен');
  });
  on('na.svc', ds => {
    const i = state.serviceIds.indexOf(ds.id);
    if (i >= 0) state.serviceIds.splice(i, 1); else state.serviceIds.push(ds.id);
    haptic('select'); draw();
  });
  on('na.next3', () => { state.step = 3; state.min = null; draw(); });
  on('na.emp', ds => { state.employeeId = ds.id || null; state.min = null; draw(); });
  on('na.date', ds => { state.date = new Date(+ds.d); state.min = null; draw(); });
  on('na.slot', ds => { if (ds.f !== '1') return; state.min = +ds.m; if (ds.e) state.employeeId = ds.e; haptic('select'); draw(); });
  on('na.create', () => {
    const d = new Date(state.date); d.setHours(Math.floor(state.min / 60), state.min % 60, 0, 0);
    const empId = state.employeeId || (slotsFor(staff().map(e => e.id), state.date, duration()).find(x => x.min === state.min) || {}).empId;
    if (!empId) { toast('Нет свободного мастера', 'dan'); return; }
    createAppointment({ clientId: state.clientId, employeeId: empId, serviceIds: state.serviceIds, start: d, source: 'owner' });
    s.close();
    toast('Запись создана на ' + dateLabel(d, now()).toLowerCase() + ', ' + toHM(state.min));
  });

  draw();
  return s;
}

/* =========================================================
   Блокировка времени
   ========================================================= */
export function blockFlow(pre = {}) {
  const st = {
    empId: pre.empId || staff()[0].id,
    date: pre.date ? startOfDay(pre.date) : today(),
    from: pre.startMin != null ? pre.startMin : 13 * 60,
    len: 60,
    kind: pre.kind || 'break',
    allDay: false,
    custom: false,          // §52 — произвольное время вместо готовых вариантов
    to: (pre.startMin != null ? pre.startMin : 13 * 60) + 60,
  };
  const s = sheet({ title: 'Занять время', body: '' });
  const KINDS = ['break', 'busy', 'other'];

  const draw = () => {
    const e = emp(st.empId);
    const w = e ? workDay(e, st.date) : null;
    const dayFrom = w ? toMin(w.from) : 9 * 60, dayTo = w ? toMin(w.to) : 20 * 60;
    if (st.allDay) { st.from = dayFrom; st.to = dayTo; }
    const endMin = st.custom || st.allDay ? st.to : st.from + st.len;

    s.set({
      title: 'Занять время',
      body: `
      <div class="field"><label>Мастер</label>
        <div class="pick">${staff().map(x => `<button class="o ${st.empId === x.id ? 'on' : ''}" data-a="bl.emp" data-id="${x.id}">${esc(x.name.split(' ')[0])}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Причина</label>
        <div class="pick">${KINDS.map(k => `<button class="o ${st.kind === k ? 'on' : ''}" data-a="bl.kind" data-k="${k}">${ABSENCE[k].t}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Дата</label><div style="margin:0 -18px">${dateStrip(st.date, 'bl.date', 14)}</div></div>

      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd);margin-bottom:14px">
        <div class="grow"><div class="tl">Весь день</div>
          <div class="st">${w ? w.from + ' — ' + w.to : 'мастер не работает в этот день'}</div></div>
        <button class="sw ${st.allDay ? 'on' : ''}" data-a="bl.allday"></button>
      </div>

      ${st.allDay ? '' : `
      <div class="field"><label>Начало</label>
        <div class="pick">${[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(h => `<button class="o ${st.from === h * 60 ? 'on' : ''}" data-a="bl.from" data-m="${h * 60}">${toHM(h * 60)}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Длительность</label>
        <div class="pick">
          ${[15, 30, 60, 90, 120, 240].map(m => `<button class="o ${!st.custom && st.len === m ? 'on' : ''}" data-a="bl.len" data-m="${m}">${nMin(m)}</button>`).join('')}
          <button class="o ${st.custom ? 'on' : ''}" data-a="bl.custom">Своё время</button>
        </div>
      </div>
      ${st.custom ? `<div class="inp-row" style="margin-bottom:14px">
        <div class="field" style="margin:0"><label>С</label><input class="inp" id="_bf" value="${toHM(st.from)}" placeholder="12:17"></div>
        <div class="field" style="margin:0"><label>По</label><input class="inp" id="_bt" value="${toHM(st.to)}" placeholder="12:47"></div>
      </div>` : ''}`}

      <div class="tiny dim">В это время клиенты не смогут записаться к мастеру.</div>`,
      footer: `<button class="btn p" data-a="bl.ok">Занять ${st.allDay ? 'весь день' : toHM(st.from) + '–' + toHM(endMin)}</button>`,
    });
  };

  const readCustom = () => {
    if (!st.custom) return;
    const f = s.el.querySelector('#_bf'), t = s.el.querySelector('#_bt');
    if (f && /^\d{1,2}:\d{2}$/.test(f.value)) st.from = toMin(f.value);
    if (t && /^\d{1,2}:\d{2}$/.test(t.value)) st.to = toMin(t.value);
  };

  on('bl.emp', ds => { readCustom(); st.empId = ds.id; draw(); });
  on('bl.kind', ds => { readCustom(); st.kind = ds.k; draw(); });
  on('bl.date', ds => { readCustom(); st.date = new Date(+ds.d); draw(); });
  on('bl.allday', () => { readCustom(); st.allDay = !st.allDay; draw(); });
  on('bl.from', ds => { st.from = +ds.m; st.to = st.from + st.len; st.custom = false; draw(); });
  on('bl.len', ds => { st.len = +ds.m; st.to = st.from + st.len; st.custom = false; draw(); });
  on('bl.custom', () => { readCustom(); st.custom = true; st.to = st.from + st.len; draw(); });
  on('bl.ok', () => {
    readCustom();
    const endMin = st.custom || st.allDay ? st.to : st.from + st.len;
    if (endMin <= st.from) { toast('Конец должен быть позже начала', 'dan'); return; }
    const a = new Date(st.date); a.setHours(Math.floor(st.from / 60), st.from % 60, 0, 0);
    const b = new Date(st.date); b.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
    addBlock({ employeeId: st.empId, start: a, end: b, reason: ABSENCE[st.kind].t, kind: st.kind, allDay: st.allDay });
    s.close();
    toast(st.allDay ? 'День занят' : 'Время занято ' + toHM(st.from) + '–' + toHM(endMin));
  });
  draw();
  return s;
}

/* =========================================================
   Отсутствие: отпуск, больничный, выходной (§53–§56)
   ========================================================= */
export function absenceFlow(pre = {}) {
  const st = {
    empId: pre.empId || staff()[0].id,
    kind: 'vacation',
    from: pre.date ? startOfDay(pre.date) : today(),
    to: pre.date ? startOfDay(pre.date) : today(),
    picking: null,          // 'from' | 'to' — какую границу выбираем
    month: pre.date ? startOfDay(pre.date) : today(),
  };
  const KINDS = ['vacation', 'sick', 'dayoff', 'busy', 'other'];
  const s = sheet({ title: 'Отметить отсутствие', body: '' });

  const days = Math.round((st.to - st.from) / 86400000) + 1;

  const draw = () => {
    const d = Math.round((st.to - st.from) / 86400000) + 1;
    s.set({
      title: st.picking ? (st.picking === 'from' ? 'С какого дня?' : 'По какой день?') : 'Отметить отсутствие',
      back: st.picking ? () => { st.picking = null; draw(); } : null,
      body: st.picking
        ? monthGrid(st.month, {
          selected: st.picking === 'from' ? st.from : st.to,
          action: 'ab.pick', navAction: 'ab.month',
          minDate: st.picking === 'to' ? st.from : null,
        })
        : `
        <div class="field"><label>Кто отсутствует</label>
          <div class="pick">${staff().map(x => `<button class="o ${st.empId === x.id ? 'on' : ''}" data-a="ab.emp" data-id="${x.id}">${esc(x.name.split(' ')[0])}</button>`).join('')}</div>
        </div>
        <div class="field"><label>Причина</label>
          <div class="pick">${KINDS.map(k => `<button class="o ${st.kind === k ? 'on' : ''}" data-a="ab.kind" data-k="${k}"
            style="${st.kind === k ? 'background:' + ABSENCE[k].color + '1f;color:' + ABSENCE[k].color + ';border-color:' + ABSENCE[k].color : ''}">${ABSENCE[k].t}</button>`).join('')}</div>
        </div>
        <div class="inp-row" style="margin-bottom:14px">
          <button class="card flat press" style="flex:1;padding:12px 14px;text-align:left" data-a="ab.setFrom">
            <div class="tiny dim">С</div><div class="b">${dateFull(st.from)}</div></button>
          <button class="card flat press" style="flex:1;padding:12px 14px;text-align:left" data-a="ab.setTo">
            <div class="tiny dim">По</div><div class="b">${dateFull(st.to)}</div></button>
        </div>
        <div class="card pad row" style="gap:10px;background:${ABSENCE[st.kind].color}14;border-color:transparent">
          <span style="color:${ABSENCE[st.kind].color}">${icon(ABSENCE[st.kind].icon, 19)}</span>
          <div class="sm" style="color:var(--tx-2)">${d} ${plural(d, ['день', 'дня', 'дней'])} — записи на это время приниматься не будут.</div>
        </div>`,
      footer: st.picking ? '' : `<button class="btn p" data-a="ab.ok">Отметить</button>`,
    });
  };

  on('ab.emp', ds => { st.empId = ds.id; draw(); });
  on('ab.kind', ds => { st.kind = ds.k; draw(); });
  on('ab.setFrom', () => { st.picking = 'from'; st.month = startOfDay(st.from); draw(); });
  on('ab.setTo', () => { st.picking = 'to'; st.month = startOfDay(st.to); draw(); });
  on('ab.month', ds => { st.month = startOfDay(new Date(+ds.d)); draw(); });
  on('ab.pick', ds => {
    const v = startOfDay(new Date(+ds.d));
    if (st.picking === 'from') { st.from = v; if (st.to < v) st.to = v; }
    else st.to = v;
    st.picking = null; draw();
  });
  on('ab.ok', () => {
    const rows = addAbsence({ employeeId: st.empId, from: st.from, to: st.to, kind: st.kind });
    s.close();
    const e = emp(st.empId);
    toast(`${ABSENCE[st.kind].t}: ${e ? e.name.split(' ')[0] : ''}, ${rows.length} ${plural(rows.length, ['день', 'дня', 'дней'])}`);
  });
  draw();
  return s;
}

/* =========================================================
   Новый клиент / услуга
   ========================================================= */
export function addClientSheet(after) {
  const s = sheet({
    title: 'Новый клиент',
    body: `
      <div class="field"><label>Имя</label><input class="inp" id="_n" placeholder="Например, Алия Смагулова"></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" placeholder="+7 ___ ___ __ __" inputmode="tel"></div>
      <div class="field"><label>Telegram (необязательно)</label><input class="inp" id="_t" placeholder="@username"></div>
      <div class="tiny dim">Остальное — заметки, предпочтения — можно добавить позже в карточке.</div>`,
    footer: `<button class="btn p" data-a="ac.ok">Добавить клиента</button>`,
  });
  on('ac.ok', () => {
    const n = s.el.querySelector('#_n').value.trim();
    if (!n) { toast('Введите имя', 'dan'); return; }
    const c = createClient({ name: n, phone: s.el.querySelector('#_p').value.trim(), tg: s.el.querySelector('#_t').value.trim() });
    s.close(); toast('Клиент добавлен');
    if (after) after(c); else go('o.client', { id: c.id });
  });
  setTimeout(() => s.el.querySelector('#_n').focus(), 250);
  return s;
}

export function addServiceSheet(pre = {}) {
  const st = { emps: staff().map(e => e.id), cat: pre.cat || svcs()[0] && svcs()[0].cat || 'nails' };
  const CATS = [['nails', 'Ногти'], ['hair', 'Волосы'], ['brow', 'Брови и ресницы'], ['bar', 'Барбер'], ['spa', 'Спа']];
  const s = sheet({
    title: 'Новая услуга',
    body: `
      <div class="field"><label>Название</label><input class="inp" id="_n" value="${esc(pre.name || '')}" placeholder="Например, Педикюр"></div>
      <div class="inp-row">
        <div class="field"><label>Цена, ₸</label><input class="inp" id="_p" inputmode="numeric" value="${pre.price || ''}" placeholder="10000"></div>
        <div class="field"><label>Время, мин</label><input class="inp" id="_d" inputmode="numeric" value="${pre.duration || ''}" placeholder="60"></div>
      </div>
      <div class="field"><label>Категория</label>
        <div class="pick" id="_cats">${CATS.map(c => `<button class="o ${st.cat === c[0] ? 'on' : ''}" data-a="as.cat" data-c="${c[0]}">${c[1]}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Кто выполняет</label>
        <div class="pick" id="_emps">${staff().map(e => `<button class="o on" data-a="as.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}</div>
      </div>
      <div class="tiny dim">Описание, фото и буферное время можно настроить после создания.</div>`,
    footer: `<button class="btn p" data-a="as.ok">Создать услугу</button>`,
  });
  on('as.cat', (ds, el) => { st.cat = ds.c; s.el.querySelectorAll('#_cats .o').forEach(o => o.classList.toggle('on', o.dataset.c === ds.c)); });
  on('as.emp', (ds, el) => {
    const i = st.emps.indexOf(ds.id);
    if (i >= 0) st.emps.splice(i, 1); else st.emps.push(ds.id);
    el.classList.toggle('on', st.emps.includes(ds.id));
  });
  on('as.ok', () => {
    const n = s.el.querySelector('#_n').value.trim();
    const p = +s.el.querySelector('#_p').value || 0;
    const d = +s.el.querySelector('#_d').value || 60;
    if (!n) { toast('Введите название', 'dan'); return; }
    const sv = createService({ name: n, price: p, duration: d, employeeIds: st.emps, cat: st.cat });
    s.close(); toast('Услуга добавлена');
    if (pre.after) pre.after(sv);
  });
  setTimeout(() => s.el.querySelector('#_n').focus(), 250);
  return s;
}

/* =========================================================
   Голосовая AI-заметка
   ========================================================= */
let voiceIdx = 0;
export function voiceNoteSheet(clientId) {
  const c = client(clientId); if (!c) return;
  const demo = demoVoice(voiceIdx++);
  let phase = 'idle', text = '', parsed = null;
  const s = sheet({ title: 'Заметка о клиенте', body: '' });

  const draw = () => {
    if (phase === 'idle') s.set({
      title: 'Заметка о клиенте',
      body: `<div class="center" style="padding:10px 0 18px">
          <div class="sm muted" style="margin-bottom:22px">Нажмите и надиктуйте, что важно помнить о клиенте<br>${esc(c.name)}</div>
          <button class="mic" data-a="vn.rec">${icon('mic', 34, 2)}</button>
          <div class="tiny dim" style="margin-top:16px">AI сам разложит текст по категориям</div>
        </div>
        <div class="hr"></div>
        <button class="btn gh sm" style="width:100%" data-a="vn.type">${icon('pencil', 16)}Ввести текстом</button>`,
    });
    else if (phase === 'rec') s.set({
      title: 'Записываю…',
      body: `<div class="center" style="padding:10px 0 18px">
          <button class="mic rec" data-a="vn.stop">${icon('mic', 34, 2)}</button>
          <div class="wave" style="margin-top:18px">${Array.from({ length: 22 }, (_, i) => `<i style="animation-delay:${(i % 7) * .08}s"></i>`).join('')}</div>
          <div class="sm muted" style="margin-top:8px">Говорите… нажмите, чтобы остановить</div>
        </div>`,
    });
    else if (phase === 'think') s.set({
      title: 'AI анализирует', body: `${loadingBlock('Анализирую заметку…')}
        <div class="card flat" style="padding:12px 14px"><div class="tiny muted b" style="margin-bottom:4px">Распознанный текст</div>
        <div class="sm">${esc(text)}</div></div>`,
    });
    else s.set({
      title: 'AI распознал',
      body: `
        <div class="card flat" style="padding:12px 14px;margin-bottom:14px">
          <div class="tiny muted b" style="margin-bottom:4px">Ваша заметка</div><div class="sm">${esc(text)}</div>
        </div>
        ${block('Предпочтения', parsed.prefs, 'star', 'var(--p)')}
        ${block('Важно', parsed.care, 'alert', 'var(--warn)')}
        ${block('Следующий визит', parsed.next, 'calendar', 'var(--ok)')}`,
      footer: `<div class="btns"><button class="btn gh" data-a="vn.edit">Изменить</button><button class="btn p" data-a="vn.save">Сохранить</button></div>`,
    });
  };
  const block = (title, items, ic, color) => !items.length ? '' : `
    <div class="card" style="padding:13px 14px;margin-bottom:10px">
      <div class="row" style="gap:7px;margin-bottom:6px;color:${color}">${icon(ic, 15)}<b class="tiny" style="text-transform:uppercase;letter-spacing:.05em">${title}</b></div>
      <div class="sm" style="line-height:1.6">${items.map(x => '• ' + esc(x)).join('<br>')}</div>
    </div>`;

  on('vn.rec', () => { phase = 'rec'; draw(); haptic('medium'); });
  on('vn.stop', async () => {
    text = demo.text; phase = 'think'; draw();
    await wait(1500);
    parsed = parseNote(text);
    if (!parsed.prefs.length && !parsed.care.length && !parsed.next.length) parsed = { ...demo.ai, updated: now().toISOString() };
    phase = 'done'; draw(); haptic('success');
  });
  on('vn.type', async () => {
    const v = await promptSheet({ title: 'Заметка', label: 'Что важно помнить?', multiline: true, placeholder: 'Например: предпочитает нюдовые оттенки, чувствительная кожа' });
    if (!v) return;
    text = v; phase = 'think'; draw();
    await wait(1200);
    parsed = parseNote(text); phase = 'done'; draw();
  });
  on('vn.edit', () => { phase = 'idle'; draw(); });
  on('vn.save', () => {
    const cur = c.ai || { prefs: [], care: [], next: [] };
    const merge = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
    updateClient(clientId, {
      ai: { prefs: merge(cur.prefs, parsed.prefs), care: merge(cur.care, parsed.care), next: merge(cur.next, parsed.next), updated: now().toISOString() },
    });
    s.close(); toast('Заметка сохранена в карточке клиента', 'ai');
  });
  draw();
  return s;
}
on('vn.open', ds => voiceNoteSheet(ds.id));
