import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor,
  now, today, todayStats, rangeStats, nextAppt, dayAppts, blocks, me, toHM, toMin, workDay, workWindow, companyHours,
  clientStats, emit, freeGaps, removeBlock, ABSENCE, absenceOn,
  markSetup, setupSteps, tipSeen, markTip, daysBetween,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, dateFull, nMin, nAppt, avatar, greet, WD, WD_FULL, MONTHS,
  dayKey, startOfDay, addDays, emptyState, sheet, toast, segmented, sparkline, num, plural,
  confirmSheet, monthGrid, MONTH_NAMES, MON_SHORT, tipCard,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { openApptSheet, newApptFlow, blockFlow, quickAdd, dateStrip, absenceFlow, tipOnce } from '../flows.js';
import { haptic, copy, openLink } from '../tg.js';
import { BOT_USERNAME } from '../config.js';

const rr = () => render(false);

/* =========================================================
   Главная (владелец)
   ========================================================= */
export function apptRow(a, { showEmp = true } = {}) {
  const c = client(a.clientId), e = emp(a.employeeId);
  const st = new Date(a.start);
  return `<button class="appt press" style="--c:${apptColor(a)};width:100%;text-align:left" data-a="ap.card" data-id="${a.id}">
    <div class="t">${hhmm(st)}<small>${a.duration}м</small></div>
    <div class="grow">
      <div class="n nowrap">${esc(c ? c.name : 'Клиент')}</div>
      <div class="s nowrap">${esc(apptTitle(a))}${showEmp && e ? ' · ' + esc(e.name.split(' ')[0]) : ''}</div>
    </div>
    ${a.status === 'done' ? `<span class="bdg ok">${icon('check', 12, 2.6)}</span>`
      : a.status === 'cancelled' ? `<span class="bdg dan">отменена</span>`
        : `<div class="b sm">${moneyShort(a.price)}</div>`}
  </button>`;
}

