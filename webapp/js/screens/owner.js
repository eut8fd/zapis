import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor, apptEnd,
  now, today, todayStats, rangeStats, nextAppt, dayAppts, blocks, me, toHM, toMin, workDay, companyHours,
  lostClients, clientStats, emit, freeGaps, removeBlock, ABSENCE, absenceOn,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, dateFull, nMin, nAppt, avatar, greet, WD, WD_FULL, MONTHS,
  dayKey, startOfDay, addDays, emptyState, sheet, toast, segmented, sparkline, num, plural,
  confirmSheet, monthGrid, MONTH_NAMES, MON_SHORT,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { openApptSheet, newApptFlow, blockFlow, quickAdd, dateStrip, absenceFlow } from '../flows.js';
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
    const upcoming = list.filter(a => apptEnd(a) > now());
    const lost = lostClients(cid(), 45);

    return `
    <div class="top">
      ${avatar({ initials: c.initials, color: c.color === '#0D1220' ? '#2B3340' : c.color, photo: c.logo }, 'm', 'av-sq')}
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

    <div class="sec">
      <div class="sec-h"><div class="sec-t">AI-помощник</div>
        <button class="sec-a" data-a="nav" data-r="ai.home">Открыть ${icon('fwd', 14, 2.4)}</button></div>
      <div class="wrap stack s">
        <button class="ai-card" style="width:100%;text-align:left" data-a="nav" data-r="ai.report">
          <div class="ic">${icon('sparkles', 19)}</div>
          <div class="grow">
            <div class="b sm">Итоги недели готовы</div>
            <div class="tiny muted" style="margin-top:2px">Выручка ${money(s7.revenue)}, ${s7.deltaRev >= 0 ? '+' : ''}${s7.deltaRev}% к прошлой неделе</div>
          </div>${icon('fwd', 16)}
        </button>
        ${lost.length ? `<button class="ai-card" style="width:100%;text-align:left" data-a="nav" data-r="ai.return">
          <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('users', 19)}</div>
          <div class="grow">
            <div class="b sm">${lost.length} ${plural(lost.length, ['клиент давно не был', 'клиента давно не были', 'клиентов давно не были'])}</div>
            <div class="tiny muted" style="margin-top:2px">Можно вернуть рассылкой с бонусом</div>
          </div>${icon('fwd', 16)}
        </button>` : ''}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Быстрые действия</div></div>
      <div class="wrap acts" style="margin-bottom:9px">
        <button class="act" data-a="qa.appt">${icon('calendarPlus', 21)}Запись</button>
        <button class="act" data-a="tm.add">${icon('userPlus', 21)}Мастер</button>
        <button class="act" data-a="qa.svc">${icon('briefcase', 21)}Услуга</button>
        <button class="act" data-a="qa.block">${icon('lock', 21)}Занять время</button>
      </div>
      <div class="wrap acts">
        <button class="act" data-a="nav" data-r="o.analytics">${icon('chart', 21)}Аналитика</button>
        <button class="act" data-a="nav" data-r="o.finance">${icon('wallet', 21)}Финансы</button>
        <button class="act" data-a="nav" data-r="o.services">${icon('grid', 21)}Все услуги</button>
        <button class="act" data-a="o.share">${icon('share', 21)}Ссылка</button>
      </div>
    </div>`;
  },
});

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
        ${avatar({ initials: c.initials, color: c.color === '#0D1220' ? '#2B3340' : c.color }, 'xl', 'av-sq')}
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
on('o.copyLink', async () => { await copy(bookingLink()); toast('Ссылка скопирована'); });
on('o.sendLink', () => {
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
const cal = { date: null, empId: null, view: 'day' };

route('o.cal', {
  tab: 'o.cal',
  fab: () => `<button class="fab" data-a="cal.add">${icon('plus', 26, 2.4)}</button>`,
  render() { return calendarScreen({ scope: 'company' }); },
});

export function calendarScreen({ scope = 'company', fixedEmp = null } = {}) {
  if (!cal.date) cal.date = today();
  if (fixedEmp) cal.empId = fixedEmp;
  // Фильтр мастера мог остаться от другой роли или компании — тогда календарь
  // молча показывал бы пустой день. Сбрасываем, если мастера здесь больше нет.
  else if (cal.empId && !staff().some(e => e.id === cal.empId)) cal.empId = null;
  const d = cal.date;
  const isToday = dayKey(d) === dayKey(now());
  const list = staff();
  const empId = fixedEmp || cal.empId;

  // §44 — в режиме недели показываем диапазон, а не одно число
  const wkStart = addDays(d, -((d.getDay() + 6) % 7)), wkEnd = addDays(wkStart, 6);
  const title = cal.view === 'month'
    ? MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear()
    : cal.view === 'week'
      ? (wkStart.getMonth() === wkEnd.getMonth()
        ? wkStart.getDate() + '–' + wkEnd.getDate() + ' ' + MONTHS[wkEnd.getMonth()]
        : wkStart.getDate() + ' ' + MON_SHORT[wkStart.getMonth()] + ' – ' + wkEnd.getDate() + ' ' + MON_SHORT[wkEnd.getMonth()])
      : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const sub = cal.view === 'day' ? (isToday ? 'сегодня' : WD_FULL[d.getDay()]) : '';

  return `
  <div class="top blur">
    <button class="ico-btn ${isToday && cal.view === 'day' ? '' : 'p'}" data-a="cal.today">${icon('calendar', 18)}</button>
    <button class="grow center" data-a="cal.pickDate" style="padding:0 4px">
      <div class="top-t center" style="font-size:16.5px">${title} ${icon('down', 14, 2.4)}</div>
      ${sub ? `<div class="top-sub center">${sub}</div>` : ''}
    </button>
    <button class="ico-btn" data-a="cal.prev">${icon('back', 18)}</button>
    <button class="ico-btn" data-a="cal.next">${icon('fwd', 18)}</button>
  </div>

  <div class="wrap" style="margin-bottom:12px">${segmented('cal.view',
    [{ v: 'day', t: 'День' }, { v: 'week', t: 'Неделя' }, { v: 'month', t: 'Месяц' }], cal.view)}</div>

  ${!fixedEmp && list.length > 1 ? `<div class="chips" style="margin-bottom:12px">
    <button class="chip ${!empId ? 'on' : ''}" data-a="cal.emp" data-id="">Все мастера</button>
    ${list.map(e => `<button class="chip ${empId === e.id ? 'on' : ''}" data-a="cal.emp" data-id="${e.id}"
      style="${empId === e.id ? 'background:' + e.color + ';border-color:transparent;color:#fff' : ''}">
      <i style="width:7px;height:7px;border-radius:50%;background:${e.color};display:inline-block"></i>${esc(e.name.split(' ')[0])}</button>`).join('')}
  </div>` : ''}

  ${periodStats(d, empId)}

  ${cal.view === 'day' ? dayView(d, empId) : cal.view === 'week' ? weekView(d, empId) : monthView(d, empId)}`;
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
  return `<div class="wrap" style="margin-bottom:12px">
    <div class="card flat" style="padding:11px 13px;display:flex;gap:12px;justify-content:space-between">
      <div><div class="tiny dim">Записей</div><div class="b" style="font-size:16px">${cnt}</div></div>
      <div><div class="tiny dim">Загрузка</div><div class="b" style="font-size:16px;color:${loadColor}">${load}%</div></div>
      <div><div class="tiny dim">Свободно окон</div><div class="b" style="font-size:16px">${gaps}</div></div>
      <div style="text-align:right"><div class="tiny dim">Ожидается</div><div class="b" style="font-size:16px">${moneyShort(rev)} ₸</div></div>
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
    cells.push(`<button class="wcol ${isT ? 'today' : ''}" data-a="cal.day" data-d="${day.getTime()}">
      <div class="w">${WD[day.getDay()]}</div><div class="n">${day.getDate()}</div>
      ${list.slice(0, 4).map(a => {
      const e = emp(a.employeeId);
      return `<div class="ev" style="background:${e ? e.color : apptColor(a)}">${hhmm(new Date(a.start))}</div>`;
    }).join('')}
      ${list.length > 4 ? `<div class="tiny dim">+${list.length - 4}</div>` : ''}
      ${!list.length ? '<div class="tiny dim">—</div>' : ''}
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

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="mv-cell mv-empty"></div>');
  for (let n = 1; n <= daysIn; n++) {
    const day = new Date(y, m, n);
    const list = dayAppts(day, { employeeId: empId });
    const busy = list.reduce((s, a) => s + a.duration, 0);
    let work = 0;
    team.forEach(e => { const w = workDay(e, day); if (w) work += toMin(w.to) - toMin(w.from); });
    const load = work ? Math.min(100, Math.round(busy / work * 100)) : 0;
    const off = !work;
    const away = team.some(e => absenceOn(day, e.id).length);
    const isT = dayKey(day) === dayKey(now());
    cells.push(`<button class="mv-cell ${isT ? 'today' : ''} ${off ? 'off' : ''}" data-a="cal.day" data-d="${day.getTime()}">
      <span class="d">${n}</span>
      ${list.length ? `<span class="cnt">${list.length}</span>` : off ? '<span class="cnt dim">вых</span>' : ''}
      ${away ? '<i class="away"></i>' : ''}
      <i class="bar" style="width:${load}%;background:${load > 70 ? 'var(--ok)' : load > 40 ? 'var(--warn)' : 'var(--p)'}"></i>
    </button>`);
  }
  return `<div class="wrap"><div class="mv-grid-wd">${['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="mv-grid">${cells.join('')}</div>
    <div class="mc-legend" style="margin-top:10px">
      <span><i style="background:var(--ok)"></i>плотный день</span>
      <span><i style="background:var(--p)"></i>есть места</span>
      <span><i style="background:#06AED4"></i>отсутствие</span>
    </div>
  </div>`;
}

on('cal.view', ds => { cal.view = ds.v; rr(); });
on('cal.emp', ds => { cal.empId = ds.id || null; rr(); });
on('cal.today', () => { cal.date = today(); rr(); });
on('cal.prev', () => {
  cal.date = cal.view === 'month'
    ? new Date(cal.date.getFullYear(), cal.date.getMonth() - 1, 1)
    : addDays(cal.date, cal.view === 'week' ? -7 : -1);
  rr();
});
on('cal.next', () => {
  cal.date = cal.view === 'month'
    ? new Date(cal.date.getFullYear(), cal.date.getMonth() + 1, 1)
    : addDays(cal.date, cal.view === 'week' ? 7 : 1);
  rr();
});
on('cal.day', ds => { cal.date = startOfDay(new Date(+ds.d)); cal.view = 'day'; rr(); });
on('cal.add', () => newApptFlow({ date: cal.date, employeeId: cal.empId }));

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
  on('cd.pick', d2 => { cal.date = startOfDay(new Date(+d2.d)); sh.close(); rr(); });
  on('cd.today', () => { cal.date = today(); sh.close(); rr(); });
  on('cd.week', () => { cal.date = today(); cal.view = 'week'; sh.close(); rr(); });
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
on('cal.slotBlock', ds => { window.__cs && window.__cs.close(); setTimeout(() => blockFlow({ date: cal.date, empId: cal.empId, startMin: +ds.m }), 260); });
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
