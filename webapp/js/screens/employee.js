import {
  S, co, cid, emp, staff, client, clients, appts, apptTitle, apptColor, apptEnd, now, today,
  todayStats, rangeStats, nextAppt, dayAppts, clientStats, workDay, me,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, relPast, avatar, greet, emptyState, nMin, nAppt, nVisit,
  plural, dayKey, WD_FULL, sheet, toast, progress,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { calendarScreen, apptRow } from './owner.js';
import { newApptFlow, openApptSheet, voiceNoteSheet } from '../flows.js';

const meId = () => S.session.employeeId;

route('e.home', {
  tab: 'e.home',
  fab: () => `<button class="fab" data-a="fab">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const e = emp(meId()) || staff()[0];
    const t = todayStats(cid(), e.id);
    const nx = nextAppt(cid(), e.id);
    const s30 = rangeStats(30);
    const mine = s30.byEmployee.find(x => x.name === e.name) || { count: 0, sum: 0 };
    const w = workDay(e, now());
    const c = nx ? client(nx.clientId) : null;

    return `
    <div class="top">
      ${avatar(e, 'm')}
      <div class="grow"><div class="top-t" style="font-size:17px">${greet(now().getHours())}, ${esc(e.name.split(' ')[0])}</div>
        <div class="top-sub">${w ? 'смена ' + w.from + '–' + w.to : 'сегодня выходной'} · ${esc(co().short)}</div></div>
      <button class="ico-btn" data-a="nav" data-r="e.profile">${icon('user', 19)}</button>
    </div>

    <div class="kpis" style="margin-top:6px">
      <div class="kpi"><div class="l">${icon('calendar', 13, 2)}Сегодня</div><div class="v">${t.count}</div><div class="d dim">${plural(t.count, ['запись', 'записи', 'записей'])}</div></div>
      <div class="kpi"><div class="l">${icon('wallet', 13, 2)}Заработано</div><div class="v">${moneyShort(t.revenue)} ₸</div><div class="d dim">из ${moneyShort(t.potential)} ₸</div></div>
      <div class="kpi"><div class="l">${icon('checkCircle', 13, 2)}Выполнено</div><div class="v">${t.done}/${t.count}</div><div class="d dim">визитов</div></div>
      <div class="kpi"><div class="l">${icon('chart', 13, 2)}Месяц</div><div class="v">${mine.count}</div><div class="d dim">${moneyShort(mine.sum)} ₸</div></div>
    </div>

    <div class="wrap sec">
      ${nx ? `<div class="hero">
        <div class="lb">Следующий клиент · ${Math.round((new Date(nx.start) - now()) / 60000) < 60 ? 'через ' + Math.round((new Date(nx.start) - now()) / 60000) + ' мин' : dateLabel(new Date(nx.start), now()).toLowerCase()}</div>
        <div class="tm">${hhmm(new Date(nx.start))}</div>
        <div class="nm">${esc(c ? c.name : '')}</div>
        <div class="sv">${esc(apptTitle(nx))} · ${nMin(nx.duration)}</div>
        <button class="btn" data-a="ap.card" data-id="${nx.id}">Открыть запись</button>
      </div>` : `<div class="card pad center" style="padding:26px">
        <div style="color:var(--tx-3);display:flex;justify-content:center;margin-bottom:8px">${icon('coffee', 30, 1.6)}</div>
        <div class="b">Записей больше нет</div><div class="sm muted">Можно выдохнуть</div></div>`}
    </div>

    ${nx && c && c.ai && (c.ai.prefs.length || c.ai.care.length) ? `<div class="wrap sec">
      <div class="card pad" style="background:var(--ai-soft);border-color:transparent">
        <div class="row" style="gap:8px;color:var(--ai);margin-bottom:7px">${icon('sparkles', 17)}<b class="sm">AI-шпаргалка перед визитом</b></div>
        <div class="sm" style="line-height:1.6;color:var(--tx-2)">
          ${[...c.ai.prefs, ...c.ai.care, ...c.ai.next].map(x => '• ' + esc(x)).join('<br>')}
        </div>
        <button class="btn xs gh" style="margin-top:11px" data-a="nav" data-r="o.client" data-id="${c.id}">Открыть клиента</button>
      </div></div>` : ''}

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Мой день</div>
        <button class="sec-a" data-a="tab" data-r="e.cal">Календарь ${icon('fwd', 14, 2.4)}</button></div>
      <div class="wrap stack s">
        ${t.list.length ? t.list.map(a => apptRow(a, { showEmp: false })).join('')
        : emptyState({ ic: 'coffee', title: 'Сегодня записей нет', text: 'Свободный день — можно отдохнуть.' })}
      </div>
    </div>`;
  },
});

route('e.cal', {
  tab: 'e.cal',
  fab: () => `<button class="fab" data-a="cal.add">${icon('plus', 26, 2.4)}</button>`,
  render() { return calendarScreen({ fixedEmp: meId() }); },
});

route('e.clients', {
  tab: 'e.clients',
  render() {
    const ids = new Set(appts().filter(a => a.employeeId === meId()).map(a => a.clientId));
    const list = Array.from(ids).map(id => ({ c: client(id), s: clientStats(id) })).filter(x => x.c)
      .sort((a, b) => (b.s.next ? 1 : 0) - (a.s.next ? 1 : 0) || b.s.spent - a.s.spent);
    return `
    <div class="top"><div class="grow"><div class="top-t">Мои клиенты</div><div class="top-sub">${list.length} человек</div></div></div>
    <div class="wrap stack s">
      ${list.length ? list.slice(0, 50).map(({ c, s }) => `
        <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="o.client" data-id="${c.id}">
          ${avatar(c, 'm')}
          <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
            <div class="st">${nVisit(s.visits)}${s.last ? ' · был ' + relPast(new Date(s.last.start), now()) : ''}</div>
            ${s.next ? `<div class="tiny" style="color:var(--p);font-weight:650;margin-top:2px">${icon('calendar', 11, 2.4)} ${dateLabel(new Date(s.next.start), now())}, ${hhmm(new Date(s.next.start))}</div>` : ''}
          </div>
          ${c.ai ? `<span class="bdg ai">${icon('sparkles', 11, 2.4)}</span>` : ''}
          <span class="chev">${icon('fwd', 18, 2)}</span></button>`).join('')
        : emptyState({ ic: 'users', title: 'Пока нет клиентов', text: 'После первой записи клиенты появятся здесь.' })}
    </div>`;
  },
});

route('e.profile', {
  tab: 'e.profile',
  render() {
    const e = emp(meId()) || staff()[0];
    const s30 = rangeStats(30);
    const mine = s30.byEmployee.find(x => x.name === e.name) || { count: 0, sum: 0 };
    const t = todayStats(cid(), e.id);
    return `
    <div class="top"><div class="grow"><div class="top-t">Профиль</div></div></div>
    <div class="center wrap">
      ${avatar(e, 'xl')}
      <div style="font-size:21px;font-weight:780;letter-spacing:-.03em;margin-top:12px">${esc(e.name)}</div>
      <div class="sm muted">${esc(e.role)} · ${esc(co().name)}</div>
      ${e.rating ? `<div class="row" style="justify-content:center;margin-top:8px"><span class="bdg warn">${icon('star', 11, 2.4)} ${e.rating}</span></div>` : ''}
    </div>
    <div class="wrap sec"><div class="grid3">
      <div class="st-card center"><div class="v">${t.count}</div><div class="l">сегодня</div></div>
      <div class="st-card center"><div class="v">${mine.count}</div><div class="l">за месяц</div></div>
      <div class="st-card center"><div class="v">${moneyShort(mine.sum)}</div><div class="l">₸ за месяц</div></div>
    </div></div>
    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="o.schedule" data-id="${e.id}">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('calendar', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Мой график</div><div class="st">Рабочие дни и перерывы</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="emp.svcs" data-id="${e.id}">
        <div class="ic" style="background:var(--ai-soft);color:var(--ai)">${icon('briefcase', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Мои услуги</div><div class="st">${e.serviceIds.length} услуг</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="dev.open">
        <div class="ic">${icon('shield', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Демо-режим</div><div class="st">Сменить роль или компанию</div></div>${icon('fwd', 17)}</button>
    </div></div>`;
  },
});
