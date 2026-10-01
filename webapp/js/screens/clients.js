import {
  S, co, cid, emp, client, clients, appts, apptTitle, apptColor, now, today, clientStats, clientAppts,
  updateClient, reviews, lostClients, emit, can,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, relPast, avatar, emptyState, sheet, toast, promptSheet,
  nVisit, dayKey, startOfDay, num, plural, confirmSheet, MON_SHORT,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { openApptSheet, newApptFlow, addClientSheet, voiceNoteSheet } from '../flows.js';
import { openLink } from '../tg.js';

const rr = () => render(false);
const st = { q: '', filter: 'all' };

const FILTERS = [
  { v: 'all', t: 'Все' }, { v: 'new', t: 'Новые' }, { v: 'top', t: 'Постоянные' }, { v: 'lost', t: 'Давно не были' },
];

function filtered() {
  const n = now();
  let list = clients().map(c => ({ c, s: clientStats(c.id) }));
  if (st.filter === 'new') list = list.filter(x => x.s.visits <= 1);
  if (st.filter === 'top') list = list.filter(x => x.s.visits >= 5);
  if (st.filter === 'lost') list = list.filter(x => x.s.visits > 0 && !x.s.next && x.s.last && (n - new Date(x.s.last.start)) / 86400000 > 45);
  const q = st.q.trim().toLowerCase();
  if (q) list = list.filter(x => x.c.name.toLowerCase().includes(q) || (x.c.phone || '').includes(q));
  return list.sort((a, b) => {
    if (a.s.next && !b.s.next) return -1;
    if (!a.s.next && b.s.next) return 1;
    return b.s.spent - a.s.spent;
  });
}

route('o.clients', {
  perm: 'clients',
  tab: 'o.clients',
  fab: () => `<button class="fab" data-a="qa.client">${icon('plus', 26, 2.4)}</button>`,
  render() {
    const list = filtered();
    const total = clients().length;
    return `
    <div class="top">
      <div class="grow"><div class="top-t">Клиенты</div><div class="top-sub">${total} в базе</div></div>
    </div>
    <div class="wrap" style="margin-bottom:12px">
      <div class="search">${icon('search', 18)}<input id="_cq" placeholder="Поиск по имени или телефону" value="${esc(st.q)}"></div>
    </div>
    <div class="chips" style="margin-bottom:12px">
      ${FILTERS.map(f => `<button class="chip ${st.filter === f.v ? 'on' : ''}" data-a="cls.f" data-v="${f.v}">${f.t}</button>`).join('')}
    </div>
    <div class="wrap stack s">
      ${list.length ? list.slice(0, 60).map(({ c, s }) => clientRow(c, s)).join('')
        : emptyState({
          ic: 'users', title: st.q || st.filter !== 'all' ? 'Никого не нашли' : 'Пока нет клиентов',
          text: st.q || st.filter !== 'all' ? 'Попробуйте изменить запрос или фильтр.' : 'После первой записи клиенты появятся здесь.',
          action: 'Добавить клиента', act: 'qa.client',
        })}
      ${list.length > 60 ? `<div class="center tiny dim" style="padding:12px">Показаны первые 60 из ${list.length}</div>` : ''}
    </div>`;
  },
  mount(p, root) {
    const i = root.querySelector('#_cq');
    if (i) {
      i.oninput = e => { st.q = e.target.value; const pos = e.target.selectionStart; rr(); const n = document.querySelector('#_cq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    }
  },
});

function clientRow(c, s) {
  return `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="o.client" data-id="${c.id}">
    ${avatar(c, 'm')}
    <div class="grow" style="text-align:left">
      <div class="tl">${esc(c.name)}</div>
      <div class="st">${s.visits ? nVisit(s.visits) + ' · ' + moneyShort(s.spent) + ' ₸' : 'Новый клиент'}</div>
      ${s.next ? `<div class="tiny" style="color:var(--p);font-weight:650;margin-top:2px">${icon('calendar', 11, 2.4)} ${dateLabel(new Date(s.next.start), now())}, ${hhmm(new Date(s.next.start))}</div>` : ''}
    </div>
    ${c.ai ? `<span class="bdg ai">${icon('sparkles', 11, 2.4)}</span>` : ''}
    <span class="chev">${icon('fwd', 18, 2)}</span>
  </button>`;
}

on('cls.f', ds => { st.filter = ds.v; rr(); });

/* =========================================================
   Карточка клиента
   ========================================================= */
route('o.client', {
  tab: 'o.clients',
  fab: () => `<button class="fab" data-a="cl.book">${icon('calendarPlus', 24, 2.2)}</button>`,
  render(p) {
    const c = client(p.id);
    if (!c) return `<div class="wrap">${emptyState({ ic: 'users', title: 'Клиент не найден' })}</div>`;
    window.__cl = c.id;
    const s = clientStats(c.id);
    // Сколько человек оставил в кассе — разговор владельца и администратора.
    // Мастеру это знать незачем, а клиент об этом и не подозревает.
    const money_ = can('clients');
    // отзывы в карточке клиента — тоже только владельцу: мастер и
    // администратор открывают этот же экран (см. право reviews в store.js)
    const rv = can('reviews') ? reviews().filter(r => r.clientId === c.id) : [];
    const hist = s.all.filter(a => a.status !== 'planned').slice(0, 8);

    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"></div>
      <button class="ico-btn" data-a="cl.edit" data-id="${c.id}">${icon('pencil', 18)}</button></div>

    <div class="center wrap" style="padding-bottom:6px">
      ${avatar(c, 'xl', '')}
      <div style="font-size:22px;font-weight:780;letter-spacing:-.03em;margin-top:12px">${esc(c.name)}</div>
      <div class="sm muted">${esc(c.phone || '')}${c.tg ? ' · ' + esc(c.tg) : ''}</div>
      <div class="row" style="justify-content:center;gap:6px;margin-top:8px">
        ${s.visits >= 5 ? '<span class="bdg p">Постоянный</span>' : s.visits === 0 ? '<span class="bdg">Новый</span>' : ''}
        <span class="bdg">с ${new Date(c.createdAt).getFullYear()} г.</span>
      </div>
    </div>

    <div class="wrap sec" style="margin-top:16px">
      <div class="acts">
        <button class="act" data-a="cl.call" data-id="${c.id}">${icon('phone', 20)}Позвонить</button>
        <button class="act" data-a="cl.msg" data-id="${c.id}">${icon('msg', 20)}Написать</button>
        <button class="act" data-a="vn.open" data-id="${c.id}">${icon('mic', 20)}Заметка</button>
        <button class="act" data-a="cl.book">${icon('calendarPlus', 20)}Запись</button>
      </div>
    </div>

    <div class="wrap sec">
      <div class="${money_ ? 'grid3' : 'grid2'}">
        <div class="st-card center"><div class="v">${s.visits}</div><div class="l">визитов</div></div>
        ${money_ ? `<div class="st-card center"><div class="v">${moneyShort(s.spent)}</div><div class="l">потрачено</div></div>
        <div class="st-card center"><div class="v">${moneyShort(s.avg)}</div><div class="l">средний чек</div></div>`
        : `<div class="st-card center"><div class="v">${s.last ? relPast(new Date(s.last.start), now()).replace(' назад', '') : '—'}</div><div class="l">последний визит</div></div>`}
      </div>
    </div>

    ${s.next ? `<div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">Следующая запись</div>
      <button class="card press" style="width:100%;padding:14px;text-align:left;display:flex;gap:12px;align-items:center" data-a="ap.card" data-id="${s.next.id}">
        <div class="tint" style="background:var(--p-soft);color:var(--p);width:42px;height:42px">${icon('calendar', 20)}</div>
        <div class="grow">
          <div class="b">${dateLabel(new Date(s.next.start), now())}, ${hhmm(new Date(s.next.start))}</div>
          <div class="sm muted nowrap">${esc(apptTitle(s.next))} · ${esc((emp(s.next.employeeId) || {}).name || '')}</div>
        </div>
        ${money_ ? `<div class="b sm">${moneyShort(s.next.price)} ₸</div>` : ''}
      </button>
    </div>` : `<div class="wrap sec">
      <div class="card pad center">
        <div class="sm muted">Нет предстоящих записей</div>
        <button class="btn p sm" style="margin:12px auto 0" data-a="cl.book">${icon('plus', 16)}Записать</button>
      </div></div>`}

    <div class="wrap sec">
      <div class="row between" style="margin-bottom:8px">
        <div class="sec-t">${icon('sparkles', 15)} AI-заметки</div>
        <button class="sec-a" data-a="vn.open" data-id="${c.id}">${icon('mic', 14)} Добавить</button>
      </div>
      ${c.ai && (c.ai.prefs.length || c.ai.care.length || c.ai.next.length) ? `
        <div class="card pad" style="border-color:var(--ai-soft)">
          ${aiBlock('Предпочтения', c.ai.prefs, 'star', 'var(--p)')}
          ${aiBlock('Важно', c.ai.care, 'alert', 'var(--warn)')}
          ${aiBlock('Следующий визит', c.ai.next, 'calendar', 'var(--ok)')}
          <div class="tiny dim" style="margin-top:8px">Обновлено ${relPast(new Date(c.ai.updated), now())}</div>
        </div>`
        : `<div class="card pad center">
            <div class="sm muted" style="line-height:1.5">Надиктуйте пару слов о клиенте — AI разложит их по категориям и напомнит перед визитом.</div>
            <button class="btn ai sm" style="margin:12px auto 0" data-a="vn.open" data-id="${c.id}">${icon('mic', 16)}Добавить голосом</button>
          </div>`}
    </div>

    ${c.note ? `<div class="wrap sec"><div class="sec-t" style="margin-bottom:8px">Заметка</div>
      <div class="card pad sm">${esc(c.note)}</div></div>` : ''}

    <div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">История визитов</div>
      <div class="stack s">
        ${hist.length ? hist.map(a => `
          <button class="appt press" style="--c:${apptColor(a)};width:100%;text-align:left" data-a="ap.card" data-id="${a.id}">
            <div class="t">${new Date(a.start).getDate()}<small>${MON_SHORT[new Date(a.start).getMonth()]}</small></div>
            <div class="grow"><div class="n nowrap">${esc(apptTitle(a))}</div>
              <div class="s">${esc((emp(a.employeeId) || {}).name || '')}</div></div>
            ${a.status === 'cancelled' ? '<span class="bdg dan">отмена</span>'
        : money_ ? `<div class="b sm">${moneyShort(a.price)} ₸</div>` : ''}
          </button>`).join('')
        : `<div class="card pad center sm muted">Визитов пока не было</div>`}
      </div>
    </div>

    ${rv.length ? `<div class="wrap sec"><div class="sec-t" style="margin-bottom:8px">Отзывы</div>
      <div class="stack s">${rv.map(r => `<div class="card pad">
        <div class="row" style="gap:3px;color:var(--warn);margin-bottom:5px">${Array.from({ length: r.rating }, () => icon('star', 13, 2)).join('')}</div>
        <div class="sm">${esc(r.text)}</div>
        <div class="tiny dim" style="margin-top:5px">${relPast(new Date(r.date), now())}</div>
      </div>`).join('')}</div></div>` : ''}`;
  },
});

function aiBlock(title, items, ic, color) {
  if (!items || !items.length) return '';
  return `<div style="margin-bottom:10px">
    <div class="row" style="gap:6px;color:${color};margin-bottom:4px">${icon(ic, 14)}<b class="tiny" style="text-transform:uppercase;letter-spacing:.05em">${title}</b></div>
    <div class="sm" style="line-height:1.55">${items.map(x => '• ' + esc(x)).join('<br>')}</div>
  </div>`;
}

on('cl.book', () => newApptFlow({ clientId: window.__cl }));
on('cl.call', ds => { const c = client(ds.id); if (c.phone) openLink('tel:' + c.phone.replace(/\s/g, '')); else toast('Нет номера', 'dan'); });
on('cl.msg', ds => { const c = client(ds.id); openLink('https://t.me/' + String(c.tg || '').replace('@', '')); });
on('cl.edit', ds => {
  const c = client(ds.id);
  const s = sheet({
    title: 'Клиент',
    body: `<div class="field"><label>Имя</label><input class="inp" id="_n" value="${esc(c.name)}"></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" value="${esc(c.phone || '')}"></div>
      <div class="field"><label>Telegram</label><input class="inp" id="_t" value="${esc(c.tg || '')}"></div>
      <div class="field"><label>Заметка</label><textarea class="inp" id="_note" placeholder="Что важно помнить">${esc(c.note || '')}</textarea></div>`,
    footer: `<div class="btns"><button class="btn dan" data-a="cl.del" data-id="${c.id}">Удалить</button><button class="btn p" data-a="cl.save" data-id="${c.id}">Сохранить</button></div>`,
  });
  window.__ce = s;
});
on('cl.save', ds => {
  const s = window.__ce;
  updateClient(ds.id, {
    name: s.el.querySelector('#_n').value.trim() || 'Без имени',
    phone: s.el.querySelector('#_p').value.trim(),
    tg: s.el.querySelector('#_t').value.trim(),
    note: s.el.querySelector('#_note').value.trim(),
  });
  s.close(); toast('Клиент сохранён');
});
on('cl.del', async ds => {
  const ok = await confirmSheet({ title: 'Удалить клиента?', text: 'История записей сохранится, но клиент исчезнет из базы.', ok: 'Удалить', danger: true });
  if (!ok) return;
  S.data.clients = S.data.clients.filter(x => x.id !== ds.id);
  emit();
  window.__ce.close();
  toast('Клиент удалён', 'dan');
  go('o.clients', {}, { root: true });
});
