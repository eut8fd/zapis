import {
  S, co, cid, allCompanies, emps, clients, appts, saStats, companyStats, setPlan, setCompanyStatus,
  now, today, rangeStats, emit, extendPlan,
  plans, planById, planPrice, planMonthly, updatePlan, addPlan, removePlan, PERIODS,
  notices, addNotice, removeNotice, NOTICE_KINDS, saSegments, saBroadcasts, addSaBroadcast,
} from '../store.js';
import {
  esc, money, moneyShort, num, dateLabel, relPast, avatar, emptyState, sheet, toast, confirmSheet,
  segmented, bars, sparkline, progress, plural, dayKey, startOfDay, MONTHS, wait, loadingBlock,
  promptSheet, donut,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';

const rr = () => render(false);
const PLAN_IDS = () => plans().map(p => p.id);

/* =========================================================
   Обзор
   ========================================================= */
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
    <div class="av m av-sq" style="background:${c.color === '#0D1220' ? 'var(--tx)' : c.color}">${esc(c.initials)}</div>
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
      <div class="av xl av-sq" style="margin:0 auto;background:${c.color === '#0D1220' ? 'var(--tx)' : c.color}">${esc(c.initials)}</div>
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

    <div class="wrap sec">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="sa.danger" data-id="${c.id}">
        <div class="ic" style="background:var(--dan-soft);color:var(--dan)">${icon('alert', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Опасная зона</div><div class="st">Заморозка и блокировка</div></div>
        ${icon('fwd', 17)}
      </button>
    </div>`;
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
on('sa.enter', async ds => {
  const ok = await confirmSheet({ title: 'Войти как владелец?', text: 'Откроется кабинет этой компании — удобно для поддержки.', ok: 'Войти' });
  if (!ok) return;
  S.session.role = 'owner';
  S.session.companyId = ds.id;
  S.session.employeeId = S.data.employees.find(e => e.companyId === ds.id && e.isOwner).id;
  S.session.clientId = S.data.clients.find(c => c.companyId === ds.id).id;
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
on('sa.block', async ds => {
  const c = allCompanies().find(x => x.id === ds.id);
  if (c.status === 'blocked') { setCompanyStatus(ds.id, null); window.__sd.close(); toast('Компания разблокирована'); return; }
  const ok = await confirmSheet({ title: 'Заблокировать компанию?', text: 'Доступ закроется для всех сотрудников и клиентов.', ok: 'Заблокировать', danger: true });
  if (!ok) return;
  setCompanyStatus(ds.id, 'blocked');
  window.__sd.close(); toast('Компания заблокирована', 'dan');
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
