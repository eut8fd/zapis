import {
  S, co, cid, allCompanies, emps, clients, appts, saStats, companyStats, setPlan, setCompanyStatus,
  now, today, rangeStats, emit, extendPlan,
  plans, planById, planPrice, planMonthly, updatePlan, addPlan, removePlan, PERIODS,
  notices, addNotice, removeNotice, NOTICE_KINDS, saSegments, saBroadcasts, addSaBroadcast,
  logs, logEvent, LOG_KINDS, errors, reportError, resolveError, clearResolvedErrors,
  tickets, addTicket, replyTicket, setTicketStatus, TICKET_STATUS, TICKET_TOPICS,
  bans, activeBan, banEntity, liftBan, BAN_REASONS, platformUsers, platformHealth,
} from '../store.js';
import {
  esc, money, moneyShort, num, dateLabel, relPast, avatar, emptyState, sheet, toast, confirmSheet,
  segmented, bars, sparkline, progress, plural, dayKey, startOfDay, MONTHS, wait, loadingBlock,
  promptSheet, donut,
} from '../ui.js';
import { copy } from '../tg.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';

const rr = () => render(false);
const PLAN_IDS = () => plans().map(p => p.id);

/* =========================================================
   Обзор
   ========================================================= */
/* Что требует ответа прямо сейчас. Раньше жалобы и обращения лежали
   в «Системе» третьим пунктом вглубь: узнать о них можно было, только
   если специально пойти искать. На обзоре они первым экраном. */
function needsAttention() {
  const all = tickets();
  // Не по from: клиент теперь пишет и обычные вопросы о приложении,
  // а жалоба на компанию — это тема, а не источник.
  const complaints = all.filter(t => t.topic === 'complaint' && t.status !== 'closed');
  const support = all.filter(t => t.topic !== 'complaint' && t.status !== 'closed');
  const errs = (S.data.errors || []).filter(e => !e.fixed).length;
  if (!complaints.length && !support.length && !errs) return '';

  const row = (n, title, sub, color, ic, act) => n ? `
    <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="${act}">
      <div class="ic" style="background:${color}1f;color:${color}">${icon(ic, 19)}</div>
      <div class="grow" style="text-align:left"><div class="tl">${title}</div><div class="st">${sub}</div></div>
      <span class="bdg" style="background:${color}1f;color:${color}">${n}</span>
      <span class="chev">${icon('fwd', 17, 2)}</span>
    </button>` : '';

  return `<div class="wrap sec">
    <div class="sec-h" style="padding:0 0 8px"><div class="sec-t">Требует внимания</div></div>
    <div class="stack s">
      ${row(complaints.length, 'Жалобы на компании', 'Клиенты жалуются — нужно разобрать', '#F04462', 'shield', 'sa.toComplaints')}
      ${row(support.length, 'Обращения в поддержку', 'Вопросы владельцев и клиентов', '#8B5CF6', 'msg', 'sa.toTickets')}
      ${row(errs, 'Ошибки приложения', 'Сбои у пользователей', '#F79009', 'alert', 'sa.toErrors')}
    </div>
  </div>`;
}

on('sa.toComplaints', () => { tkf.status = 'complaint'; go('sa.tickets'); });
on('sa.toTickets', () => { tkf.status = 'open'; go('sa.tickets'); });
on('sa.toErrors', () => go('sa.errors'));

route('sa.home', {
  tab: 'sa.home',
  render() {
    const s = saStats();
    const cs = allCompanies();
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(startOfDay(now()).getTime() - i * 86400000);
      series.push(S.data.appointments.filter(a => dayKey(new Date(a.start)) === dayKey(d) && a.status !== 'cancelled').length);
    }
    const recent = cs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);

    return `
    <div class="top">
      <div class="av m av-sq" style="background:linear-gradient(135deg,var(--tx),var(--tx-2))">${icon('shield', 20)}</div>
      <div class="grow"><div class="top-t">Super Admin</div><div class="top-sub">Zapis SaaS · панель управления</div></div>
    </div>

    <div class="wrap">
      <div class="hero" style="background:linear-gradient(135deg,#0F172A,#334155 60%,#4C6FFF)">
        <div class="lb">MRR</div>
        <div class="tm" style="font-size:32px">${money(s.mrr)}</div>
        <div class="hero-meta">
          <span>${icon('building', 13, 2)} ${s.active} активных из ${s.companies}</span>
          <span>${icon('trendUp', 13, 2)} +${Math.round(s.mrr * 0.12 / 1000)}K к прошлому</span>
        </div>
      </div>
    </div>

    ${needsAttention()}

    <div class="wrap sec"><div class="grid2">
      <div class="st-card"><div class="l">Компании</div><div class="v">${s.companies}</div>
        <div class="tiny ${s.newThisMonth ? 'up' : 'dim'}">${s.newThisMonth ? '+' + s.newThisMonth : '0'} за месяц</div></div>
      <div class="st-card"><div class="l">Активные подписки</div><div class="v">${s.active}</div><div class="tiny dim">${Math.round(s.active / s.companies * 100)}% базы</div></div>
      <div class="st-card"><div class="l">Пользователи</div><div class="v">${num(s.users)}</div><div class="tiny dim">сотрудники</div></div>
      <div class="st-card"><div class="l">Клиенты</div><div class="v">${num(s.clients)}</div><div class="tiny dim">во всех компаниях</div></div>
    </div></div>

    <div class="wrap sec">
      <div class="card pad">
        <div class="row between" style="margin-bottom:10px">
          <div><div class="tiny muted b">НОВЫЕ РЕГИСТРАЦИИ</div>
            <div style="font-size:24px;font-weight:780;letter-spacing:-.03em">${s.newThisMonth}</div></div>
          <div class="tiny dim">за 6 месяцев</div>
        </div>
        ${bars(s.signups.map(x => x.count), { labels: s.signups.map(x => x.label), height: 92, fmt: v => v + '' })}
      </div>
    </div>

    <div class="wrap sec">
      <div class="row between" style="margin-bottom:8px"><div class="sec-t">Распределение по тарифам</div>
        <button class="sec-a" data-a="nav" data-r="sa.plans">Тарифы ${icon('fwd', 13, 2.4)}</button></div>
      <div class="card pad row" style="gap:16px;align-items:center">
        <div style="flex:none">${donut(s.byPlan.filter(p => p.count).map(p => ({ value: p.count, color: p.color })), { size: 104, thick: 13 })}</div>
        <div class="grow stack" style="gap:8px">
          ${s.byPlan.map(p => `<div class="row between" style="align-items:center;gap:8px">
            <span class="row" style="gap:7px;min-width:0"><i style="width:9px;height:9px;border-radius:3px;background:${p.color};flex:none"></i>
              <span class="sm b nowrap">${esc(p.name)}</span></span>
            <span class="tiny muted nowrap">${p.count} · ${moneyShort(p.mrr)} ₸</span>
          </div>`).join('')}
          <div class="row between" style="border-top:1px solid var(--bd);padding-top:8px">
            <span class="tiny dim">ARPU</span><span class="b sm">${money(s.arpu)}</span></div>
        </div>
      </div>
    </div>

    <div class="wrap sec">
      <div class="card pad">
        <div class="row between" style="margin-bottom:10px">
          <div><div class="tiny muted b">ЗАПИСЕЙ СЕГОДНЯ</div>
            <div style="font-size:24px;font-weight:780;letter-spacing:-.03em">${s.todayAppts}</div></div>
          <div class="tiny dim">всего ${num(s.totalAppts)}</div>
        </div>
        ${bars(series, { height: 90 })}
        <div class="tiny dim center" style="margin-top:8px">Активность за 14 дней</div>
      </div>
    </div>

    ${s.expiring.length ? `<div class="sec">
      <div class="sec-h"><div class="sec-t">Проблемные подписки</div><span class="bdg dan">${s.expiring.length}</span></div>
      <div class="wrap stack s">
        ${s.expiring.map(c => {
      const d = Math.ceil((new Date(c.planUntil) - now()) / 86400000);
      return `<button class="lrow press" style="border-radius:16px;border:1px solid var(--dan-soft);background:var(--dan-soft);width:100%" data-a="nav" data-r="sa.company" data-id="${c.id}">
            <div class="ic" style="background:var(--dan);color:#fff">${icon('alert', 18)}</div>
            <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
              <div class="st">${c.plan} · истекает через ${d} ${plural(d, ['день', 'дня', 'дней'])}</div></div>
            ${icon('fwd', 17)}</button>`;
    }).join('')}
      </div></div>` : ''}

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Последние регистрации</div>
        <button class="sec-a" data-a="tab" data-r="sa.companies">Все ${icon('fwd', 14, 2.4)}</button></div>
      <div class="wrap stack s">${recent.map(c => companyRow(c)).join('')}</div>
    </div>`;
  },
});

