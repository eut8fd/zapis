import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor, apptEnd,
  now, today, todayStats, rangeStats, nextAppt, dayAppts, blocks, me, toHM, toMin, workDay, companyHours,
  lostClients, clientStats, emit,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, dateFull, nMin, nAppt, avatar, greet, WD, WD_FULL, MONTHS,
  dayKey, startOfDay, addDays, emptyState, sheet, toast, segmented, sparkline, num, plural,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { openApptSheet, newApptFlow, blockFlow, quickAdd, dateStrip } from '../flows.js';
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
      <div class="av m av-sq" style="background:${c.color === '#0D1220' ? 'var(--tx)' : c.color}">${esc(c.initials)}</div>
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
  const d = cal.date;
  const isToday = dayKey(d) === dayKey(now());
  const list = staff();
  const empId = fixedEmp || cal.empId;

  return `
  <div class="top blur">
    <button class="ico-btn ${isToday ? '' : 'p'}" data-a="cal.today">${icon('calendar', 18)}</button>
    <div class="grow center">
      <div class="top-t center" style="font-size:17px">${d.getDate()} ${MONTHS[d.getMonth()]}</div>
      <div class="top-sub center">${isToday ? 'сегодня' : WD_FULL[d.getDay()]}</div>
    </div>
    <button class="ico-btn" data-a="cal.prev">${icon('back', 18)}</button>
    <button class="ico-btn" data-a="cal.next">${icon('fwd', 18)}</button>
  </div>

  <div class="wrap" style="margin-bottom:12px">${segmented('cal.view', [{ v: 'day', t: 'День' }, { v: 'week', t: 'Неделя' }], cal.view)}</div>

  ${!fixedEmp && list.length > 1 ? `<div class="chips" style="margin-bottom:12px">
    <button class="chip p ${!empId ? 'on' : ''}" data-a="cal.emp" data-id="">Все мастера</button>
    ${list.map(e => `<button class="chip p ${empId === e.id ? 'on' : ''}" data-a="cal.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}
  </div>` : ''}

  ${cal.view === 'day' ? dayView(d, empId) : weekView(d, empId)}`;
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

  // раскладка пересечений
  const items = list.map(a => {
    const s = new Date(a.start);
    return { a, s: s.getHours() * 60 + s.getMinutes(), e: s.getHours() * 60 + s.getMinutes() + a.duration };
  }).sort((x, z) => x.s - z.s);
  // группируем в кластеры пересекающихся записей — ширина считается внутри кластера
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const lanes = [];
    cluster.forEach(it => {
      let li = lanes.findIndex(l => l[l.length - 1].e <= it.s);
      if (li < 0) { lanes.push([it]); li = lanes.length - 1; } else lanes[li].push(it);
      it.lane = li;
    });
    cluster.forEach(it => { it.lanes = lanes.length; });
    cluster = [];
  };
  items.forEach(it => {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  });
  flush();

  const nowMin = now().getHours() * 60 + now().getMinutes();
  const showNow = dayKey(d) === dayKey(now()) && nowMin >= H0 * 60 && nowMin <= H1 * 60;

  if (!list.length && !blk.length) {
    return `<div class="tline" style="position:relative">${hours(H0, H1, PX, d, empId)}</div>
      ${emptyState({ ic: 'coffee', title: dayKey(d) === dayKey(now()) ? 'Сегодня свободный день' : 'Записей нет', text: 'Нажмите на свободное время, чтобы добавить запись.', action: 'Добавить запись', act: 'cal.add' })}`;
  }

  return `<div class="tline" style="position:relative">
    ${hours(H0, H1, PX, d, empId)}
    <div style="position:absolute;left:58px;right:16px;top:0;bottom:8px;pointer-events:none">
      ${items.map(it => {
        const a = it.a, c = apptColor(a), cl = client(a.clientId), e = emp(a.employeeId);
        const h = Math.max(30, a.duration / 60 * PX - 4);
        const w = 100 / (it.lanes || 1), left = it.lane * w;
        return `<button class="tl-ev ${h < 44 ? 'mini' : ''} ${a.status === 'done' ? 'done' : ''}" data-a="ap.card" data-id="${a.id}"
          style="pointer-events:auto;top:${y(it.s) + 2}px;height:${h}px;left:${left}%;width:calc(${w}% - 4px);--c:${c};--c-bg:${c}1a;${a.status === 'done' ? 'opacity:.62;' : ''}">
          <div class="n nowrap">${hhmm(new Date(a.start))} ${esc(cl ? cl.name.split(' ')[0] : '')}</div>
          <div class="s nowrap">${esc(apptTitle(a))}${e ? ' · ' + esc(e.name.split(' ')[0]) : ''}</div>
        </button>`;
      }).join('')}
      ${blk.map(b => {
        const s = new Date(b.start), e2 = new Date(b.end);
        const sm = s.getHours() * 60 + s.getMinutes(), em = e2.getHours() * 60 + e2.getMinutes();
        return `<button class="tl-ev block" data-a="cal.unblock" data-id="${b.id}" style="pointer-events:auto;top:${y(sm) + 2}px;height:${Math.max(26, (em - sm) / 60 * PX - 4)}px;left:0;width:100%">
          <div class="n nowrap">${icon('lock', 11, 2.4)} ${esc(b.reason)}</div></button>`;
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
      ${list.slice(0, 4).map(a => `<div class="ev" style="background:${apptColor(a)}">${hhmm(new Date(a.start))}</div>`).join('')}
      ${list.length > 4 ? `<div class="tiny dim">+${list.length - 4}</div>` : ''}
      ${!list.length ? '<div class="tiny dim">—</div>' : ''}
    </button>`);
  }
  const total = [0, 1, 2, 3, 4, 5, 6].reduce((s, i) => s + dayAppts(addDays(start, i), { employeeId: empId }).length, 0);
  const rev = [0, 1, 2, 3, 4, 5, 6].reduce((s, i) => s + dayAppts(addDays(start, i), { employeeId: empId }).reduce((x, a) => x + a.price, 0), 0);
  return `<div class="wgrid">${cells.join('')}</div>
    <div class="wrap sec"><div class="grid2">
      <div class="st-card"><div class="l">Записей за неделю</div><div class="v">${total}</div></div>
      <div class="st-card"><div class="l">Ожидаемая выручка</div><div class="v">${moneyShort(rev)} ₸</div></div>
    </div></div>`;
}

on('cal.view', ds => { cal.view = ds.v; rr(); });
on('cal.emp', ds => { cal.empId = ds.id || null; rr(); });
on('cal.today', () => { cal.date = today(); rr(); });
on('cal.prev', () => { cal.date = addDays(cal.date, cal.view === 'week' ? -7 : -1); rr(); });
on('cal.next', () => { cal.date = addDays(cal.date, cal.view === 'week' ? 7 : 1); rr(); });
on('cal.day', ds => { cal.date = startOfDay(new Date(+ds.d)); cal.view = 'day'; rr(); });
on('cal.add', () => newApptFlow({ date: cal.date, employeeId: cal.empId }));
on('cal.slot', ds => {
  const m = +ds.m;
  const s = sheet({
    title: toHM(m) + ' · ' + dateLabel(cal.date, now()).toLowerCase(),
    body: `<div class="stack s" style="padding-bottom:6px">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd)" data-a="cal.slotAdd" data-m="${m}">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('calendarPlus', 20)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Добавить запись</div><div class="st">Клиент придёт в ${toHM(m)}</div></div>
        ${icon('fwd', 18)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd)" data-a="cal.slotBlock" data-m="${m}">
        <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('lock', 20)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Заблокировать время</div><div class="st">Перерыв или личные дела</div></div>
        ${icon('fwd', 18)}</button>
    </div>`,
  });
  window.__cs = s;
});
on('cal.slotAdd', ds => { window.__cs && window.__cs.close(); setTimeout(() => newApptFlow({ date: cal.date, employeeId: cal.empId, startMin: +ds.m }), 260); });
on('cal.slotBlock', ds => { window.__cs && window.__cs.close(); setTimeout(() => blockFlow({ date: cal.date, empId: cal.empId, startMin: +ds.m }), 260); });
on('cal.unblock', async ds => {
  const ok = await import('../ui.js').then(m => m.confirmSheet({ title: 'Снять блокировку?', text: 'Время снова станет доступным для записи.', ok: 'Снять', danger: true }));
  if (ok) { const { removeBlock } = await import('../store.js'); removeBlock(ds.id); toast('Блокировка снята'); }
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