route('o.home', {
  tab: 'o.home',
  fab: () => `<button class="fab" data-a="fab">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const c = co(), u = me();
    const t = todayStats();
    const s7 = rangeStats(7);
    const nx = nextAppt();
    const list = t.list.filter(a => a.status !== 'cancelled');

    return `
    <div class="top">
      ${avatar({ initials: c.initials, color: c.color, photo: c.logo }, 'm', 'av-sq')}
      <div class="grow">
        <div class="top-t nowrap" style="font-size:17px">${esc(c.name)}</div>
        <div class="top-sub">${greet(now().getHours())}, ${esc(u.name.split(' ')[0])}</div>
      </div>
      <button class="ico-btn" data-a="nav" data-r="o.notifications">${icon('bell', 19)}</button>
    </div>

    <div class="kpis sec" style="margin-top:6px">
      <div class="kpi">
        <div class="l">${icon('calendar', 13, 2)}Сегодня</div>
        <div class="v">${t.count}</div>
        <div class="d dim">${plural(t.count, ['запись', 'записи', 'записей'])}</div>
      </div>
      <div class="kpi">
        <div class="l">${icon('wallet', 13, 2)}Выручка</div>
        <div class="v">${moneyShort(t.revenue)} ₸</div>
        <div class="d dim">из ${moneyShort(t.potential)} ₸</div>
      </div>
      <div class="kpi">
        <div class="l">${icon('users', 13, 2)}Клиенты</div>
        <div class="v">${t.clients}</div>
        <div class="d dim">сегодня</div>
      </div>
      <div class="kpi">
        <div class="l">${icon('trendUp', 13, 2)}Неделя</div>
        <div class="v">${moneyShort(s7.revenue)} ₸</div>
        <div class="d ${s7.deltaRev >= 0 ? 'up' : 'down'}">${s7.deltaRev >= 0 ? '↑' : '↓'} ${Math.abs(s7.deltaRev)}%</div>
      </div>
    </div>

    ${setupCard()}

    <div class="sec wrap">
      ${nx ? nextCard(nx) : `
        <div class="card pad center" style="padding:26px 20px">
          <div class="row center" style="justify-content:center;color:var(--tx-3);margin-bottom:8px">${icon('coffee', 30, 1.6)}</div>
          <div class="b">На сегодня всё</div>
          <div class="sm muted" style="margin-top:2px">Следующих записей нет</div>
          <button class="btn p sm" style="margin:14px auto 0" data-a="qa.appt">${icon('plus', 16)}Добавить запись</button>
        </div>`}
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Сегодня</div>
        <button class="sec-a" data-a="tab" data-r="o.cal">Календарь ${icon('fwd', 14, 2.4)}</button></div>
      <div class="wrap stack s">
        ${list.length ? list.map(a => apptRow(a)).join('')
        : emptyState({ ic: 'coffee', title: 'Сегодня свободный день', text: 'Записей пока нет — самое время добавить.', action: 'Добавить запись', act: 'qa.appt' })}
      </div>
    </div>

`;
  },
});

/* §97 — пошаговая настройка после регистрации.
   Пропадает сама, когда всё сделано: постоянный чеклист на главной
   у работающего салона только мешает. */
function setupCard() {
  const steps = setupSteps();
  const left = steps.filter(s => !s.done);
  if (!left.length) return '';
  const done = steps.length - left.length;
  return `<div class="sec wrap">
    <button class="card press" style="width:100%;padding:15px;text-align:left" data-a="nav" data-r="o.help">
      <div class="row between" style="margin-bottom:8px">
        <div class="row" style="gap:9px"><span style="color:var(--p)">${icon('zap', 18)}</span>
          <b>Настройка бизнеса</b></div>
        <span class="bdg p">${done} из ${steps.length}</span>
      </div>
      <div class="prog"><i style="width:${done / steps.length * 100}%;background:var(--p)"></i></div>
      <div class="sm muted" style="margin-top:8px">Дальше: ${esc(left[0].t.toLowerCase())} — ${esc(left[0].s.toLowerCase())}</div>
    </button>
  </div>`;
}

function nextCard(a) {
  const c = client(a.clientId), e = emp(a.employeeId);
  const st = new Date(a.start);
  const mins = Math.round((st - now()) / 60000);
  const inTxt = mins < 60 ? 'через ' + mins + ' мин' : dayKey(st) === dayKey(now()) ? 'сегодня в ' + hhmm(st) : dateLabel(st, now()).toLowerCase() + ' в ' + hhmm(st);
  return `<div class="hero">
    <div class="lb">Следующий клиент · ${inTxt}</div>
    <div class="tm">${hhmm(st)}</div>
    <div class="nm">${esc(c ? c.name : '')}</div>
    <div class="sv">${esc(apptTitle(a))}</div>
    <div class="hero-meta">
      <span>${icon('clock', 13, 2)} ${nMin(a.duration)}</span>
      <span>${icon('wallet', 13, 2)} ${money(a.price)}</span>
      <span>${icon('user', 13, 2)} ${esc(e ? e.name.split(' ')[0] : '')}</span>
    </div>
    <button class="btn" data-a="ap.card" data-id="${a.id}">Открыть запись</button>
  </div>`;
}

on('ap.card', ds => openApptSheet(ds.id));
export const bookingLink = (c = co()) => 'https://t.me/' + BOT_USERNAME + '?start=' + c.id;

on('o.share', () => {
  const c = co();
  sheet({
    title: 'Страница записи',
    body: `<div class="center" style="padding:6px 0 14px">
        ${avatar({ initials: c.initials, color: c.color, photo: c.logo }, 'xl', 'av-sq')}
        <div class="b" style="font-size:17px;margin-top:12px">${esc(c.name)}</div>
        <div class="sm muted">Клиенты записываются по этой ссылке за 30 секунд</div>
      </div>
      <div class="card flat" style="padding:14px;text-align:center;margin-bottom:12px">
        <div class="tiny muted">Ссылка для клиентов</div>
        <div class="b" style="margin-top:4px;word-break:break-all">${esc(bookingLink(c))}</div>
      </div>
      <div class="acts">
        <button class="act" data-a="o.copyLink">${icon('copy', 20)}Копировать</button>
        <button class="act" data-a="o.sendLink">${icon('send', 20)}Отправить</button>
        <button class="act" data-a="o.preview">${icon('eye', 20)}Глазами клиента</button>
      </div>
      <div class="tiny dim center" style="margin-top:14px">Поставьте ссылку в шапку профиля или сторис — клиент попадёт сразу на вашу страницу записи.</div>`,
  });
});
on('o.copyLink', async () => { await copy(bookingLink()); markSetup('share'); toast('Ссылка скопирована'); });
on('o.sendLink', () => {
  markSetup('share');
  openLink('https://t.me/share/url?url=' + encodeURIComponent(bookingLink()) +
    '&text=' + encodeURIComponent('Записывайтесь онлайн — свободное время видно сразу'));
});
on('o.preview', () => {
  document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click());
  const cl = clients()[0];
  S.session.role = 'client';
  if (cl) S.session.clientId = cl.id;
  emit();
  setTimeout(() => go('cl.company', {}, { root: true }), 260);
});

/* =========================================================
   Календарь
   ========================================================= */
const cal = { date: null, empId: null, view: 'day', motion: '', rangeFrom: null, rangeTo: null, returnContext: null };

function calendarRange() {
  const from = startOfDay(cal.rangeFrom || cal.date || today());
  const to = startOfDay(cal.rangeTo || from);
  return from <= to ? { from, to } : { from: to, to: from };
}

function rangeDays(from, to) {
  const count = daysBetween(from, to);
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

function rangeTitle(from, to) {
  if (dayKey(from) === dayKey(to)) return `${from.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS[to.getMonth()]} ${to.getFullYear()}`;
  }
  if (from.getFullYear() === to.getFullYear()) {
    return `${from.getDate()} ${MON_SHORT[from.getMonth()]} – ${to.getDate()} ${MON_SHORT[to.getMonth()]} ${to.getFullYear()}`;
  }
  return `${from.getDate()} ${MON_SHORT[from.getMonth()]} ${from.getFullYear()} – ${to.getDate()} ${MON_SHORT[to.getMonth()]} ${to.getFullYear()}`;
}

route('o.cal', {
  perm: 'allCalendar',
  tab: 'o.cal',
  fab: () => `<button class="fab" data-a="cal.add">${icon('plus', 26, 2.4)}</button>`,
  render() { return calendarScreen({ scope: 'company' }); },
  mount() {
    tipOnce('cal', {
      title: 'Тап по свободному окну',
      text: 'Откроется меню: записать клиента, занять время, поставить перерыв или отметить отсутствие. Заголовок с датой открывает календарь.',
      ic: 'calendar',
    });
  },
});

export function calendarScreen({ scope = 'company', fixedEmp = null } = {}) {
  if (!cal.date) cal.date = today();
  if (fixedEmp) cal.empId = fixedEmp;
  // Фильтр мастера мог остаться от другой роли или компании — тогда календарь
  // молча показывал бы пустой день. Сбрасываем, если мастера здесь больше нет.
  else if (cal.empId && !staff().some(e => e.id === cal.empId)) cal.empId = null;
  const d = cal.date;
  const list = staff();
  const empId = fixedEmp || cal.empId;
  const motion = cal.motion;
  cal.motion = '';

  // §44 — в режиме недели показываем диапазон, а не одно число
  const wkStart = addDays(d, -((d.getDay() + 6) % 7)), wkEnd = addDays(wkStart, 6);
  const custom = calendarRange();
  const isToday = cal.view === 'range'
    ? today() >= custom.from && today() <= custom.to
    : cal.view === 'week'
      ? today() >= wkStart && today() <= wkEnd
      : cal.view === 'month'
        ? d.getMonth() === today().getMonth() && d.getFullYear() === today().getFullYear()
        : dayKey(d) === dayKey(now());
  const title = cal.view === 'range'
    ? rangeTitle(custom.from, custom.to)
    : cal.view === 'month'
    ? MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear()
    : cal.view === 'week'
      ? (wkStart.getMonth() === wkEnd.getMonth()
        ? wkStart.getDate() + '–' + wkEnd.getDate() + ' ' + MONTHS[wkEnd.getMonth()]
        : wkStart.getDate() + ' ' + MON_SHORT[wkStart.getMonth()] + ' – ' + wkEnd.getDate() + ' ' + MON_SHORT[wkEnd.getMonth()])
      : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const sub = cal.view === 'range'
    ? `${daysBetween(custom.from, custom.to)} ${plural(daysBetween(custom.from, custom.to), ['день', 'дня', 'дней'])}`
    : cal.view === 'day' ? (isToday ? 'сегодня' : WD_FULL[d.getDay()]) : '';
  const returnLabel = cal.returnContext
    ? cal.returnContext.view === 'range'
      ? `К периоду ${rangeTitle(custom.from, custom.to)}`
      : cal.returnContext.view === 'week'
        ? (() => {
          const start = addDays(cal.returnContext.date, -((cal.returnContext.date.getDay() + 6) % 7));
          return `К неделе ${rangeTitle(start, addDays(start, 6))}`;
        })()
        : `К месяцу ${MONTH_NAMES[cal.returnContext.date.getMonth()]} ${cal.returnContext.date.getFullYear()}`
    : '';
  const headerSub = returnLabel || sub;
  const periodAction = cal.view === 'range' || !cal.rangeFrom || !cal.rangeTo ? 'cal.custom' : 'cal.view';

  return `
  <div class="top blur cal-top">
    ${cal.returnContext ? `<button class="ico-btn flat cal-context-back" data-a="cal.return" aria-label="${esc(returnLabel)}">${icon('back', 18)}</button>` : ''}
    <button class="cal-title" data-a="${cal.view === 'range' ? 'cal.custom' : 'cal.pickDate'}">
      <span>${title} ${icon('down', 13, 2.4)}</span>
      <small class="${headerSub ? '' : 'cal-sub-empty'}" ${headerSub ? '' : 'aria-hidden="true"'}>${headerSub || '&nbsp;'}</small>
    </button>
    <div class="cal-nav">
      <button class="cal-today ${isToday ? 'is-current' : ''}" data-a="cal.today">Сегодня</button>
      <button class="ico-btn flat cal-arrow" data-a="cal.prev" aria-label="Предыдущий период">${icon('back', 18)}</button>
      <button class="ico-btn flat cal-arrow" data-a="cal.next" aria-label="Следующий период">${icon('fwd', 18)}</button>
    </div>
  </div>

  <div class="wrap cal-view-switch">
    <div class="seg cal-view-seg">
      <button data-a="cal.view" data-v="day" class="${cal.view === 'day' ? 'on' : ''}">День</button>
      <button data-a="cal.view" data-v="week" class="${cal.view === 'week' ? 'on' : ''}">Неделя</button>
      <button data-a="cal.view" data-v="month" class="${cal.view === 'month' ? 'on' : ''}">Месяц</button>
      <button data-a="${periodAction}" data-v="range" class="${cal.view === 'range' ? 'on' : ''}">Период</button>
    </div>
  </div>

  ${!fixedEmp && list.length > 1 ? `<div class="chips cal-staff">
    <button class="chip cal-person ${!empId ? 'on' : ''}" data-a="cal.emp" data-id="">Все</button>
    ${list.map(e => `<button class="chip cal-person ${empId === e.id ? 'on' : ''}" data-a="cal.emp" data-id="${e.id}" style="--emp-color:${e.color}">
      <i style="width:7px;height:7px;border-radius:50%;background:${e.color};display:inline-block"></i>${esc(e.name.split(' ')[0])}</button>`).join('')}
  </div>` : ''}

  <div class="cal-content ${motion ? 'cal-motion-' + motion : ''}">
    ${periodStats(d, empId)}
    ${cal.view === 'day' ? dayView(d, empId)
      : cal.view === 'week' ? weekView(d, empId)
        : cal.view === 'month' ? monthView(d, empId)
          : rangeView(custom.from, custom.to, empId)}
  </div>`;
}

/* §58 — показатели прямо в календаре: сколько записей, загрузка,
   свободные окна и ожидаемая выручка за видимый период. */
function periodStats(d, empId) {
  let days = [d];
  if (cal.view === 'week') {
    const s0 = addDays(d, -((d.getDay() + 6) % 7));
    days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(s0, i));
  } else if (cal.view === 'month') {
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    days = Array.from({ length: n }, (_, i) => new Date(d.getFullYear(), d.getMonth(), i + 1));
  } else if (cal.view === 'range') {
    const custom = calendarRange();
    days = rangeDays(custom.from, custom.to);
  }
  const team = empId ? [emp(empId)].filter(Boolean) : staff();
  let cnt = 0, rev = 0, busyMin = 0, workMin = 0, gaps = 0;
  days.forEach(day => {
    dayAppts(day, { employeeId: empId }).forEach(a => { cnt++; rev += a.price; busyMin += a.duration; });
    team.forEach(e => {
      const w = workDay(e, day);
      if (w) workMin += toMin(w.to) - toMin(w.from);
      if (dayKey(day) >= dayKey(now())) gaps += freeGaps(day, e.id, cid(), 60).length;
    });
  });
  const load = workMin ? Math.round(busyMin / workMin * 100) : 0;
  const loadColor = load > 70 ? 'var(--ok)' : load > 40 ? 'var(--warn)' : 'var(--tx-2)';
  return `<div class="wrap cal-summary-wrap">
    <div class="cal-summary">
      <div class="cal-stat"><span>Записи</span><strong>${cnt}</strong></div>
      <div class="cal-stat cal-load"><span>Загрузка</span><strong style="color:${loadColor}">${load}%</strong><i><b style="width:${Math.min(100, load)}%;background:${loadColor}"></b></i></div>
      <div class="cal-stat"><span>Окна</span><strong>${gaps}</strong></div>
      <div class="cal-stat"><span>Доход</span><strong>${moneyShort(rev)} ₸</strong></div>
    </div>
  </div>`;
}

function dayView(d, empId) {
  const list = dayAppts(d, { employeeId: empId });
  const blk = blocks().filter(b => dayKey(new Date(b.start)) === dayKey(d) && (!empId || b.employeeId === empId));
  const wd = staff().map(e => workDay(e, d)).filter(Boolean);
  let from = 9 * 60, to = 20 * 60;
  if (wd.length) { from = Math.min(...wd.map(w => toMin(w.from))); to = Math.max(...wd.map(w => toMin(w.to))); }
  list.forEach(a => { const s = new Date(a.start); from = Math.min(from, s.getHours() * 60); to = Math.max(to, s.getHours() * 60 + s.getMinutes() + a.duration + 30); });
  const H0 = Math.floor(from / 60), H1 = Math.ceil(to / 60);
  const PX = 64;
  const y = m => (m - H0 * 60) / 60 * PX;

  const items = list.map(a => {
    const s = new Date(a.start);
    return { a, s: s.getHours() * 60 + s.getMinutes(), e: s.getHours() * 60 + s.getMinutes() + a.duration };
  }).sort((x, z) => x.s - z.s);
  const lanes = [];
  items.forEach(it => {
    let li = lanes.findIndex(l => l[l.length - 1].e <= it.s);
    if (li < 0) { lanes.push([it]); li = lanes.length - 1; } else lanes[li].push(it);
    it.lane = li;
  });
  const laneCount = Math.max(1, lanes.length);

  const nowMin = now().getHours() * 60 + now().getMinutes();
  const showNow = dayKey(d) === dayKey(now()) && nowMin >= H0 * 60 && nowMin <= H1 * 60;

  // §57 — отсутствие на весь день показываем плашкой над сеткой
  const allDay = blk.filter(b => b.allDay);
  const banner = allDay.length ? `<div class="wrap" style="margin-bottom:10px"><div class="stack s">
    ${allDay.map(b => {
    const e = emp(b.employeeId), k = ABSENCE[b.kind] || ABSENCE.other;
    return `<button class="lrow press" style="border-radius:14px;border:1px solid ${k.color}44;background:${k.color}14;width:100%"
        data-a="cal.unblock" data-id="${b.id}">
        <div class="ic" style="background:${k.color};color:#fff">${icon(k.icon, 17)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${esc(k.t)}</div>
          <div class="st">${esc(e ? e.name : '')} · весь день</div></div>
        ${icon('trash', 16)}</button>`;
  }).join('')}</div></div>` : '';

  if (!list.length && !blk.length) {
    return `<div class="tline" style="position:relative">${hours(H0, H1, PX, d, empId)}</div>
      ${emptyState({ ic: 'coffee', title: dayKey(d) === dayKey(now()) ? 'Сегодня свободный день' : 'Записей нет', text: 'Нажмите на свободное время, чтобы добавить запись.', action: 'Добавить запись', act: 'cal.add' })}`;
  }

  return `${banner}<div class="tline" style="position:relative">
    ${hours(H0, H1, PX, d, empId)}
    <div style="position:absolute;left:58px;right:16px;top:0;bottom:8px;pointer-events:none">
      ${items.map(it => {
    const a = it.a, cl = client(a.clientId), e = emp(a.employeeId);
    const c = e ? e.color : apptColor(a);
    const h = Math.max(30, a.duration / 60 * PX - 4);
    const w = 100 / laneCount, left = it.lane * w;
    return `<button class="tl-ev ${h < 44 ? 'mini' : ''} ${a.status === 'done' ? 'done' : ''}" data-a="ap.card" data-id="${a.id}"
          style="pointer-events:auto;top:${y(it.s) + 2}px;height:${h}px;left:${left}%;width:calc(${w}% - 4px);--c:${c};--c-bg:${c}1a;${a.status === 'done' ? 'opacity:.62;' : ''}">
          <div class="n nowrap">${hhmm(new Date(a.start))} ${esc(cl ? cl.name.split(' ')[0] : '')}</div>
          <div class="s nowrap">${esc(apptTitle(a))}${e ? ' · ' + esc(e.name.split(' ')[0]) : ''}</div>
        </button>`;
  }).join('')}
      ${blk.filter(b => !b.allDay).map(b => {
    const s = new Date(b.start), e2 = new Date(b.end);
    const sm = s.getHours() * 60 + s.getMinutes(), em = e2.getHours() * 60 + e2.getMinutes();
    const k = ABSENCE[b.kind] || ABSENCE.other;
    return `<button class="tl-ev block" data-a="cal.unblock" data-id="${b.id}" style="pointer-events:auto;top:${y(sm) + 2}px;height:${Math.max(26, (em - sm) / 60 * PX - 4)}px;left:0;width:100%;border-left-color:${k.color}">
          <div class="n nowrap">${icon(k.icon, 11, 2.4)} ${esc(b.reason)}</div></button>`;
  }).join('')}
    </div>
    ${showNow ? `<div class="tl-now" style="top:${y(nowMin)}px"></div>` : ''}
  </div>`;
}

function hours(H0, H1, PX, d, empId) {
  let out = '';
  for (let h = H0; h < H1; h++) {
    out += `<div class="tl-row" style="height:${PX}px">
      <div class="h">${String(h).padStart(2, '0')}:00</div>
      <div class="tl-body" style="height:${PX}px">
        <button class="tl-free" style="top:0;height:${PX / 2}px" data-a="cal.slot" data-m="${h * 60}"></button>
        <button class="tl-free" style="top:${PX / 2}px;height:${PX / 2}px" data-a="cal.slot" data-m="${h * 60 + 30}"></button>
      </div></div>`;
  }
  return out + `<div style="height:1px;border-top:1px dashed var(--bd)"></div>`;
}

function weekView(d, empId) {
  const start = addDays(d, -((d.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const list = dayAppts(day, { employeeId: empId });
    const isT = dayKey(day) === dayKey(now());
    // Шапка, список и подвал — три отдельных блока: иначе «+N» висит
    // сразу за плашками, и низ колонок не совпадает между собой.
    cells.push(`<button class="wcol ${isT ? 'today' : ''}" data-a="cal.dayMenu" data-d="${day.getTime()}">
      <div class="whead">
        <div class="w">${WD[day.getDay()]}</div>
        <div class="n">${day.getDate()}</div>
        <div class="wcount">${nAppt(list.length)}</div>
      </div>
      <div class="wevs">
        ${list.slice(0, 4).map(a => {
      const e = emp(a.employeeId);
      return `<div class="ev" style="background:${e ? e.color : apptColor(a)}">${hhmm(new Date(a.start))}</div>`;
    }).join('')}
        ${!list.length ? '<div class="wempty">свободно</div>' : ''}
      </div>
      <div class="wmore">${list.length > 4 ? '+' + (list.length - 4) + ' ещё' : ''}</div>
    </button>`);
  }
  return `<div class="wgrid">${cells.join('')}</div>`;
}

/* §42 — месяц: сетка с числом записей и полоской загрузки; тап открывает день */
function monthView(d, empId) {
  const y = d.getFullYear(), m = d.getMonth();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const team = empId ? [emp(empId)].filter(Boolean) : staff();

  // Сначала собираем месяц целиком: густота заливки считается относительно
  // самого плотного дня. Абсолютные проценты загрузки для этого не годятся —
  // у салона они держатся около 15%, и все дни красились бы одинаково.
  const days = [];
  for (let n = 1; n <= daysIn; n++) {
    const day = new Date(y, m, n);
    const list = dayAppts(day, { employeeId: empId });
    let work = 0;
    team.forEach(e => { const w = workDay(e, day); if (w) work += toMin(w.to) - toMin(w.from); });
    days.push({
      n, day, count: list.length, off: !work,
      away: team.some(e => absenceOn(day, e.id).length),
    });
  }
  const peak = Math.max(1, ...days.map(x => x.count));

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="mv-cell mv-empty"></div>');
  for (const x of days) {
    const share = x.count / peak;
    const lv = !x.count ? 0 : share > 0.75 ? 3 : share > 0.4 ? 2 : 1;
    const label = ['записей нет', 'спокойный день', 'обычный день', 'плотный день'][lv];
    const isT = dayKey(x.day) === dayKey(now());
    const weekend = x.day.getDay() === 0 || x.day.getDay() === 6;
    cells.push(`<button class="mv-cell lv${lv} ${isT ? 'today' : ''} ${x.off ? 'off' : ''} ${weekend ? 'weekend' : ''}" data-a="cal.dayMenu" data-d="${x.day.getTime()}"
      aria-label="${x.n} ${MONTHS[m]}, ${nAppt(x.count)}, ${x.off ? 'салон закрыт' : label}">
      <span class="d">${x.n}</span>
      ${x.count ? `<span class="cnt">${x.count}</span>` : x.off ? '<span class="cnt dim">вых.</span>' : '<span class="cnt dim"></span>'}
      ${x.away ? '<i class="away" title="отсутствие мастера"></i>' : ''}
    </button>`);
  }
  return `<div class="wrap cal-month"><div class="mv-grid-wd">${['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="mv-grid">${cells.join('')}</div>
    <div class="mv-legend">
      <span class="mv-scale">Записей меньше<i class="lv1"></i><i class="lv2"></i><i class="lv3"></i>больше</span>
      <span class="mv-away"><i></i>отсутствие мастера</span>
    </div>
  </div>`;
}

function rangeView(from, to, empId) {
  const days = rangeDays(from, to);
  const groups = days.map(day => {
    const list = dayAppts(day, { employeeId: empId });
    return { day, list, revenue: list.reduce((sum, a) => sum + a.price, 0) };
  }).filter(group => group.list.length);

  if (!groups.length) {
    return `<div class="wrap">${emptyState({
      ic: 'calendar',
      title: 'В этом периоде записей нет',
      text: `${dateFull(from)} — ${dateFull(to)}. Выберите другой период или создайте запись.`,
      action: 'Добавить запись',
      act: 'cal.add',
    })}</div>`;
  }

  return `<div class="wrap cal-range-list">
    <div class="cal-range-note">${groups.length} ${plural(groups.length, ['день', 'дня', 'дней'])} с записями</div>
    ${groups.map(({ day, list, revenue }) => `
      <section class="cal-range-day">
        <button class="cal-range-head" data-a="cal.dayMenu" data-d="${day.getTime()}">
          <span><b>${day.getDate()} ${MONTHS[day.getMonth()]}</b><small>${WD_FULL[day.getDay()]}</small></span>
          <span class="cal-range-total"><b>${nAppt(list.length)}</b><small>${moneyShort(revenue)} ₸</small></span>
          ${icon('fwd', 15, 2.2)}
        </button>
        <div class="stack s">${list.map(a => apptRow(a, { showEmp: !empId })).join('')}</div>
      </section>`).join('')}
  </div>`;
}

on('cal.view', ds => { cal.view = ds.v; cal.returnContext = null; cal.motion = 'switch'; rr(); });
on('cal.emp', ds => { cal.empId = ds.id || null; cal.motion = 'switch'; rr(); });
on('cal.today', () => {
  cal.date = today();
  if (cal.view === 'range') cal.view = 'day';
  cal.returnContext = null;
  cal.motion = 'today';
  rr();
});
on('cal.prev', () => {
  if (cal.view === 'range') {
    const { from, to } = calendarRange();
    const shift = -daysBetween(from, to);
    cal.rangeFrom = addDays(from, shift);
    cal.rangeTo = addDays(to, shift);
    cal.date = cal.rangeFrom;
  } else cal.date = cal.view === 'month'
    ? new Date(cal.date.getFullYear(), cal.date.getMonth() - 1, 1)
    : addDays(cal.date, cal.view === 'week' ? -7 : -1);
  cal.motion = 'prev';
  rr();
});
on('cal.next', () => {
  if (cal.view === 'range') {
    const { from, to } = calendarRange();
    const shift = daysBetween(from, to);
    cal.rangeFrom = addDays(from, shift);
    cal.rangeTo = addDays(to, shift);
    cal.date = cal.rangeFrom;
  } else cal.date = cal.view === 'month'
    ? new Date(cal.date.getFullYear(), cal.date.getMonth() + 1, 1)
    : addDays(cal.date, cal.view === 'week' ? 7 : 1);
  cal.motion = 'next';
  rr();
});
on('cal.return', () => {
  if (!cal.returnContext) return;
  const ctx = cal.returnContext;
  cal.returnContext = null;
  cal.view = ctx.view;
  cal.date = startOfDay(ctx.date);
  cal.motion = 'switch';
  window.scrollTo(0, 0);
  rr();
});

on('cal.dayMenu', ds => {
  const date = startOfDay(new Date(+ds.d));
  const list = dayAppts(date, { employeeId: cal.empId });
  const revenue = list.reduce((sum, a) => sum + a.price, 0);
  const origin = { view: cal.view, date: startOfDay(cal.date) };
  const actions = [
    ['calendarPlus', 'Создать запись', 'Клиент, услуга и время', 'cal.dayAdd', '#4C6FFF'],
    ['lock', 'Заблокировать время', 'Личные дела или занятый слот', 'cal.dayBlock', '#F79009'],
    ['coffee', 'Добавить перерыв', 'Обед или пауза в расписании', 'cal.dayBreak', '#8B5CF6'],
    ['gift', 'Отметить отсутствие', 'Выходной, отпуск или больничный', 'cal.dayAway', '#06AED4'],
  ];
  const sh = sheet({
    title: `${date.getDate()} ${MONTHS[date.getMonth()]} · ${WD_FULL[date.getDay()]}`,
    body: `<div class="cal-day-overview">
      <div><span>Записи</span><b>${list.length}</b></div>
      <div><span>Доход</span><b>${moneyShort(revenue)} ₸</b></div>
    </div>
    <div class="stack s cal-day-actions">${actions.map(a => `<button class="lrow press" data-a="${a[3]}">
      <div class="ic" style="background:${a[4]}1f;color:${a[4]}">${icon(a[0], 19)}</div>
      <div class="grow"><div class="tl">${a[1]}</div><div class="st">${a[2]}</div></div>${icon('fwd', 17)}
    </button>`).join('')}</div>`,
    footer: `<button class="btn p" data-a="cal.dayOpen">Открыть расписание дня</button>`,
  });
  window.__calDay = { sh, date, origin };
});

on('cal.dayOpen', () => {
  const x = window.__calDay;
  if (!x) return;
  cal.returnContext = x.origin.view === 'day' ? null : x.origin;
  cal.date = x.date;
  cal.view = 'day';
  cal.motion = 'switch';
  x.sh.close();
  setTimeout(() => { window.scrollTo(0, 0); rr(); }, 260);
});
on('cal.dayAdd', () => {
  const x = window.__calDay;
  if (!x) return;
  x.sh.close();
  setTimeout(() => newApptFlow({ date: x.date, employeeId: cal.empId }), 260);
});
on('cal.dayBlock', () => {
  const x = window.__calDay;
  if (!x) return;
  x.sh.close();
  setTimeout(() => blockFlow({ date: x.date, empId: cal.empId, kind: 'busy' }), 260);
});
on('cal.dayBreak', () => {
  const x = window.__calDay;
  if (!x) return;
  x.sh.close();
  setTimeout(() => blockFlow({ date: x.date, empId: cal.empId, kind: 'break' }), 260);
});
on('cal.dayAway', () => {
  const x = window.__calDay;
  if (!x) return;
  x.sh.close();
  setTimeout(() => absenceFlow({ date: x.date, empId: cal.empId }), 260);
});
on('cal.add', () => {
  const date = cal.view === 'range' ? calendarRange().from : cal.date;
  newApptFlow({ date, employeeId: cal.empId });
});

on('cal.custom', () => {
  const base = startOfDay(cal.date || today());
  const weekStart = addDays(base, -((base.getDay() + 6) % 7));
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  const initial = cal.rangeFrom && cal.rangeTo
    ? calendarRange()
    : cal.view === 'week'
      ? { from: weekStart, to: addDays(weekStart, 6) }
      : cal.view === 'month'
        ? { from: monthStart, to: new Date(base.getFullYear(), base.getMonth() + 1, 0) }
        : { from: base, to: base };
  const pick = { side: 'from', from: initial.from, to: initial.to, month: initial.from };
  const sh = sheet({ title: 'Свой период', body: '' });
  const draw = () => {
    sh.set({
      title: pick.side === 'from' ? 'С какого дня?' : 'По какой день?',
      body: `<div class="inp-row cal-range-picks">
        <button class="card flat press ${pick.side === 'from' ? 'on' : ''}" data-a="cr.from">
          <div class="tiny dim">С</div><div class="b">${dateFull(pick.from)}</div>
        </button>
        <button class="card flat press ${pick.side === 'to' ? 'on' : ''}" data-a="cr.to">
          <div class="tiny dim">По</div><div class="b">${dateFull(pick.to)}</div>
        </button>
      </div>
      ${monthGrid(pick.month, {
        selected: pick.side === 'from' ? pick.from : pick.to,
        action: 'cr.pick', navAction: 'cr.month',
        minDate: pick.side === 'to' ? pick.from : null,
        showCounts: false,
      })}`,
      footer: `<button class="btn p" data-a="cr.ok">Показать период</button>`,
    });
  };
  on('cr.from', () => { pick.side = 'from'; pick.month = pick.from; draw(); });
  on('cr.to', () => { pick.side = 'to'; pick.month = pick.to; draw(); });
  on('cr.month', ds => { pick.month = startOfDay(new Date(+ds.d)); draw(); });
  on('cr.pick', ds => {
    const value = startOfDay(new Date(+ds.d));
    if (pick.side === 'from') {
      pick.from = value;
      if (pick.to < value) pick.to = value;
      pick.side = 'to';
      pick.month = pick.to;
    } else pick.to = value;
    draw();
  });
  on('cr.ok', () => {
    cal.rangeFrom = pick.from;
    cal.rangeTo = pick.to;
    cal.date = pick.from;
    cal.view = 'range';
    cal.motion = 'switch';
    sh.close();
    rr();
  });
  draw();
});

/* §43 — тап по дате открывает календарь: можно уйти на любой день */
on('cal.pickDate', () => {
  let view = startOfDay(cal.date);
  const sh = sheet({ title: 'Выберите дату', body: '' });
  const draw = () => sh.set({
    title: 'Выберите дату',
    body: monthGrid(view, {
      selected: cal.date, action: 'cd.pick', navAction: 'cd.month',
      avail: d => dayAppts(d, { employeeId: cal.empId }).length || null,
      showCounts: true,
    }),
    footer: `<div class="btns">
      <button class="btn gh" data-a="cd.today">Сегодня</button>
      <button class="btn gh" data-a="cd.week">Эта неделя</button>
    </div>`,
  });
  on('cd.month', d2 => { view = startOfDay(new Date(+d2.d)); draw(); });
  on('cd.pick', d2 => { cal.date = startOfDay(new Date(+d2.d)); cal.motion = 'switch'; sh.close(); rr(); });
  on('cd.today', () => { cal.date = today(); cal.motion = 'today'; sh.close(); rr(); });
  on('cd.week', () => { cal.date = today(); cal.view = 'week'; cal.motion = 'switch'; sh.close(); rr(); });
  draw();
});

/* §50 — тап по свободному времени: четыре понятных действия */
on('cal.slot', ds => {
  const m = +ds.m;
  const items = [
    ['calendarPlus', 'Создать запись', 'Клиент придёт в ' + toHM(m), 'cal.slotAdd', '#4C6FFF'],
    ['lock', 'Заблокировать время', 'Занять слот под свои дела', 'cal.slotBlock', '#F79009'],
    ['coffee', 'Добавить перерыв', 'Обед или пауза', 'cal.slotBreak', '#8B5CF6'],
    ['gift', 'Отметить отсутствие', 'Отпуск, больничный, выходной', 'cal.slotAway', '#06AED4'],
  ];
  const s2 = sheet({
    title: toHM(m) + ' · ' + dateLabel(cal.date, now()).toLowerCase(),
    body: `<div class="stack s" style="padding-bottom:6px">${items.map(i => `
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd)" data-a="${i[3]}" data-m="${m}">
        <div class="ic" style="background:${i[4]}1f;color:${i[4]}">${icon(i[0], 20)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${i[1]}</div><div class="st">${i[2]}</div></div>
        ${icon('fwd', 18)}</button>`).join('')}</div>`,
  });
  window.__cs = s2;
});
on('cal.slotAdd', ds => { window.__cs && window.__cs.close(); setTimeout(() => newApptFlow({ date: cal.date, employeeId: cal.empId, startMin: +ds.m }), 260); });
on('cal.slotBlock', ds => { window.__cs && window.__cs.close(); setTimeout(() => blockFlow({ date: cal.date, empId: cal.empId, startMin: +ds.m, kind: 'busy' }), 260); });
on('cal.slotBreak', ds => { window.__cs && window.__cs.close(); setTimeout(() => blockFlow({ date: cal.date, empId: cal.empId, startMin: +ds.m, kind: 'break' }), 260); });
on('cal.slotAway', () => { window.__cs && window.__cs.close(); setTimeout(() => absenceFlow({ date: cal.date, empId: cal.empId }), 260); });

on('cal.unblock', async ds => {
  const b = blocks().find(x => x.id === ds.id);
  const k = b ? (ABSENCE[b.kind] || ABSENCE.other) : null;
  const ok = await confirmSheet({
    title: 'Снять «' + (b ? b.reason : 'блокировку') + '»?',
    text: 'Время снова станет доступным для записи.',
    ok: 'Снять', cancel: 'Оставить', danger: true,
  });
  if (ok) { removeBlock(ds.id); toast('Время освобождено'); }
});

/* уведомления (демо) */
route('o.notifications', {
  noTab: false, tab: 'o.home',
  render() {
    const n = now();
    const soon = appts().filter(a => a.status === 'planned' && new Date(a.start) > n).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 6);
    return `<div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button><div class="top-t">Уведомления</div></div>
    <div class="wrap stack s">
      ${soon.map(a => {
      const c = client(a.clientId);
      return `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="ap.card" data-id="${a.id}">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('bell', 18)}</div>
          <div class="grow" style="text-align:left">
            <div class="tl">${esc(c.name)} · ${hhmm(new Date(a.start))}</div>
            <div class="st">${dateLabel(new Date(a.start), n)} · ${esc(apptTitle(a))}</div>
          </div>${icon('fwd', 16)}</button>`;
    }).join('') || emptyState({ ic: 'bell', title: 'Уведомлений нет', text: 'Здесь появятся напоминания о ближайших записях.' })}
    </div>`;
  },
});