function companyRow(c) {
  const st = companyStats(c.id);
  const days = Math.ceil((new Date(c.planUntil) - now()) / 86400000);
  const blocked = c.status === 'blocked';
  return `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.company" data-id="${c.id}">
    ${avatar({ initials: c.initials, color: c.color, photo: c.logo }, 'm', 'av-sq')}
    <div class="grow" style="text-align:left">
      <div class="tl">${esc(c.name)}</div>
      <div class="st">${esc(c.cat)} · ${esc(c.city)}</div>
      <div class="tiny nowrap" style="margin-top:3px;color:var(--tx-3)">${st.team} сотр. · ${st.clients} клиентов · ${st.appts} записей</div>
    </div>
    <div class="col" style="align-items:flex-end;gap:4px">
      <span class="bdg ${blocked ? 'dan' : days > 10 ? 'ok' : 'warn'}">${blocked ? 'блок' : c.plan}</span>
      <span class="tiny dim">${blocked ? '' : days > 0 ? days + ' дн.' : 'истёк'}</span>
    </div>
  </button>`;
}

/* =========================================================
   Компании
   ========================================================= */
const saf = { q: '', f: 'all' };
route('sa.companies', {
  tab: 'sa.companies',
  render() {
    let list = allCompanies();
    if (saf.f === 'active') list = list.filter(c => c.status !== 'blocked' && new Date(c.planUntil) > now());
    if (saf.f === 'problem') list = list.filter(c => c.status === 'blocked' || (new Date(c.planUntil) - now()) / 86400000 < 10);
    if (saf.q) list = list.filter(c => c.name.toLowerCase().includes(saf.q.toLowerCase()));
    return `
    <div class="top"><div class="grow"><div class="top-t">Компании</div><div class="top-sub">${allCompanies().length} в системе</div></div></div>
    <div class="wrap" style="margin-bottom:12px">
      <div class="search">${icon('search', 18)}<input id="_sq" placeholder="Поиск компании" value="${esc(saf.q)}"></div>
    </div>
    <div class="chips" style="margin-bottom:12px">
      ${[['all', 'Все'], ['active', 'Активные'], ['problem', 'Проблемные']].map(f => `<button class="chip ${saf.f === f[0] ? 'on' : ''}" data-a="sa.f" data-v="${f[0]}">${f[1]}</button>`).join('')}
    </div>
    <div class="wrap stack s">
      ${list.length ? list.map(c => companyRow(c)).join('') : emptyState({ ic: 'building', title: 'Ничего не найдено' })}
    </div>`;
  },
  mount(p, root) {
    const i = root.querySelector('#_sq');
    if (i) i.oninput = e => { saf.q = e.target.value; const pos = e.target.selectionStart; rr(); const n = document.querySelector('#_sq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  },
});
on('sa.f', ds => { saf.f = ds.v; rr(); });

/* =========================================================
   Карточка компании
   ========================================================= */
route('sa.company', {
  tab: 'sa.companies',
  render(p) {
    const c = allCompanies().find(x => x.id === p.id);
    if (!c) return emptyState({ ic: 'building', title: 'Компания не найдена' });
    const st = companyStats(c.id);
    const owner = S.data.employees.find(e => e.companyId === c.id && e.isOwner);
    const days = Math.ceil((new Date(c.planUntil) - now()) / 86400000);
    const blocked = c.status === 'blocked';
    const s30 = rangeStats(30, c.id);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button><div class="grow"></div>
      <button class="ico-btn" data-a="sa.enter" data-id="${c.id}">${icon('logout', 18)}</button></div>

    <div class="center wrap">
      ${avatar({ initials: c.initials, color: c.color, photo: c.logo }, 'xl', 'av-sq')}
      <div style="font-size:21px;font-weight:780;letter-spacing:-.03em;margin-top:12px">${esc(c.name)}</div>
      <div class="sm muted">${esc(c.cat)} · ${esc(c.city)}</div>
      <div class="row" style="justify-content:center;gap:6px;margin-top:8px">
        <span class="bdg ${blocked ? 'dan' : days > 0 ? 'ok' : 'warn'}"><i class="dot ${blocked || days <= 0 ? 'off' : ''}"></i>${blocked ? 'Заблокирована' : days > 0 ? 'Активна' : 'Истекла'}</span>
        <span class="bdg p">${esc(c.plan)}</span>
      </div>
    </div>

    <div class="wrap sec"><div class="grid2">
      <div class="st-card"><div class="l">Команда</div><div class="v">${st.team}</div></div>
      <div class="st-card"><div class="l">Клиенты</div><div class="v">${num(st.clients)}</div></div>
      <div class="st-card"><div class="l">Записи</div><div class="v">${num(st.appts)}</div></div>
      <div class="st-card"><div class="l">Оборот</div><div class="v">${moneyShort(st.revenue)} ₸</div></div>
    </div></div>

    <div class="wrap sec"><div class="card pad">
      <div class="row between"><span class="sm muted">Владелец</span><b>${esc(owner ? owner.name : '—')}</b></div>
      <div class="hr"></div>
      <div class="row between"><span class="sm muted">Телефон</span><b>${esc(c.phone)}</b></div>
      <div class="hr"></div>
      <div class="row between"><span class="sm muted">Создана</span><b>${new Date(c.createdAt).getDate()} ${MONTHS[new Date(c.createdAt).getMonth()]} ${new Date(c.createdAt).getFullYear()}</b></div>
      <div class="hr"></div>
      <div class="row between"><span class="sm muted">Подписка</span><b>${esc(c.plan)} ${days > 0 ? 'до ' + new Date(c.planUntil).getDate() + ' ' + MONTHS[new Date(c.planUntil).getMonth()] : '— истекла'}</b></div>
      <div class="hr"></div>
      <div class="row between"><span class="sm muted">Выручка за 30 дней</span><b>${money(s30.revenue)}</b></div>
    </div></div>

    <div class="wrap sec"><div class="btns">
      <button class="btn p" data-a="sa.extend" data-id="${c.id}">${icon('refresh', 17)}Продлить</button>
      <button class="btn gh" data-a="sa.plan" data-id="${c.id}">${icon('crown', 17)}Тариф</button>
    </div></div>

    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="sa.coLog" data-id="${c.id}">
        <div class="ic" style="background:var(--sf-3)">${icon('history', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Журнал компании</div>
          <div class="st">${logs().filter(l => l.companyId === c.id).length} событий</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="sa.coTickets" data-id="${c.id}">
        <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('msg', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Обращения</div>
          <div class="st">${tickets().filter(t => t.companyId === c.id).length} всего</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.users" data-co="${c.id}">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('users', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Люди компании</div>
          <div class="st">${platformUsers({ companyId: c.id }).length} сотрудников и клиентов</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--dan-soft);background:var(--dan-soft);width:100%" data-a="sa.danger" data-id="${c.id}">
        <div class="ic" style="background:var(--dan);color:#fff">${icon('alert', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl" style="color:var(--dan)">Опасная зона</div>
          <div class="st">${activeBan('company', c.id) ? 'Компания заблокирована' : 'Заморозка и блокировка'}</div></div>
        ${icon('fwd', 17)}
      </button>
    </div></div>`;
  },
});

on('sa.extend', async ds => {
  const s = sheet({ title: 'Продление', body: loadingBlock('Продлеваем подписку…') });
  await wait(1000);
  // продлеваем ровно на период тарифа: у годового это не 30 дней
  const days = extendPlan(ds.id);
  s.close(); toast('Подписка продлена на ' + days + ' ' + plural(days, ['день', 'дня', 'дней']));
});
on('sa.plan', ds => {
  const c = allCompanies().find(x => x.id === ds.id);
  const s = sheet({
    title: 'Сменить тариф',
    body: `<div class="stack s">${plans().map(p => `<button class="role ${c.plan === p.id ? 'on' : ''}" style="width:100%" data-a="sa.setPlan" data-id="${c.id}" data-p="${p.id}">
      <div class="t">${esc(p.name)}</div><div class="s">${money(p.price)} / ${(PERIODS[p.period] || PERIODS.month).t}</div></button>`).join('')}</div>`,
  });
  window.__sp = s;
});
on('sa.setPlan', ds => { setPlan(ds.id, ds.p, null); window.__sp.close(); toast('Тариф изменён на ' + ds.p); });
on('sa.coLog', ds => {
  const list = logs().filter(l => l.companyId === ds.id).sort((a, b) => new Date(b.at) - new Date(a.at));
  sheet({
    title: 'Журнал · ' + coName(ds.id),
    body: list.length ? `<div class="stack s">${list.slice(0, 40).map(l => {
      const k = LOG_KINDS[l.kind] || LOG_KINDS.system;
      return `<div class="row" style="gap:10px;align-items:flex-start">
        <div class="tint" style="width:30px;height:30px;flex:none;background:${k.color}1f;color:${k.color}">${icon(k.icon, 15)}</div>
        <div class="grow"><div class="sm" style="line-height:1.4">${esc(l.text)}</div>
          <div class="tiny dim" style="margin-top:2px">${relPast(new Date(l.at), now())}</div></div>
      </div>`;
    }).join('')}</div>` : '<div class="center sm muted" style="padding:14px 0">Событий по этой компании нет</div>',
  });
});
on('sa.coTickets', ds => {
  const list = tickets().filter(t => t.companyId === ds.id);
  sheet({
    title: 'Обращения · ' + coName(ds.id),
    body: list.length ? `<div class="stack s">${list.map(t => {
      const st = TICKET_STATUS[t.status];
      return `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="tk.open" data-id="${t.id}">
        <div class="grow" style="text-align:left"><div class="tl">${esc(t.subject)}</div>
          <div class="st">${esc(TICKET_TOPICS[t.topic] || t.topic)} · ${relPast(new Date(t.updatedAt), now())}</div></div>
        <span class="bdg" style="background:${st.color}1f;color:${st.color}">${st.t}</span></button>`;
    }).join('')}</div>` : '<div class="center sm muted" style="padding:14px 0">Обращений от этой компании нет</div>',
  });
});
on('sa.enter', async ds => {
  const ok = await confirmSheet({ title: 'Войти как владелец?', text: 'Откроется кабинет этой компании — удобно для поддержки.', ok: 'Войти' });
  if (!ok) return;
  S.session.role = 'owner';
  S.session.companyId = ds.id;
  S.session.employeeId = S.data.employees.find(e => e.companyId === ds.id && e.isOwner).id;
  S.session.clientId = S.data.clients.find(c => c.companyId === ds.id).id;
  logEvent('auth', 'Вход в кабинет компании из поддержки', { companyId: ds.id });
  emit(); go('o.home', {}, { root: true }); toast('Вы в кабинете компании');
});
on('sa.danger', ds => {
  const c = allCompanies().find(x => x.id === ds.id);
  const blocked = c.status === 'blocked';
  const s = sheet({
    title: 'Опасная зона',
    body: `<div class="sm muted" style="margin-bottom:14px">Эти действия влияют на работу компании. Применяйте осознанно.</div>
      <div class="stack s">
        <button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="sa.freeze" data-id="${c.id}">
          <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('lock', 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl">Заморозить</div><div class="st">Онлайн-запись перестанет работать</div></div></button>
        <button class="lrow press" style="border-radius:14px;border:1px solid var(--dan-soft);background:var(--dan-soft);width:100%" data-a="sa.block" data-id="${c.id}">
          <div class="ic" style="background:var(--dan);color:#fff">${icon('ban', 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl" style="color:var(--dan)">${blocked ? 'Разблокировать' : 'Заблокировать'}</div>
            <div class="st">${blocked ? 'Вернуть доступ компании' : 'Полностью закрыть доступ'}</div></div></button>
      </div>`,
  });
  window.__sd = s;
});
on('sa.freeze', async ds => {
  const ok = await confirmSheet({ title: 'Заморозить компанию?', text: 'Клиенты не смогут записываться онлайн до разморозки.', ok: 'Заморозить', danger: true });
  if (!ok) return;
  setPlan(ds.id, allCompanies().find(c => c.id === ds.id).plan, 0);
  window.__sd.close(); toast('Компания заморожена', 'dan');
});
on('sa.block', ds => {
  const c = allCompanies().find(x => x.id === ds.id);
  window.__sd && window.__sd.close();
  if (c.status === 'blocked' || activeBan('company', ds.id)) {
    liftBan('company', ds.id);
    setCompanyStatus(ds.id, null);
    toast('Компания разблокирована');
    rr();
    return;
  }
  // причина и срок обязательны: без них потом не разобраться, за что закрыли
  setTimeout(() => banSheet('company', ds.id), 240);
});

/* =========================================================
   Система
   ========================================================= */
route('sa.settings', {
  tab: 'sa.settings',
  render() {
    const s = saStats();
    return `
    <div class="top"><div class="grow"><div class="top-t">Система</div><div class="top-sub">Zapis SaaS</div></div></div>
    <div class="wrap sec" style="margin-top:4px"><div class="grid2">
      <div class="st-card"><div class="l">Версия</div><div class="v" style="font-size:16px">2.0 demo</div></div>
      <div class="st-card"><div class="l">Записей всего</div><div class="v">${num(s.totalAppts)}</div></div>
    </div></div>

    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid ${s.health.errors24 ? 'var(--dan-soft)' : 'var(--bd)'};${s.health.errors24 ? 'background:var(--dan-soft)' : ''};width:100%" data-a="nav" data-r="sa.health">
        <div class="ic" style="background:${s.health.errors24 ? 'var(--dan);color:#fff' : 'var(--ok-soft);color:var(--ok)'}">${icon(s.health.errors24 ? 'alert' : 'checkCircle', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Состояние платформы</div>
          <div class="st">${s.health.errors24 ? s.health.errors24 + ' ошибок за сутки' : 'Ошибок за сутки нет'} · хранилище ${s.health.storagePct}%</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.tickets">
        <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('msg', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Обращения</div>
          <div class="st">${s.health.ticketsNew ? s.health.ticketsNew + ' без ответа' : 'Новых нет'} · всего открыто ${s.health.ticketsOpen}</div></div>
        ${s.health.ticketsNew ? `<span class="bdg dan">${s.health.ticketsNew}</span>` : ''}${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.errors">
        <div class="ic" style="background:var(--dan-soft);color:var(--dan)">${icon('alert', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Ошибки</div>
          <div class="st">${s.health.errorsOpen} открытых</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.logs">
        <div class="ic" style="background:var(--sf-3)">${icon('history', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Журнал событий</div>
          <div class="st">${s.health.logs} записей</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.users">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('users', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Люди платформы</div>
          <div class="st">${num(s.users + s.clients)} сотрудников и клиентов</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.bans">
        <div class="ic" style="background:${s.health.bansActive ? 'var(--dan-soft);color:var(--dan)' : 'var(--sf-3)'}">${icon('ban', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Блокировки</div>
          <div class="st">${s.health.bansActive ? s.health.bansActive + ' активных' : 'Активных нет'}</div></div>${icon('fwd', 17)}</button>
    </div></div>
    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.plans">
        <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('crown', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Тарифы</div>
          <div class="st">${plans().length} ${plural(plans().length, ['тариф', 'тарифа', 'тарифов'])} · название, цена, лимиты</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.mail">
        <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('megaphone', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Рассылки по компаниям</div>
          <div class="st">Все, по тарифу, активные и неактивные</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.notices">
        <div class="ic" style="background:var(--ai-soft);color:var(--ai)">${icon('bell', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Системные уведомления</div>
          <div class="st">${notices().length} ${plural(notices().length, ['отправлено', 'отправлено', 'отправлено'])}</div></div>${icon('fwd', 17)}</button>
    </div></div>
    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="dev.open">
        <div class="ic">${icon('shield', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Демо-панель</div><div class="st">Роли, компании, тестовая дата</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="set.reset">
        <div class="ic">${icon('refresh', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Сбросить демо-данные</div><div class="st">Вернуть исходное состояние</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--dan-soft);background:var(--dan-soft);width:100%" data-a="sa.lock">
        <div class="ic" style="background:var(--dan);color:#fff">${icon('lock', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl" style="color:var(--dan)">Выйти из Super Admin</div>
          <div class="st">Закрыть доступ на этом устройстве</div></div></button>
    </div></div>
    <div class="wrap sec"><div class="card pad">
      <div class="row" style="gap:8px;color:var(--tx-2);margin-bottom:6px">${icon('shield', 17)}<b class="sm">Как защищён доступ</b></div>
      <div class="sm muted" style="line-height:1.5">Панель открывается только по Telegram ID из белого списка или по секретному коду.
      В приложении хранится лишь SHA-256 кода. Список ID и код меняются командой
      <b>scripts/set-admin-code.ps1</b>.</div>
    </div></div>`;
  },
});

/* =========================================================
   Тарифы (§100–§102)
   Раньше сетка была захардкожена; теперь это данные, и цену,
   период, лимиты и список функций правят прямо здесь.
   ========================================================= */
route('sa.plans', {
  tab: 'sa.settings',
  fab: () => `<button class="fab" data-a="pl.add">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const s = saStats();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Тарифы</div><div class="top-sub">MRR ${money(s.mrr)} · ARPU ${money(s.arpu)}</div></div></div>

    <div class="wrap stack">
      ${s.byPlan.map(p => `<div class="card pad" style="${p.active === false ? 'opacity:.6;' : ''}border-left:3px solid ${p.color}">
        <div class="row between" style="margin-bottom:8px">
          <div><div class="b" style="font-size:17px">${esc(p.name)}${p.active === false ? ' <span class="bdg">скрыт</span>' : ''}</div>
            <div class="tiny muted">${money(p.price)} / ${(PERIODS[p.period] || PERIODS.month).t}${p.period !== 'month' ? ' · ' + money(planMonthly(p.id)) + ' в месяц' : ''}</div></div>
          <button class="btn xs gh" style="width:auto" data-a="pl.edit" data-id="${p.id}">${icon('pencil', 14)}Изменить</button>
        </div>
        <div class="row" style="gap:14px;margin:10px 0 8px">
          <div><div class="tiny dim">Компаний</div><div class="b sm">${p.count}</div></div>
          <div><div class="tiny dim">Активных</div><div class="b sm">${p.activeCount}</div></div>
          <div><div class="tiny dim">MRR</div><div class="b sm">${moneyShort(p.mrr)} ₸</div></div>
        </div>
        ${progress(p.count / Math.max(1, s.companies) * 100, p.color)}
        <div class="tiny dim" style="margin-top:6px">${Math.round(p.count / Math.max(1, s.companies) * 100)}% всех компаний</div>
        <div class="hr"></div>
        <div class="tiny muted b" style="margin-bottom:6px">ЛИМИТЫ</div>
        <div class="row" style="gap:14px;flex-wrap:wrap">
          ${[['staff', 'сотрудников'], ['services', 'услуг'], ['broadcasts', 'рассылок в месяц']].map(l =>
      `<div class="tiny" style="color:var(--tx-2)"><b>${(p.limits || {})[l[0]] ? p.limits[l[0]] : '∞'}</b> ${l[1]}</div>`).join('')}
        </div>
        <div class="hr"></div>
        <div class="stack" style="gap:5px">
          ${(p.feats || []).map(f => `<div class="row sm" style="gap:7px;color:var(--tx-2)"><span style="color:var(--ok)">${icon('check', 14, 2.6)}</span>${esc(f)}</div>`).join('')}
        </div>
      </div>`).join('')}
    </div>
    <div class="wrap sec"><div class="tiny dim center">Изменение цены действует для новых оплат. У текущих подписок цена сохраняется до продления.</div></div>`;
  },
});

function planSheet(id) {
  const editing = id ? planById(id) : null;
  const st = {
    name: editing ? editing.name : '',
    price: editing ? String(editing.price) : '',
    period: editing ? editing.period : 'month',
    feats: editing ? (editing.feats || []).slice() : [],
    limits: editing ? { ...(editing.limits || {}) } : { staff: 0, services: 0, broadcasts: 0 },
    active: editing ? editing.active !== false : true,
  };
  const s = sheet({ title: '', body: '' });
  const capture = () => {
    const g = q => { const el = s.el.querySelector(q); return el ? el.value : null; };
    const n = g('#_pn'), p = g('#_pp');
    if (n != null) st.name = n;
    if (p != null) st.price = p;
    ['staff', 'services', 'broadcasts'].forEach(k => {
      const v = g('#_l_' + k);
      if (v != null) st.limits[k] = +v || 0;
    });
  };
  const draw = () => {
    const used = editing ? allCompanies().filter(c => c.plan === editing.id).length : 0;
    s.set({
      title: editing ? 'Тариф ' + editing.id : 'Новый тариф',
      body: `
      <div class="field"><label>Название</label><input class="inp" id="_pn" value="${esc(st.name)}" placeholder="Например, PRO"></div>
      <div class="field"><label>Цена, ₸</label><input class="inp" id="_pp" inputmode="numeric" value="${esc(st.price)}" placeholder="19900"></div>
      <div class="field"><label>Период оплаты</label>
        <div class="pick">${Object.entries(PERIODS).map(([k, v]) => `<button class="o ${st.period === k ? 'on' : ''}" data-a="pl.period" data-k="${k}">${v.t}</button>`).join('')}</div></div>

      <div class="tiny muted b" style="margin:16px 0 8px">ЛИМИТЫ · 0 — без ограничений</div>
      <div class="inp-row">
        <div class="field"><label>Сотрудников</label><input class="inp" id="_l_staff" inputmode="numeric" value="${st.limits.staff || 0}"></div>
        <div class="field"><label>Услуг</label><input class="inp" id="_l_services" inputmode="numeric" value="${st.limits.services || 0}"></div>
      </div>
      <div class="field"><label>Рассылок в месяц</label><input class="inp" id="_l_broadcasts" inputmode="numeric" value="${st.limits.broadcasts || 0}"></div>

      <div class="tiny muted b" style="margin:16px 0 8px">ЧТО ВХОДИТ</div>
      <div class="stack s" style="margin-bottom:10px">
        ${st.feats.length ? st.feats.map((f, i) => `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
          <span style="color:var(--ok);flex:none">${icon('check', 16, 2.6)}</span>
          <div class="grow"><div class="tl" style="font-size:13.5px">${esc(f)}</div></div>
          <button class="ico-btn flat" data-a="pl.featDel" data-i="${i}">${icon('trash', 16)}</button>
        </div>`).join('') : '<div class="tiny dim">Пока ничего не перечислено</div>'}
      </div>
      <button class="btn xs gh" style="width:auto" data-a="pl.featAdd">${icon('plus', 14)}Добавить пункт</button>

      ${editing ? `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd);margin-top:16px">
        <div class="grow"><div class="tl">Доступен для выбора</div>
          <div class="st">${used ? used + ' ' + plural(used, ['компания уже на нём', 'компании уже на нём', 'компаний уже на нём']) : 'Пока никто не подключён'}</div></div>
        <button class="sw ${st.active ? 'on' : ''}" data-a="pl.active"></button></div>` : ''}`,
      footer: editing
        ? `<div class="btns"><button class="btn dan" data-a="pl.del" data-id="${editing.id}">Удалить</button>
             <button class="btn p" data-a="pl.ok" data-id="${editing.id}">Сохранить</button></div>`
        : `<button class="btn p" data-a="pl.ok">Создать тариф</button>`,
    });
  };
  window.__pl = { s, st, draw, capture, editing };
  draw();
  return s;
}
on('pl.add', () => planSheet(null));
on('pl.edit', ds => planSheet(ds.id));
on('pl.period', ds => { const p = window.__pl; p.capture(); p.st.period = ds.k; p.draw(); });
on('pl.active', () => { const p = window.__pl; p.capture(); p.st.active = !p.st.active; p.draw(); });
on('pl.featAdd', async () => {
  const p = window.__pl; p.capture();
  const v = await promptSheet({ title: 'Что входит в тариф', label: 'Пункт', placeholder: 'Например, До 10 сотрудников' });
  if (!v) { p.draw(); return; }
  p.st.feats.push(v); p.draw();
});
on('pl.featDel', ds => { const p = window.__pl; p.capture(); p.st.feats.splice(+ds.i, 1); p.draw(); });
on('pl.del', async ds => {
  const used = allCompanies().filter(c => c.plan === ds.id).length;
  if (used) { toast('На тарифе ' + used + ' ' + plural(used, ['компания', 'компании', 'компаний']) + ' — сначала переведите их', 'dan'); return; }
  const ok = await confirmSheet({ title: 'Удалить тариф?', text: 'Он исчезнет из списка выбора.', ok: 'Удалить', danger: true });
  if (!ok) return;
  removePlan(ds.id); window.__pl.s.close(); toast('Тариф удалён', 'dan'); rr();
});
on('pl.ok', ds => {
  const p = window.__pl; p.capture();
  const name = p.st.name.trim();
  const price = +p.st.price;
  if (!name) { toast('Введите название', 'dan'); return; }
  if (!price) { toast('Введите цену', 'dan'); return; }
  if (ds.id) {
    updatePlan(ds.id, { name, price, period: p.st.period, feats: p.st.feats, limits: p.st.limits, active: p.st.active });
    toast('Тариф сохранён');
  } else {
    const created = addPlan({ name, price, period: p.st.period, feats: p.st.feats, limits: p.st.limits });
    if (!created) { toast('Тариф с таким названием уже есть', 'dan'); return; }
    toast('Тариф создан');
  }
  p.s.close(); rr();
});

/* =========================================================
   Рассылки по сегментам компаний (§105)
   ========================================================= */
route('sa.mail', {
  tab: 'sa.settings',
  fab: () => `<button class="fab" data-a="sb.new">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = saBroadcasts();
    const segs = saSegments();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Рассылки</div><div class="top-sub">Письма владельцам компаний</div></div></div>

    <div class="wrap sec" style="margin-top:4px">
      <div class="card pad">
        <div class="b sm" style="margin-bottom:8px">Сегменты</div>
        <div class="stack" style="gap:6px">
          ${segs.map(g => `<div class="row between"><span class="sm" style="color:var(--tx-2)">${esc(g.t)}</span>
            <span class="b sm">${g.list.length}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Отправленные</div><div class="tiny dim">${list.length}</div></div>
      <div class="wrap stack s">
        ${list.length ? list.map(b => {
      const seg = segs.find(x => x.v === b.segment);
      return `<div class="card pad">
          <div class="row between" style="margin-bottom:6px"><div class="b">${esc(b.title)}</div>
            <span class="bdg ok">отправлено</span></div>
          <div class="sm muted" style="line-height:1.45">${esc(String(b.text).slice(0, 120))}${String(b.text).length > 120 ? '…' : ''}</div>
          <div class="hr"></div>
          <div class="row" style="gap:16px">
            <div><div class="tiny dim">Сегмент</div><div class="b sm">${esc(seg ? seg.t : b.segment)}</div></div>
            <div><div class="tiny dim">Получили</div><div class="b sm">${b.to}</div></div>
            <div><div class="tiny dim">Открыли</div><div class="b sm">${b.open}</div></div>
            <div class="grow"></div>
            <div class="tiny dim">${relPast(new Date(b.sentAt), now())}</div>
          </div>
        </div>`;
    }).join('') : emptyState({ ic: 'megaphone', title: 'Рассылок ещё не было', text: 'Расскажите владельцам об обновлении или акции.', action: 'Создать рассылку', act: 'sb.new' })}
      </div>
    </div>`;
  },
});
on('sb.new', () => {
  const segs = saSegments();
  const st = { seg: 'all', title: '', text: '', step: 1, res: null };
  const s = sheet({ title: '', body: '' });
  const cur = () => segs.find(x => x.v === st.seg) || segs[0];
  const capture = () => {
    const t = s.el.querySelector('#_bt'), m = s.el.querySelector('#_bm');
    if (t) st.title = t.value;
    if (m) st.text = m.value;
  };
  const draw = () => {
    if (st.step === 1) s.set({
      title: 'Кому отправим?',
      body: `<div class="stack s">${segs.map(g => `
        <button class="role ${st.seg === g.v ? 'on' : ''}" style="width:100%;display:flex;align-items:center;gap:12px" data-a="sb.seg" data-v="${g.v}">
          <div class="grow"><div class="t">${esc(g.t)}</div><div class="s">${esc(g.s)} · ${g.list.length}</div></div>
          ${st.seg === g.v ? `<span style="color:var(--p)">${icon('checkCircle', 20)}</span>` : ''}
        </button>`).join('')}</div>`,
      footer: `<button class="btn p" data-a="sb.s2" ${cur().list.length ? '' : 'disabled'}>Далее · ${cur().list.length} ${plural(cur().list.length, ['компания', 'компании', 'компаний'])}</button>`,
    });
    else if (st.step === 2) s.set({
      title: 'Текст письма',
      back: () => { st.step = 1; draw(); },
      body: `<div class="field"><label>Заголовок</label><input class="inp" id="_bt" value="${esc(st.title)}" placeholder="Например, Новые возможности календаря"></div>
        <div class="field"><label>Сообщение</label><textarea class="inp" id="_bm" style="min-height:140px" placeholder="Что рассказать владельцам">${esc(st.text)}</textarea></div>
        <div class="tiny dim">Письмо придёт владельцу компании сообщением от бота.</div>`,
      footer: `<button class="btn p" data-a="sb.send">Отправить · ${cur().list.length}</button>`,
    });
    else if (st.step === 3) s.set({ title: 'Отправляем…', body: loadingBlock('Рассылаем ' + cur().list.length + ' сообщений…') });
    else s.set({
      title: 'Готово',
      body: `<div class="succ" style="padding:20px 0 10px">
          <div class="check">${icon('check', 44, 3)}</div>
          <div class="t">Отправлено</div>
          <div class="s">${st.res.to} ${plural(st.res.to, ['компании', 'компаниям', 'компаниям'])}</div>
        </div>
        <div class="grid2" style="margin-top:6px">
          <div class="st-card center"><div class="v">${st.res.to}</div><div class="l">получили</div></div>
          <div class="st-card center"><div class="v">${st.res.open}</div><div class="l">открыли</div></div>
        </div>`,
      footer: `<button class="btn p" data-a="sb.done">Понятно</button>`,
    });
  };
  window.__sb = { s, st, draw, capture, cur };
  draw();
});
on('sb.seg', ds => { const b = window.__sb; b.st.seg = ds.v; b.draw(); });
on('sb.s2', () => {
  const b = window.__sb;
  if (!b.st.text) {
    b.st.title = 'Что нового в Zapis';
    b.st.text = 'Здравствуйте!\n\nМы обновили календарь и финансы: появились произвольные периоды, регулярные платежи и отзывы клиентов. Загляните в раздел «Обучение» — там короткие разборы.';
  }
  b.st.step = 2; b.draw();
});
on('sb.send', async () => {
  const b = window.__sb; b.capture();
  if (!b.st.text.trim()) { toast('Введите текст', 'dan'); return; }
  b.st.title = b.st.title.trim() || 'Сообщение от Zapis';
  b.st.step = 3; b.draw();
  await wait(1500);
  const n = b.cur().list.length;
  const open = Math.round(n * (0.5 + Math.random() * 0.25));
  b.st.res = { to: n, open };
  addSaBroadcast({ title: b.st.title, text: b.st.text, segment: b.st.seg, to: n, open });
  b.st.step = 4; b.draw();
});
on('sb.done', () => { window.__sb.s.close(); rr(); });

/* =========================================================
   Системные уведомления (§106)
   ========================================================= */
route('sa.notices', {
  tab: 'sa.settings',
  fab: () => `<button class="fab" data-a="nt.new">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = notices();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Уведомления</div><div class="top-sub">Обновления, техработы, оплата</div></div></div>
    <div class="wrap stack s" style="margin-top:4px">
      ${list.length ? list.map(n => {
      const k = NOTICE_KINDS[n.kind] || NOTICE_KINDS.update;
      return `<div class="card pad">
        <div class="row" style="gap:10px;margin-bottom:8px">
          <div class="tint" style="background:${k.color}1f;color:${k.color}">${icon(k.icon, 18)}</div>
          <div class="grow"><div class="b sm">${esc(n.title)}</div>
            <div class="tiny muted">${esc(k.t)} · ${relPast(new Date(n.sentAt), now())} · ${n.to} ${plural(n.to, ['компания', 'компании', 'компаний'])}</div></div>
          <button class="ico-btn flat" data-a="nt.del" data-id="${n.id}">${icon('trash', 16)}</button>
        </div>
        <div class="sm" style="line-height:1.5;color:var(--tx-2)">${esc(n.text)}</div>
      </div>`;
    }).join('') : emptyState({ ic: 'bell', title: 'Уведомлений нет', text: 'Сообщите об обновлении или плановых работах — увидят все компании выбранного сегмента.', action: 'Создать уведомление', act: 'nt.new' })}
    </div>`;
  },
});
on('nt.new', () => {
  const segs = saSegments();
  const st = { kind: 'update', seg: 'all', title: '', text: '' };
  const s = sheet({ title: 'Новое уведомление', body: '' });
  const capture = () => {
    const t = s.el.querySelector('#_nt'), m = s.el.querySelector('#_nm');
    if (t) st.title = t.value;
    if (m) st.text = m.value;
  };
  const draw = () => {
    s.set({
      title: 'Новое уведомление',
      body: `
      <div class="field"><label>Тип</label>
        <div class="pick">${Object.entries(NOTICE_KINDS).map(([k, v]) => `<button class="o ${st.kind === k ? 'on' : ''}" data-a="nt.kind" data-k="${k}"
          style="${st.kind === k ? 'background:' + v.color + '1f;color:' + v.color + ';border-color:' + v.color : ''}">${v.t}</button>`).join('')}</div></div>
      <div class="field"><label>Кому</label>
        <div class="pick">${segs.map(g => `<button class="o ${st.seg === g.v ? 'on' : ''}" data-a="nt.seg" data-v="${g.v}">${esc(g.t)} · ${g.list.length}</button>`).join('')}</div></div>
      <div class="field"><label>Заголовок</label><input class="inp" id="_nt" value="${esc(st.title)}" placeholder="Например, Плановые работы в ночь на воскресенье"></div>
      <div class="field"><label>Текст</label><textarea class="inp" id="_nm" style="min-height:110px" placeholder="Коротко и по делу">${esc(st.text)}</textarea></div>
      <div class="tiny dim">Уведомление появится у владельцев в разделе уведомлений и придёт сообщением от бота.</div>`,
      footer: `<button class="btn p" data-a="nt.ok">Отправить</button>`,
    });
  };
  window.__nt = { s, st, draw, capture, segs };
  draw();
});
on('nt.kind', ds => { const n = window.__nt; n.capture(); n.st.kind = ds.k; n.draw(); });
on('nt.seg', ds => { const n = window.__nt; n.capture(); n.st.seg = ds.v; n.draw(); });
on('nt.del', async ds => {
  const ok = await confirmSheet({ title: 'Удалить уведомление?', text: 'Оно исчезнет из истории.', ok: 'Удалить', danger: true });
  if (!ok) return;
  removeNotice(ds.id); toast('Уведомление удалено', 'dan');
});
on('nt.ok', () => {
  const n = window.__nt; n.capture();
  if (!n.st.title.trim()) { toast('Введите заголовок', 'dan'); return; }
  if (!n.st.text.trim()) { toast('Введите текст', 'dan'); return; }
  const seg = n.segs.find(x => x.v === n.st.seg);
  addNotice({ kind: n.st.kind, title: n.st.title.trim(), text: n.st.text.trim(), segment: n.st.seg, to: seg ? seg.list.length : 0 });
  n.s.close(); toast('Уведомление отправлено'); rr();
});

/* =========================================================
   Техническая часть платформы
   Журнал, ошибки, обращения, люди и блокировки. Экраны читают
   данные через функции store — когда появится сервер, поменяется
   только их начинка.
   ========================================================= */

const coName = id => (allCompanies().find(c => c.id === id) || {}).name || '—';

/* ---------- здоровье платформы ---------- */
route('sa.health', {
  tab: 'sa.settings',
  render() {
    const h = platformHealth();
    const stor = h.storagePct;
    const storColor = stor > 80 ? 'var(--dan)' : stor > 55 ? 'var(--warn)' : 'var(--ok)';
    const rows = [
      ['Ошибки за сутки', h.errors24, h.errors24 ? 'dan' : 'ok', 'sa.errors'],
      ['Открытых ошибок', h.errorsOpen, h.errorsOpen ? 'warn' : 'ok', 'sa.errors'],
      ['Обращения без ответа', h.ticketsNew, h.ticketsNew ? 'warn' : 'ok', 'sa.tickets'],
      ['Активные блокировки', h.bansActive, h.bansActive ? 'warn' : 'ok', 'sa.bans'],
    ];
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Состояние</div><div class="top-sub">Версия ${h.version} · данные v${h.dataVersion}</div></div></div>

    <div class="wrap sec" style="margin-top:4px"><div class="stack s">
      ${rows.map(r => `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="${r[3]}">
        <div class="grow" style="text-align:left"><div class="tl">${r[0]}</div></div>
        <span class="bdg ${r[2]}">${r[1]}</span>${icon('fwd', 16)}</button>`).join('')}
    </div></div>

    <div class="wrap sec">
      <div class="card pad">
        <div class="row between" style="margin-bottom:8px">
          <div class="b sm">Хранилище</div>
          <div class="tiny ${stor > 80 ? '' : 'dim'}" style="${stor > 80 ? 'color:var(--dan)' : ''}">${h.storageMb} МБ из 5 МБ</div>
        </div>
        ${progress(stor, storColor)}
        <div class="tiny dim" style="margin-top:8px">
          Демо держит данные в браузере, потолок — квота localStorage.
          Фотографии занимают больше всего места. На сервере это ограничение снимается.
        </div>
      </div>
    </div>

    <div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">Записей в базе</div>
      <div class="card pad stack s">
        ${Object.entries({
      'Компании': h.records.companies, 'Сотрудники': h.records.employees,
      'Клиенты': h.records.clients, 'Записи': h.records.appointments, 'Отзывы': h.records.reviews,
      'Событий в журнале': h.logs,
    }).map(([k, v]) => `<div class="row between"><span class="sm muted">${k}</span><b class="sm">${num(v)}</b></div>`).join('')}
      </div>
    </div>

    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="sa.logs">
        <div class="ic" style="background:var(--sf-3)">${icon('history', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Журнал событий</div>
          <div class="st">Оплаты, блокировки, изменения</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="sa.selftest">
        <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('checkCircle', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Проверить экраны</div>
          <div class="st">Прогнать все разделы и показать ошибки</div></div>${icon('fwd', 17)}</button>
    </div></div>`;
  },
});

/* Быстрый прогон всех экранов — техподдержке проще проверить сборку,
   чем просить владельца пройти по разделам вручную. */
on('sa.selftest', async () => {
  const sh = sheet({ title: 'Проверка', body: loadingBlock('Прогоняю экраны…') });
  await wait(400);
  const R = await import('../router.js');
  const bad = [];
  const roleSave = S.session.role;
  let checked = 0;
  for (const role of ['owner', 'employee', 'client', 'admin']) {
    S.session.role = role;
    for (const [name, def] of Object.entries(R.routes)) {
      const p = {};
      if (name === 'o.employee' || name === 'o.schedule') p.id = (S.data.employees[0] || {}).id;
      if (name === 'o.client') p.id = (S.data.clients[0] || {}).id;
      if (name === 'sa.company') p.id = allCompanies()[0].id;
      if (name === 'cl.success') p.id = (S.data.appointments[0] || {}).id;
      checked++;
      try { def.render(p); } catch (e) { bad.push(role + ' / ' + name + ': ' + e.message); }
    }
  }
  S.session.role = roleSave;
  bad.forEach(b => reportError('Самопроверка: ' + b, { where: 'sa.selftest' }));
  sh.set({
    title: bad.length ? 'Найдены ошибки' : 'Всё в порядке',
    body: `<div class="center" style="padding:6px 0 12px">
        <div class="tint" style="width:52px;height:52px;margin:0 auto 10px;background:${bad.length ? 'var(--dan-soft);color:var(--dan)' : 'var(--ok-soft);color:var(--ok)'}">
          ${icon(bad.length ? 'alert' : 'checkCircle', 26)}</div>
        <div class="b">${bad.length ? bad.length + ' из ' + checked + ' экранов упали' : 'Проверено экранов: ' + checked}</div>
        <div class="sm muted" style="margin-top:4px">${bad.length ? 'Подробности записаны в раздел «Ошибки»' : 'Все разделы открываются во всех ролях'}</div>
      </div>
      ${bad.length ? `<div class="card flat" style="padding:12px 14px"><div class="tiny" style="line-height:1.6;color:var(--tx-2)">${bad.slice(0, 8).map(esc).join('<br>')}</div></div>` : ''}`,
    footer: `<button class="btn p" data-a="sa.testOk">Понятно</button>`,
  });
  window.__st = sh;
});
on('sa.testOk', () => { window.__st && window.__st.close(); rr(); });

/* ---------- журнал событий ---------- */
const lgf = { kind: 'all', limit: 40 };
route('sa.logs', {
  tab: 'sa.settings',
  render() {
    const all = logs().slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    const list = (lgf.kind === 'all' ? all : all.filter(l => l.kind === lgf.kind)).slice(0, lgf.limit);
    const counts = {};
    all.forEach(l => { counts[l.kind] = (counts[l.kind] || 0) + 1; });
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Журнал</div><div class="top-sub">${all.length} событий</div></div></div>
    <div class="chips" style="margin-bottom:10px">
      <button class="chip ${lgf.kind === 'all' ? 'on' : ''}" data-a="lg.f" data-v="all">Все · ${all.length}</button>
      ${Object.entries(LOG_KINDS).filter(([k]) => counts[k]).map(([k, v]) =>
      `<button class="chip ${lgf.kind === k ? 'on' : ''}" data-a="lg.f" data-v="${k}">${v.t} · ${counts[k]}</button>`).join('')}
    </div>
    <div class="wrap stack s">
      ${list.length ? list.map(l => {
      const k = LOG_KINDS[l.kind] || LOG_KINDS.system;
      return `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd);align-items:flex-start">
        <div class="ic" style="background:${k.color}1f;color:${k.color};flex:none">${icon(k.icon, 17)}</div>
        <div class="grow" style="min-width:0">
          <div class="sm b" style="line-height:1.35">${esc(l.text)}</div>
          <div class="tiny dim" style="margin-top:3px">
            ${relPast(new Date(l.at), now())} · ${esc(l.companyId ? coName(l.companyId) : 'платформа')}${l.actor ? ' · ' + esc(l.actor) : ''}
          </div>
        </div>
        ${l.level === 'warn' ? `<span class="bdg warn">важно</span>` : ''}
      </div>`;
    }).join('') : emptyState({ ic: 'history', title: 'Событий нет' })}
    </div>
    ${(lgf.kind === 'all' ? all : all.filter(l => l.kind === lgf.kind)).length > list.length
        ? `<div class="wrap sec"><button class="btn gh sm" data-a="lg.more">Показать ещё</button></div>` : ''}`;
  },
});
on('lg.f', ds => { lgf.kind = ds.v; lgf.limit = 40; rr(); });
on('lg.more', () => { lgf.limit += 40; rr(); });

/* ---------- ошибки ---------- */
const erf = { show: 'open' };
route('sa.errors', {
  tab: 'sa.settings',
  render() {
    const all = errors().slice().sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    const open = all.filter(e => !e.resolved);
    const list = erf.show === 'open' ? open : all;
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Ошибки</div>
        <div class="top-sub">${open.length} открытых · ${all.reduce((s, e) => s + e.count, 0)} случаев</div></div></div>
    <div class="wrap" style="margin-bottom:12px">
      ${segmented('er.f', [{ v: 'open', t: 'Открытые · ' + open.length }, { v: 'all', t: 'Все · ' + all.length }], erf.show)}
    </div>
    <div class="wrap stack s">
      ${list.length ? list.map(e => `<button class="card press" style="width:100%;padding:13px 14px;text-align:left;${e.resolved ? 'opacity:.55' : ''}" data-a="er.open" data-id="${e.id}">
        <div class="row between" style="gap:8px;margin-bottom:5px">
          <span class="row" style="gap:7px;min-width:0">
            <span style="color:${e.level === 'warn' ? 'var(--warn)' : 'var(--dan)'};flex:none">${icon('alert', 16)}</span>
            <b class="sm nowrap">${esc(e.message)}</b></span>
          ${e.count > 1 ? `<span class="bdg ${e.resolved ? '' : 'dan'}">×${e.count}</span>` : ''}
        </div>
        <div class="tiny dim">${esc(e.where || '—')} · ${esc(coName(e.companyId))} · ${esc(e.role)} · ${relPast(new Date(e.lastAt), now())}</div>
      </button>`).join('')
        : emptyState({ ic: 'checkCircle', title: 'Ошибок нет', text: 'Сюда попадают падения экранов и действий у всех пользователей.' })}
    </div>
    ${all.some(e => e.resolved) ? `<div class="wrap sec"><button class="btn gh sm" data-a="er.clear">Очистить решённые</button></div>` : ''}`;
  },
});
on('er.f', ds => { erf.show = ds.v; rr(); });
on('er.clear', async () => {
  const ok = await confirmSheet({ title: 'Очистить решённые?', text: 'Записи о закрытых ошибках будут удалены.', ok: 'Очистить', danger: true });
  if (!ok) return;
  clearResolvedErrors(); toast('Очищено');
});
on('er.open', ds => {
  const e = errors().find(x => x.id === ds.id); if (!e) return;
  const s = sheet({
    title: 'Ошибка',
    body: `
      <div class="card flat" style="padding:12px 14px;margin-bottom:12px">
        <div class="b sm" style="line-height:1.4">${esc(e.message)}</div>
        <div class="hr"></div>
        <div class="row between"><span class="sm muted">Где</span><b class="sm">${esc(e.where || '—')}</b></div>
        <div class="row between" style="margin-top:6px"><span class="sm muted">Компания</span><b class="sm">${esc(coName(e.companyId))}</b></div>
        <div class="row between" style="margin-top:6px"><span class="sm muted">Роль</span><b class="sm">${esc(e.role)}</b></div>
        <div class="row between" style="margin-top:6px"><span class="sm muted">Случаев</span><b class="sm">${e.count}</b></div>
        <div class="row between" style="margin-top:6px"><span class="sm muted">Впервые</span><b class="sm">${relPast(new Date(e.firstAt), now())}</b></div>
        <div class="row between" style="margin-top:6px"><span class="sm muted">Последний раз</span><b class="sm">${relPast(new Date(e.lastAt), now())}</b></div>
      </div>
      ${e.stack ? `<div class="tiny muted b" style="margin-bottom:6px">СТЕК</div>
      <div class="card flat" style="padding:12px 14px"><div class="tiny" style="font-family:ui-monospace,monospace;line-height:1.6;color:var(--tx-2);word-break:break-word">${esc(e.stack)}</div></div>` : ''}`,
    footer: `<div class="btns">
      <button class="btn gh" data-a="er.copy" data-id="${e.id}">${icon('copy', 17)}Скопировать</button>
      <button class="btn ${e.resolved ? 'gh' : 'p'}" data-a="er.toggle" data-id="${e.id}">${e.resolved ? 'Вернуть в работу' : 'Отметить решённой'}</button>
    </div>`,
  });
  window.__er = s;
});
on('er.toggle', ds => {
  const e = errors().find(x => x.id === ds.id);
  resolveError(ds.id, !e.resolved);
  window.__er.close(); toast(e.resolved ? 'Возвращена в работу' : 'Отмечена решённой'); rr();
});
on('er.copy', async ds => {
  const e = errors().find(x => x.id === ds.id);
  await copy([e.message, e.where, e.stack].filter(Boolean).join('\n'));
  toast('Скопировано');
});

/* ---------- обращения ---------- */
const tkf = { status: 'open' };
route('sa.tickets', {
  tab: 'sa.settings',
  render() {
    const all = tickets();
    const open = all.filter(t => t.status !== 'closed');
    const list = tkf.status === 'open' ? open
      : tkf.status === 'all' ? all
        // Жалобы клиентов — отдельный фильтр: это претензия к компании,
        // а не вопрос компании о себе, и разбирается она иначе.
        : tkf.status === 'complaint' ? all.filter(t => t.topic === 'complaint')
          : all.filter(t => t.status === tkf.status);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Обращения</div>
        <div class="top-sub">${open.length} в работе из ${all.length}</div></div></div>
    <div class="chips" style="margin-bottom:12px">
      <button class="chip ${tkf.status === 'open' ? 'on' : ''}" data-a="tk.f" data-v="open">Открытые · ${open.length}</button>
      <button class="chip ${tkf.status === 'complaint' ? 'on' : ''}" data-a="tk.f" data-v="complaint">Жалобы · ${all.filter(t => t.topic === 'complaint').length}</button>
      ${Object.entries(TICKET_STATUS).map(([k, v]) =>
      `<button class="chip ${tkf.status === k ? 'on' : ''}" data-a="tk.f" data-v="${k}">${v.t} · ${all.filter(t => t.status === k).length}</button>`).join('')}
      <button class="chip ${tkf.status === 'all' ? 'on' : ''}" data-a="tk.f" data-v="all">Все</button>
    </div>
    <div class="wrap stack s">
      ${list.length ? list.map(t => {
      const st = TICKET_STATUS[t.status] || TICKET_STATUS.new;
      const last = t.messages[t.messages.length - 1];
      return `<button class="card press" style="width:100%;padding:13px 14px;text-align:left" data-a="tk.open" data-id="${t.id}">
        <div class="row between" style="gap:8px;margin-bottom:4px">
          <b class="sm nowrap">${esc(t.subject)}</b>
          <span class="bdg" style="background:${st.color}1f;color:${st.color};flex:none">${st.t}</span>
        </div>
        <div class="tiny muted nowrap">${esc(coName(t.companyId))} · ${esc(t.author)} · ${esc(TICKET_TOPICS[t.topic] || t.topic)}</div>
        ${t.topic === 'complaint' ? '<div class="tiny" style="color:var(--dan);margin-top:2px">жалоба клиента на компанию</div>'
      : t.from === 'client' ? '<div class="tiny" style="color:var(--tx-3);margin-top:2px">вопрос от клиента</div>' : ''}
        <div class="tiny dim" style="margin-top:5px">${last.from === 'support' ? 'вы: ' : ''}${esc(String(last.text).slice(0, 70))}${String(last.text).length > 70 ? '…' : ''} · ${relPast(new Date(t.updatedAt), now())}</div>
      </button>`;
    }).join('') : emptyState({ ic: 'msg', title: 'Обращений нет', text: 'Сюда попадают вопросы владельцев компаний и жалобы клиентов на них.' })}
    </div>`;
  },
});
on('tk.f', ds => { tkf.status = ds.v; rr(); });
on('tk.open', ds => {
  const t = tickets().find(x => x.id === ds.id); if (!t) return;
  const s = sheet({ title: '', body: '' });
  const draw = () => {
    const cur = tickets().find(x => x.id === ds.id);
    const st = TICKET_STATUS[cur.status];
    s.set({
      title: cur.subject,
      body: `
        <div class="row between" style="margin-bottom:12px">
          <div class="tiny muted">${esc(coName(cur.companyId))} · ${esc(cur.author)}</div>
          <span class="bdg" style="background:${st.color}1f;color:${st.color}">${st.t}</span>
        </div>
        ${cur.topic === 'complaint' ? `<div class="card flat" style="padding:11px 13px;margin-bottom:12px;border-left:3px solid var(--dan)">
          <div class="sm b" style="color:var(--dan)">Жалоба клиента на компанию</div>
          <div class="tiny muted" style="margin-top:3px">Ответ уйдёт клиенту. Компанию можно заблокировать в её карточке.</div>
        </div>` : cur.from === 'client' ? `<div class="card flat" style="padding:11px 13px;margin-bottom:12px;border-left:3px solid var(--p)">
          <div class="sm b">Вопрос от клиента</div>
          <div class="tiny muted" style="margin-top:3px">Это не претензия к салону. Ответ уйдёт клиенту в «Мои обращения».</div>
        </div>` : ''}
        <div class="stack s" style="margin-bottom:14px">
          ${cur.messages.map(m => `<div class="tk-msg ${m.from === 'support' ? 'ours' : ''}">
            <div class="sm" style="line-height:1.5">${esc(m.text)}</div>
            <div class="tiny dim" style="margin-top:4px">${m.from === 'support' ? 'поддержка' : esc(cur.author) + (m.from === 'client' ? ' (клиент)' : '')} · ${relPast(new Date(m.at), now())}</div>
          </div>`).join('')}
        </div>
        <div class="field"><label>Ответ</label>
          <textarea class="inp" id="_tk" style="min-height:90px" placeholder="Ответ владельцу компании"></textarea></div>
        <div class="pick">
          ${Object.entries(TICKET_STATUS).map(([k, v]) => `<button class="o ${cur.status === k ? 'on' : ''}" data-a="tk.st" data-id="${cur.id}" data-v="${k}">${v.t}</button>`).join('')}
        </div>`,
      footer: `<div class="btns">
        <button class="btn gh" data-a="tk.company" data-id="${cur.companyId}">Компания</button>
        <button class="btn p" data-a="tk.send" data-id="${cur.id}">${icon('send', 17)}Ответить</button>
      </div>`,
    });
  };
  window.__tk = { s, draw };
  draw();
});
on('tk.st', ds => { setTicketStatus(ds.id, ds.v); window.__tk.draw(); toast('Статус: ' + TICKET_STATUS[ds.v].t); });
on('tk.send', ds => {
  const el = window.__tk.s.el.querySelector('#_tk');
  const text = (el.value || '').trim();
  if (!text) { toast('Введите ответ', 'dan'); return; }
  replyTicket(ds.id, text, 'support');
  logEvent('system', 'Ответ на обращение', { companyId: (tickets().find(t => t.id === ds.id) || {}).companyId });
  window.__tk.draw();
  toast('Ответ отправлен');
});
on('tk.company', ds => { window.__tk.s.close(); setTimeout(() => go('sa.company', { id: ds.id }), 240); });

/* ---------- люди платформы ---------- */
const usf = { q: '', role: 'all' };
route('sa.users', {
  tab: 'sa.settings',
  render() {
    const list = platformUsers({ q: usf.q, role: usf.role });
    const total = platformUsers({});
    const kinds = [
      ['all', 'Все', total.length],
      ['owner', 'Владельцы', total.filter(u => u.kind === 'owner').length],
      ['staff', 'Сотрудники', total.filter(u => u.kind === 'staff').length],
      ['client', 'Клиенты', total.filter(u => u.kind === 'client').length],
    ];
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Люди</div><div class="top-sub">${num(total.length)} в системе</div></div></div>
    <div class="wrap" style="margin-bottom:10px">
      <div class="search">${icon('search', 18)}<input id="_uq" placeholder="Имя или телефон" value="${esc(usf.q)}"></div>
    </div>
    <div class="chips" style="margin-bottom:12px">
      ${kinds.map(k => `<button class="chip ${usf.role === k[0] ? 'on' : ''}" data-a="us.f" data-v="${k[0]}">${k[1]} · ${k[2]}</button>`).join('')}
    </div>
    <div class="wrap stack s">
      ${list.length ? list.slice(0, 60).map(u => `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%;${u.banned ? 'opacity:.6' : ''}" data-a="us.open" data-id="${u.id}">
        <div class="ic" style="background:${u.kind === 'client' ? 'var(--sf-3)' : 'var(--p-soft);color:var(--p)'}">${icon(u.kind === 'client' ? 'user' : 'users', 17)}</div>
        <div class="grow" style="text-align:left">
          <div class="tl">${esc(u.name)}${u.banned ? ' <span class="bdg dan">блок</span>' : ''}</div>
          <div class="st">${esc(u.role)} · ${esc(coName(u.companyId))}</div>
        </div>
        ${icon('fwd', 16)}
      </button>`).join('') : emptyState({ ic: 'users', title: 'Никого не найдено' })}
      ${list.length > 60 ? `<div class="tiny dim center">Показаны первые 60 из ${list.length}</div>` : ''}
    </div>`;
  },
  mount(p, root) {
    const i = root.querySelector('#_uq');
    if (i) i.oninput = e => {
      usf.q = e.target.value;
      const pos = e.target.selectionStart;
      rr();
      const n = document.querySelector('#_uq');
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    };
  },
});
on('us.f', ds => { usf.role = ds.v; rr(); });
on('us.open', ds => {
  const u = platformUsers({}).find(x => x.id === ds.id); if (!u) return;
  const banned = activeBan('user', u.id);
  const s = sheet({
    title: u.name,
    body: `
      <div class="card flat" style="padding:12px 14px;margin-bottom:12px">
        <div class="row between"><span class="sm muted">Кто</span><b class="sm">${esc(u.role)}</b></div>
        <div class="row between" style="margin-top:6px"><span class="sm muted">Компания</span><b class="sm">${esc(coName(u.companyId))}</b></div>
        ${u.phone ? `<div class="row between" style="margin-top:6px"><span class="sm muted">Телефон</span><b class="sm">${esc(u.phone)}</b></div>` : ''}
        ${u.since ? `<div class="row between" style="margin-top:6px"><span class="sm muted">В системе с</span><b class="sm">${new Date(u.since).getDate()} ${MONTHS[new Date(u.since).getMonth()]} ${new Date(u.since).getFullYear()}</b></div>` : ''}
      </div>
      ${banned ? `<div class="card pad" style="background:var(--dan-soft);border-color:transparent">
        <div class="row" style="gap:8px;color:var(--dan)">${icon('ban', 18)}<b class="sm">Заблокирован</b></div>
        <div class="sm" style="margin-top:6px;color:var(--tx-2)">${esc(BAN_REASONS[banned.reason] || banned.reason)}${banned.note ? ' · ' + esc(banned.note) : ''}</div>
        <div class="tiny dim" style="margin-top:4px">${relPast(new Date(banned.createdAt), now())}${banned.until ? ' · до ' + new Date(banned.until).getDate() + ' ' + MONTHS[new Date(banned.until).getMonth()] : ' · бессрочно'}</div>
      </div>` : ''}`,
    footer: banned
      ? `<button class="btn p" data-a="us.unban" data-id="${u.id}">Разблокировать</button>`
      : `<div class="btns">
           <button class="btn gh" data-a="sa.enter" data-id="${u.companyId}">Кабинет компании</button>
           <button class="btn dan" data-a="us.ban" data-id="${u.id}">Заблокировать</button>
         </div>`,
  });
  window.__us = s;
});
on('us.unban', ds => { liftBan('user', ds.id); window.__us.close(); toast('Разблокирован'); rr(); });
on('us.ban', ds => { window.__us.close(); setTimeout(() => banSheet('user', ds.id), 240); });

/* ---------- блокировки ---------- */
route('sa.bans', {
  tab: 'sa.settings',
  render() {
    const all = bans().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const act = all.filter(b => !b.liftedAt && (!b.until || new Date(b.until) > now()));
    const nameOf = b => b.type === 'company'
      ? coName(b.targetId)
      : ((platformUsers({}).find(u => u.id === b.targetId) || {}).name || b.targetId);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Блокировки</div>
        <div class="top-sub">${act.length} активных из ${all.length}</div></div></div>
    <div class="wrap stack s" style="margin-top:4px">
      ${all.length ? all.map(b => {
      const live = !b.liftedAt && (!b.until || new Date(b.until) > now());
      return `<div class="card pad" style="${live ? '' : 'opacity:.55'}">
        <div class="row between" style="margin-bottom:5px">
          <b class="sm nowrap">${esc(nameOf(b))}</b>
          <span class="bdg ${live ? 'dan' : ''}">${live ? 'активна' : b.liftedAt ? 'снята' : 'истекла'}</span>
        </div>
        <div class="tiny muted">${b.type === 'company' ? 'компания' : 'пользователь'} · ${esc(BAN_REASONS[b.reason] || b.reason)}${b.note ? ' · ' + esc(b.note) : ''}</div>
        <div class="tiny dim" style="margin-top:4px">${relPast(new Date(b.createdAt), now())}${b.until ? ' · до ' + new Date(b.until).getDate() + ' ' + MONTHS[new Date(b.until).getMonth()] : ' · бессрочно'}</div>
        ${live ? `<button class="btn xs gh" style="width:auto;margin-top:10px" data-a="ban.lift" data-t="${b.type}" data-id="${b.targetId}">Снять блокировку</button>` : ''}
      </div>`;
    }).join('') : emptyState({ ic: 'shield', title: 'Блокировок нет', text: 'Компании и пользователи блокируются из их карточек.' })}
    </div>`;
  },
});
on('ban.lift', ds => { liftBan(ds.t, ds.id); toast('Блокировка снята'); rr(); });

/** Общая шторка блокировки: причина, срок, комментарий. */
export function banSheet(type, targetId) {
  const st = { reason: 'unpaid', days: 0, note: '' };
  const s = sheet({ title: '', body: '' });
  const DAYS = [[0, 'Бессрочно'], [7, '7 дней'], [30, '30 дней'], [90, '90 дней']];
  const draw = () => {
    s.set({
      title: type === 'company' ? 'Блокировка компании' : 'Блокировка пользователя',
      body: `
      <div class="field"><label>Причина</label>
        <div class="pick">${Object.entries(BAN_REASONS).map(([k, v]) =>
        `<button class="o ${st.reason === k ? 'on' : ''}" data-a="ban.reason" data-k="${k}">${v}</button>`).join('')}</div></div>
      <div class="field"><label>Срок</label>
        <div class="pick">${DAYS.map(d => `<button class="o ${st.days === d[0] ? 'on' : ''}" data-a="ban.days" data-d="${d[0]}">${d[1]}</button>`).join('')}</div></div>
      <div class="field"><label>Комментарий</label>
        <input class="inp" id="_bn" value="${esc(st.note)}" placeholder="Виден только в панели"></div>
      <div class="tiny dim">${type === 'company'
          ? 'Онлайн-запись перестанет работать, кабинет закроется. Данные сохранятся.'
          : 'Человек не сможет войти. Его записи и история сохранятся.'}</div>`,
      footer: `<button class="btn dan" data-a="ban.ok">Заблокировать</button>`,
    });
  };
  const capture = () => { const el = s.el.querySelector('#_bn'); if (el) st.note = el.value; };
  window.__bn = { s, st, draw, capture, type, targetId };
  draw();
  return s;
}
on('ban.reason', ds => { const b = window.__bn; b.capture(); b.st.reason = ds.k; b.draw(); });
on('ban.days', ds => { const b = window.__bn; b.capture(); b.st.days = +ds.d; b.draw(); });
on('ban.ok', () => {
  const b = window.__bn; b.capture();
  banEntity({ type: b.type, targetId: b.targetId, reason: b.st.reason, note: b.st.note.trim(), days: b.st.days });
  b.s.close();
  toast('Заблокировано', 'dan');
  rr();
});
