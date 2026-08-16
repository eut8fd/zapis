import {
  S, co, cid, allCompanies, emps, clients, appts, saStats, companyStats, setPlan, setCompanyStatus,
  now, today, rangeStats, emit,
} from '../store.js';
import {
  esc, money, moneyShort, num, dateLabel, relPast, avatar, emptyState, sheet, toast, confirmSheet,
  segmented, bars, sparkline, progress, plural, dayKey, startOfDay, MONTHS, wait, loadingBlock,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';

const rr = () => render(false);
const PLANS = ['START', 'PRO', 'BUSINESS'];

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
      <div class="st-card"><div class="l">Компании</div><div class="v">${s.companies}</div><div class="tiny up">+2 за месяц</div></div>
      <div class="st-card"><div class="l">Активные подписки</div><div class="v">${s.active}</div><div class="tiny dim">${Math.round(s.active / s.companies * 100)}% базы</div></div>
      <div class="st-card"><div class="l">Пользователи</div><div class="v">${num(s.users)}</div><div class="tiny dim">сотрудники</div></div>
      <div class="st-card"><div class="l">Клиенты</div><div class="v">${num(s.clients)}</div><div class="tiny dim">во всех компаниях</div></div>
    </div></div>

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
  const c = allCompanies().find(x => x.id === ds.id);
  setPlan(c.id, c.plan, 30);
  s.close(); toast('Подписка продлена на 30 дней');
});
on('sa.plan', ds => {
  const c = allCompanies().find(x => x.id === ds.id);
  const s = sheet({
    title: 'Сменить тариф',
    body: `<div class="stack s">${PLANS.map(p => `<button class="role ${c.plan === p ? 'on' : ''}" style="width:100%" data-a="sa.setPlan" data-id="${c.id}" data-p="${p}">
      <div class="t">${p}</div><div class="s">${money(saStats().price[p])} в месяц</div></button>`).join('')}</div>`,
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
    <div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">Тарифная сетка</div>
      <div class="card pad stack s">
        ${PLANS.map(p => `<div class="row between"><span class="sm b">${p}</span><span class="sm muted">${money(s.price[p])} / мес</span></div>`).join('')}
      </div>
    </div>
    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="dev.open">
        <div class="ic">${icon('shield', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Демо-панель</div><div class="st">Роли, компании, машина времени</div></div>${icon('fwd', 17)}</button>
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
