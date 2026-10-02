import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor, apptEnd,
  now, today, slotsFor, nextFreeFor, createAppointment, cancelAppointment, clientStats, clientAppts,
  reviews, toHM, moveAppointment, updateClient, emit, reviewFor,
  homeId, homeCo, person, myClient, ensureMyClient, updatePerson, myAppts, myStats,
  viewCompany, addComplaint, addClientTicket, COMPLAINT_REASONS, myTickets, TICKET_STATUS, isServer,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, dateFull, relPast, avatar, emptyState, sheet, toast,
  confirmSheet, promptSheet, nMin, plural, dayKey, startOfDay, addDays, WD, WD_FULL, MONTHS, wait, loadingBlock, relShort,
  monthGrid, MONTH_NAMES, MON_SHORT, brandGradient, t, SLOT_PARTS, statBar, prettyPhone,
} from '../ui.js';
import { icon, catIcon } from '../icons.js';
import { route, go, render, resetStack } from '../router.js';
import { on } from '../bus.js';
import { haptic, openLink, tgClose, copy } from '../tg.js';
import { BOT_USERNAME } from '../config.js';
import { LANGS, lang } from '../i18n.js';
import { pushNow, session, botName } from '../sync.js';
import { enterCompany, myCabinet } from '../roles.js';
import { setLang } from '../store.js';
import { reviewSheet, tipOnce, langBtn, pickSlot, supportSheet, myDataSheet } from '../flows.js';

const rr = () => render(false);
// Карточка человека в открытом сейчас салоне. null — он тут ещё не
// записывался: заводить карточку от одного просмотра салон не должен.
const my = () => myClient();

/** Стаж мастера для клиента — только если владелец разрешил показ (§68). */
function expLine(e) {
  if (!e || !e.since || e.showExp === false) return '';
  const y = Math.max(0, now().getFullYear() - e.since);
  if (!y) return '';
  return `<div class="tiny dim nowrap">${t('опыт {n} {u}', { n: y, u: plural(y, ['год', 'года', 'лет']) })}</div>`;
}

/** То же одной строкой — подписью рядом с ролью: «Бровист · опыт 6 лет». */
function expInline(e) {
  if (!e || !e.since || e.showExp === false) return '';
  const y = Math.max(0, now().getFullYear() - e.since);
  return y ? ' · ' + t('опыт {n} {u}', { n: y, u: plural(y, ['год', 'года', 'лет']) }) : '';
}

/* =========================================================
   Страница компании (клиент)
   ========================================================= */
route('cl.company', {
  tab: 'cl.company',
  mount() {
    tipOnce('cl.book', {
      title: t('Записаться — одна кнопка'),
      text: t('Услуга, мастер, дата и время. Занятые дни в календаре зачёркнуты, а перенести или отменить запись можно прямо в «Моих записях».'),
      ic: 'calendarPlus',
    });
  },
  render() {
    const c = co();
    const me = my();
    const list = svcs().slice(0, 5);
    const team = staff();
    const st = me ? clientStats(me.id) : { next: null, visits: 0 };

    const col = c.color;
    // не today: локальная переменная с этим именем перекрывала импорт today()
    // на всю функцию, и строка «завтра» у мастера падала с «today is not a function»
    const hoursToday = c.hours[now().getDay()] || {};
    // Фото салона — фон самой шапки, а не отдельная полоса сверху:
    // два разных блока подряд читались как склейка. Градиент поверх фото
    // нужен, чтобы белый текст оставался читаемым на любом снимке.
    const heroBg = c.cover
      ? `background-image:linear-gradient(170deg,rgba(12,16,32,.30) 0%,rgba(12,16,32,.78) 100%),url('${c.cover}')`
      : `background-image:${brandGradient(col)}`;
    // Подписка салона кончилась — сервер запись не примет. Говорим об этом
    // сразу, а не отказом после выбора времени.
    const closed = isServer() && c.planUntil && new Date(c.planUntil).getTime() + 3 * 86400000 < now().getTime();

    return `
    <div class="pub-hero ${c.cover ? 'has-cover' : ''}" style="${heroBg}">
      <div class="row between">
        ${c.logo ? `<div class="av l av-sq av-photo pub-logo" style="background-image:url('${c.logo}')"></div>`
        : `<div class="av l av-sq pub-logo" style="background:rgba(255,255,255,.2)">${esc(c.initials)}</div>`}
        <div class="row" style="gap:8px">
          ${langBtn('pub-share')}
          <button class="ico-btn pub-share" data-a="cl.share">${icon('share', 19)}</button>
        </div>
      </div>
      <div class="nm">${esc(c.name)}</div>
      <div class="pub-meta">
        <span class="pill">${icon('pin', 13, 2.4)}${esc(c.city)}</span>
        <span class="pill">${icon('clock', 13, 2.4)}${hoursToday.on ? hoursToday.from + ' — ' + hoursToday.to : t('сегодня выходной')}</span>
      </div>
      <div class="pub-addr">${esc(c.addr)}</div>
    </div>

    <div class="wrap pub-cta">
      ${closed ? `<div class="card pad row" style="gap:10px;background:var(--warn-soft);border-color:transparent">
        <span style="color:var(--warn)">${icon('alert', 19)}</span>
        <div class="sm" style="color:var(--tx-2)">${t('Салон временно не принимает онлайн-записи. Позвоните — номер ниже.')}</div>
      </div>` : `<button class="btn hero-cta" style="color:${col}" data-a="cl.start">
        ${icon('calendarPlus', 20)}${t('Записаться')}
      </button>`}
    </div>

    ${st.next ? `<div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">${t('Ваша запись')}</div>
      <button class="card press" style="width:100%;padding:14px;text-align:left;display:flex;gap:12px;align-items:center;border-color:var(--p)" data-a="cl.appt" data-id="${st.next.id}">
        <div class="tint" style="background:var(--p-soft);color:var(--p);width:44px;height:44px">${icon('calendar', 21)}</div>
        <div class="grow">
          <div class="b">${dateLabel(new Date(st.next.start), now())}, ${hhmm(new Date(st.next.start))}</div>
          <div class="sm muted nowrap">${esc(apptTitle(st.next))} · ${esc((emp(st.next.employeeId) || {}).name.split(' ')[0] || '')}</div>
        </div>${icon('fwd', 18)}
      </button>
    </div>` : ''}

    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Услуги')}</div>
        <button class="sec-a" data-a="cl.start">${t('Все {n}', { n: svcs().length })} ${icon('fwd', 14, 2.4)}</button></div>
      <div class="wrap stack s">
        ${list.map(s => `<button class="svc press" style="width:100%" data-a="cl.startSvc" data-id="${s.id}">
          ${s.photo ? `<div class="svc-ph" style="background-image:url('${s.photo}')"></div>`
        : `<div class="tint" style="background:${s.color}1f;color:${s.color}">${catIcon(s.cat, 18)}</div>`}
          <div class="grow" style="text-align:left"><div class="b" style="font-size:14.5px">${esc(s.name)}</div>
            <div class="tiny muted">${nMin(s.duration)}</div></div>
          <div class="pr">${money(s.price)}</div>
        </button>`).join('')}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Специалисты')}</div></div>
      <div class="hscroll" style="gap:12px">
        ${team.map(e => {
      const nf = nextFreeFor(e.id, 60);
      // класс center, а не только text-align: аватар — блок фиксированной
      // ширины, его центрирует правило .center > .av
      return `<button class="card press center" style="flex:none;width:126px;padding:14px 10px" data-a="cl.startEmp" data-id="${e.id}">
            ${avatar(e, 'l', '')}
            <div class="b sm" style="margin-top:8px">${esc(e.name.split(' ')[0])}</div>
            <div class="tiny muted nowrap">${esc(e.role)}</div>
            ${expLine(e)}
            <div class="tiny" style="color:var(--ok);font-weight:650;margin-top:4px">${nf ? (dayKey(nf.date) === dayKey(now()) ? t('сегодня') + ' ' : dayKey(nf.date) === dayKey(addDays(today(), 1)) ? t('завтра') + ' ' : nf.date.getDate() + ' ' + MON_SHORT[nf.date.getMonth()] + ' ') + nf.slot.t : t('нет мест')}</div>
          </button>`;
    }).join('')}
      </div>
    </div>


    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Контакты')}</div></div>
      <div class="wrap stack s">
        <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.call">
          <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('phone', 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl">${esc(c.phone)}</div><div class="st">${t('Позвонить')}</div></div></button>
        <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.map">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('pin', 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl">${esc(c.addr)}</div><div class="st">${esc(c.city)}</div></div></button>
        <div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
          <div class="ic">${icon('clock', 18)}</div>
          <div class="grow"><div class="tl">${t('Сегодня')} ${hoursToday.on ? hoursToday.from + ' — ' + hoursToday.to : t('выходной')}</div>
            <div class="st">${esc(c.about || '')}</div></div></div>
      </div>
    </div>`;
  },
});

/* Жалоба на компанию (ТЗ 8.12: модерация). Уходит не владельцу салона,
   а в поддержку платформы — иначе жаловаться было бы некому: салон
   и есть предмет жалобы. На самой странице салона кнопки нет: человек
   пришёл записаться, а не жаловаться, и предлагать это первым делом
   нельзя. Живёт в профиле, в тихом разделе внизу. */
on('cl.complain', () => {
  const c = co();
  const st = { reason: 'noshow' };
  const s = sheet({
    title: t('Пожаловаться на салон'),
    body: `<div class="card flat" style="padding:13px;margin-bottom:12px">
        <div class="b sm">${esc(c.name)}</div>
        <div class="tiny muted" style="margin-top:2px">${esc(c.city)}${c.addr ? ' · ' + esc(c.addr) : ''}</div>
      </div>
      <div class="field"><label>${t('Что случилось')}</label>
        <div class="stack s">
          ${Object.entries(COMPLAINT_REASONS).map(([k, v]) => `
            <button class="lrow press" style="border-radius:14px;border:1.5px solid ${st.reason === k ? 'var(--p)' : 'var(--bd)'};width:100%;${st.reason === k ? 'background:var(--p-soft)' : ''}" data-a="cl.cmpR" data-v="${k}">
              <div class="grow" style="text-align:left"><div class="tl">${esc(t(v))}</div></div>
              <span class="cmp-mark" style="color:var(--p)">${st.reason === k ? icon('checkCircle', 19) : ''}</span>
            </button>`).join('')}
        </div></div>
      <div class="field"><label>${t('Подробности')}</label>
        <textarea class="inp" id="_cmp" style="min-height:90px" placeholder="${t('Что произошло — своими словами')}"></textarea></div>
      <div class="tiny dim" style="padding:0 4px">${t('Жалобу увидит поддержка платформы, а не сам салон.')}</div>`,
    footer: `<button class="btn p" data-a="cl.cmpSend">${icon('send', 18)}${t('Отправить')}</button>`,
  });
  window.__cmp = { s, st, companyId: c.id };
});
on('cl.cmpR', ds => {
  const { s, st } = window.__cmp;
  st.reason = ds.v;
  // Галочку надо не только поставить, но и снять со старого пункта:
  // раньше она рисовалась при сборке шторки и оставалась там навсегда.
  s.el.querySelectorAll('[data-a="cl.cmpR"]').forEach(b => {
    const on = b.dataset.v === ds.v;
    b.style.border = '1.5px solid ' + (on ? 'var(--p)' : 'var(--bd)');
    b.style.background = on ? 'var(--p-soft)' : '';
    const mark = b.querySelector('.cmp-mark');
    if (mark) mark.innerHTML = on ? icon('checkCircle', 19) : '';
  });
});
on('cl.cmpSend', () => {
  const { s, st, companyId } = window.__cmp;
  const text = (s.el.querySelector('#_cmp').value || '').trim();
  const next = myStats().next;
  addComplaint({
    companyId, reason: st.reason, text,
    appointmentId: next && next.companyId === companyId ? next.id : null,
  });
  s.close();
  toast(t('Жалоба отправлена в поддержку'));
});
/* Жалоба клиента без обратной связи бессмысленна: он отправил и не знает,
   чем кончилось. Строка появляется, только если обращения есть. */
function myTicketsRow() {
  const list = myTickets();
  if (!list.length) return '';
  const answered = list.filter(x => x.messages[x.messages.length - 1].from === 'support').length;
  return `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.myTickets">
    <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('msg', 18)}</div>
    <div class="grow" style="text-align:left"><div class="tl">${t('Мои обращения')}</div>
      <div class="st">${list.length} ${plural(list.length, ['обращение', 'обращения', 'обращений'])}${' · ' + t(answered ? 'есть ответ' : 'ждут ответа')}</div>
    </div>${icon('fwd', 17)}</button>`;
}

on('cl.myTickets', () => {
  const list = myTickets();
  sheet({
    title: t('Мои обращения'),
    body: list.map(tk => {
      const st = TICKET_STATUS[tk.status] || TICKET_STATUS.new;
      return `<div class="card flat" style="padding:13px;margin-bottom:10px">
        <div class="row between" style="gap:8px;margin-bottom:6px">
          <b class="sm">${esc(tk.subject)}</b>
          <span class="bdg" style="background:${st.color}1f;color:${st.color};flex:none">${st.t}</span>
        </div>
        <div class="stack s">
          ${tk.messages.map(m => `<div class="tk-msg ${m.from === 'support' ? '' : 'ours'}">
            <div class="sm" style="line-height:1.5">${esc(m.text)}</div>
            <div class="tiny dim" style="margin-top:4px">${m.from === 'support' ? t('поддержка') : t('вы')} · ${relPast(new Date(m.at), now())}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }).join(''),
  });
});

on('cl.share', async () => {
  const c = co();
  const link = 'https://t.me/' + botName() + '?start=' + c.id;
  await copy(link);
  sheet({
    title: t('Поделиться салоном'),
    body: `<div class="center" style="padding:4px 0 12px">
        ${avatar({ initials: c.initials, color: c.color, photo: c.logo || c.cover }, 'xl', 'av-sq')}
        <div class="b" style="font-size:17px;margin-top:12px">${esc(c.name)}</div>
        <div class="sm muted">${esc(c.cat)} · ${esc(c.city)}</div>
      </div>
      <div class="card flat" style="padding:13px;text-align:center">
        <div class="tiny muted">${t('Ссылка скопирована')}</div>
        <div class="b sm" style="margin-top:4px;word-break:break-all">${esc(link)}</div>
      </div>`,
    footer: `<button class="btn p" data-a="cl.shareTg" data-link="${esc(link)}">${icon('send', 18)}${t('Отправить в Telegram')}</button>`,
  });
});
on('cl.shareTg', ds => {
  openLink('https://t.me/share/url?url=' + encodeURIComponent(ds.link) +
    '&text=' + encodeURIComponent(t('Записывайтесь онлайн — свободное время видно сразу')));
});
on('cl.call', () => {
  const p = co().phone;
  if (!p) { toast(t('Номер не указан'), 'dan'); return; }
  openLink('tel:' + p.replace(/[^\d+]/g, ''));
});
on('cl.map', () => {
  const c = co();
  const q = encodeURIComponent(c.city + ', ' + c.addr);
  sheet({
    title: t('Как добраться'),
    body: `<div class="card flat" style="padding:14px;margin-bottom:12px">
        <div class="row" style="gap:10px"><span style="color:var(--p)">${icon('pin', 19)}</span>
          <div class="grow"><div class="b sm">${esc(c.addr)}</div><div class="tiny muted">${esc(c.city)}</div></div></div>
        <div class="hr"></div>
        <div class="row" style="gap:10px"><span style="color:var(--tx-3)">${icon('clock', 19)}</span>
          <div class="sm">${(c.hours[now().getDay()] || {}).on ? t('Сегодня') + ' ' + c.hours[now().getDay()].from + ' — ' + c.hours[now().getDay()].to : t('Сегодня выходной')}</div></div>
      </div>
      <div class="btns">
        <button class="btn gh" data-a="cl.mapOpen" data-u="https://go.2gis.com/search/${q}">2ГИС</button>
        <button class="btn gh" data-a="cl.mapOpen" data-u="https://yandex.ru/maps/?text=${q}">Яндекс</button>
        <button class="btn gh" data-a="cl.mapOpen" data-u="https://maps.google.com/?q=${q}">Google</button>
      </div>`,
  });
});
on('cl.mapOpen', ds => openLink(ds.u));
on('cl.start', () => { book.reset(); go('cl.book'); });
on('cl.startSvc', ds => { book.reset(); book.st.svcId = ds.id; book.st.step = 2; go('cl.book'); });
// Клиент нажал на мастера — значит выбрал его. Показываем его услуги
// и пропускаем шаг «выберите мастера»: спрашивать второй раз нелогично.
on('cl.startEmp', ds => { book.reset(); book.st.empId = ds.id; book.st.fixedEmp = true; go('cl.book'); });
on('cl.appt', ds => openMyAppt(ds.id));

/* =========================================================
   Booking flow клиента
   ========================================================= */
const book = {
  st: {},
  reset() { book.st = { step: 1, svcId: null, empId: null, fixedEmp: false, date: null, month: null, min: null, created: null }; },
};
book.reset();

route('cl.book', {
  noTab: true,
  render() {
    const s = book.st;
    const c = co();
    const e = s.fixedEmp && s.empId ? emp(s.empId) : null;
    // мастер уже выбран — шагов три, а не четыре
    const total = s.fixedEmp ? 3 : 4;
    const cur = s.fixedEmp ? (s.step === 1 ? 1 : s.step - 1) : s.step;
    const title = s.step === 1 && e
      ? t('Услуги мастера')
      : t(['', 'Выберите услугу', 'Выберите мастера', 'Выберите дату', 'Выберите время'][s.step]);
    return `
    <div class="top">
      <button class="ico-btn" data-a="bk.back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t" style="font-size:17px">${title}</div>
        <div class="top-sub">${esc(e ? e.name : c.name)}</div></div>
    </div>
    <div class="ob-dots" style="margin:2px 0 16px">${Array.from({ length: total }, (_, i) => `<i class="${i + 1 <= cur ? 'on' : ''}"></i>`).join('')}</div>
    ${s.step === 1 ? step1() : s.step === 2 ? step2() : s.step === 3 ? step3() : step4()}`;
  },
});

function step1() {
  const st = book.st;
  const e = st.fixedEmp && st.empId ? emp(st.empId) : null;
  // мастер выбран — показываем только то, что делает он
  const list = e ? svcs().filter(x => x.employeeIds.includes(e.id)) : svcs();
  const byCat = {};
  list.forEach(s => (byCat[s.cat] = byCat[s.cat] || []).push(s));
  const CATN = { nails: 'Ногти', hair: 'Волосы', brow: 'Брови и ресницы', bar: 'Услуги', spa: 'Спа' };

  const head = e ? `
    <div class="wrap" style="margin-bottom:4px">
      <div class="card pad row" style="gap:12px">
        ${avatar(e, 'm')}
        <div class="grow">
          <div class="b">${esc(e.name)}</div>
          <div class="tiny muted">${esc(e.role)}${expInline(e)}</div>
        </div>
      </div>
    </div>` : '';

  if (!list.length) {
    return head + `<div class="wrap sec">${emptyState({
      ic: 'briefcase', title: t('У мастера пока нет услуг'),
      text: t('Вернитесь назад и выберите другого специалиста — покажем всё, что он делает.'),
    })}</div>`;
  }

  return head + Object.keys(byCat).map(cat => `
    <div class="sec" style="margin-top:6px">
      <div class="sec-h"><div class="sec-t" style="font-size:13px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em">${t(CATN[cat] || 'Услуги')}</div></div>
      <div class="wrap stack s">
        ${byCat[cat].map(s => `<button class="svc press" style="width:100%" data-a="bk.svc" data-id="${s.id}">
          ${s.photo ? `<div class="svc-ph" style="background-image:url('${s.photo}')"></div>`
        : `<div class="tint" style="background:${s.color}1f;color:${s.color}">${catIcon(s.cat, 18)}</div>`}
          <div class="grow" style="text-align:left">
            <div class="b" style="font-size:14.5px">${esc(s.name)}</div>
            <div class="tiny muted">${nMin(s.duration)}${s.desc ? ' · ' + esc(s.desc.slice(0, 40)) : ''}</div>
          </div>
          <div class="pr">${money(s.price)}</div>
          <span class="chev">${icon('fwd', 17, 2)}</span>
        </button>`).join('')}
      </div>
    </div>`).join('');
}

function step2() {
  const s = svc(book.st.svcId);
  const list = staff().filter(e => !s || s.employeeIds.includes(e.id));
  return `
    <div class="wrap stack s">
      <button class="lrow press" style="border-radius:18px;border:1px dashed var(--bd-2);width:100%;padding:15px" data-a="bk.emp" data-id="">
        <div class="ic" style="background:var(--p-soft);color:var(--p);width:44px;height:44px;border-radius:14px">${icon('users', 20)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Любой специалист')}</div><div class="st">${t('Покажем самое раннее время')}</div></div>
        <span class="chev">${icon('fwd', 17, 2)}</span></button>
      ${list.map(e => {
    const nf = nextFreeFor(e.id, s ? s.duration : 60);
    return `<button class="lrow press" style="border-radius:18px;border:1px solid var(--bd);width:100%;padding:13px 14px" data-a="bk.emp" data-id="${e.id}">
          ${avatar(e, 'm')}
          <div class="grow" style="text-align:left">
            <div class="tl">${esc(e.name)}</div><div class="st">${esc(e.role)}${expInline(e)}</div>
            ${nf ? `<div class="tiny" style="color:var(--ok);font-weight:650;margin-top:3px">${icon('clock', 11, 2.4)} ${t('ближайшее')} — ${dateLabel(nf.date, now()).toLowerCase()}, ${nf.slot.t}</div>` : `<div class="tiny dim" style="margin-top:3px">${t('нет свободного времени')}</div>`}
          </div>

        </button>`;
  }).join('')}
    </div>`;
}

function step3() {
  const s = book.st;
  const sv = svc(s.svcId);
  const empIds = s.empId ? [s.empId] : staff().filter(e => !sv || sv.employeeIds.includes(e.id)).map(e => e.id);
  const dur = sv ? sv.duration : 60;
  if (!s.month) s.month = startOfDay(today());

  // сколько свободных слотов в этот день — считаем на лету для видимого месяца
  const freeOn = d => slotsFor(empIds, d, dur).filter(x => x.free).length;

  const maxDate = addDays(today(), 120);   // запись открыта на 4 месяца вперёд
  return `
    <div class="wrap" style="margin-bottom:14px">${summaryRow()}</div>

    <div class="wrap" style="margin-bottom:10px">
      ${monthGrid(s.month, {
        selected: s.date, action: 'bk.date', navAction: 'bk.month',
        avail: freeOn, minDate: today(), maxDate,
      })}
      <div class="mc-legend">
        <span><i></i>${t('есть свободное время')}</span>
        <span style="opacity:.6">${t('зачёркнуто — мест нет')}</span>
      </div>
    </div>

    <div class="wrap sec">
      <div class="tiny dim center">${t('Листайте месяцы стрелками — записаться можно на 4 месяца вперёд')}</div>
    </div>`;
}

function step4() {
  const s = book.st;
  const sv = svc(s.svcId);
  const empIds = s.empId ? [s.empId] : staff().filter(e => !sv || sv.employeeIds.includes(e.id)).map(e => e.id);
  const slots = slotsFor(empIds, s.date, sv ? sv.duration : 60);
  const free = slots.filter(x => x.free);
  const [morning, day, eve] = SLOT_PARTS.map(([, fits]) => free.filter(fits));
  const grp = (t, arr) => arr.length ? `<div class="sec" style="margin-top:16px">
      <div class="sec-h"><div class="sec-t" style="font-size:13px;color:var(--tx-3)">${t}</div></div>
      <div class="wrap"><div class="slots">${arr.map(x => `<button class="slot ${s.min === x.min ? 'on' : ''}" data-a="bk.slot" data-m="${x.min}" data-e="${x.empId}">${x.t}</button>`).join('')}</div></div>
    </div>` : '';
  return `
    <div class="wrap" style="margin-bottom:4px">${summaryRow()}</div>
    <div class="wrap sec" style="margin-top:14px">
      <div class="row between">
        <button class="ico-btn" data-a="bk.day" data-d="-1">${icon('back', 17)}</button>
        <div class="center"><div class="b">${dateLabel(s.date, now())}</div>
          <div class="tiny dim">${WD_FULL[s.date.getDay()]}, ${s.date.getDate()} ${MONTHS[s.date.getMonth()]}</div></div>
        <button class="ico-btn" data-a="bk.day" data-d="1">${icon('fwd', 17)}</button>
      </div>
    </div>
    ${free.length ? grp(t('Утро'), morning) + grp(t('День'), day) + grp(t('Вечер'), eve)
      : `<div class="wrap">${emptyState({ ic: 'clock', title: t('На этот день мест нет'), text: t('Выберите другую дату — свободное время найдётся.') })}</div>`}
    ${s.min != null ? `<div class="fixbar" style="padding:12px 16px calc(12px + var(--safe-b));background:var(--sf);border-top:1px solid var(--bd)">
      <button class="btn p" style="height:54px" data-a="bk.confirm">${t('Подтвердить · {n}', { n: money(sv.price) })}</button>
    </div>` : ''}`;
}

function summaryRow() {
  const s = book.st, sv = svc(s.svcId), e = s.empId ? emp(s.empId) : null;
  return `<div class="card flat" style="padding:12px 14px;display:flex;gap:12px;align-items:center">
    <div class="tint" style="background:${sv ? sv.color + '1f' : 'var(--p-soft)'};color:${sv ? sv.color : 'var(--p)'}">${sv ? catIcon(sv.cat, 18) : icon('briefcase', 18)}</div>
    <div class="grow"><div class="b sm nowrap">${esc(sv ? sv.name : '')}</div>
      <div class="tiny muted">${sv ? nMin(sv.duration) : ''}${e ? ' · ' + esc(e.name.split(' ')[0]) : ' · ' + t('любой мастер')}</div></div>
    <div class="b sm">${sv ? money(sv.price) : ''}</div>
  </div>`;
}

on('bk.back', () => {
  const s = book.st;
  if (s.step <= 1) { go('cl.company', {}, { root: true }); return; }
  // шаг выбора мастера пропущен — назад со «дня» ведём сразу к услугам
  s.step = s.fixedEmp && s.step === 3 ? 1 : s.step - 1;
  rr();
});
on('bk.svc', ds => {
  book.st.svcId = ds.id;
  book.st.step = book.st.fixedEmp ? 3 : 2;   // мастер уже известен — сразу дата
  rr();
});
on('bk.emp', ds => { book.st.empId = ds.id || null; book.st.step = 3; rr(); });
on('bk.date', ds => {
  book.st.date = startOfDay(new Date(+ds.d));
  book.st.month = startOfDay(book.st.date);
  book.st.min = null; book.st.step = 4; rr();
});
on('bk.month', ds => { book.st.month = startOfDay(new Date(+ds.d)); rr(); });
on('bk.day', ds => {
  const d = addDays(book.st.date, +ds.d);
  if (d < today()) return;
  book.st.date = d; book.st.min = null; rr();
});
on('bk.slot', ds => { book.st.min = +ds.m; book.st.empId = book.st.empId || ds.e; haptic('select'); rr(); });
on('bk.confirm', async () => {
  const s = book.st, sv = svc(s.svcId);
  const empIds = s.empId ? [s.empId] : staff().map(e => e.id);
  const slot = slotsFor(empIds, s.date, sv.duration).find(x => x.min === s.min);
  const empId = s.empId || (slot ? slot.empId : null);
  if (!empId) { toast(t('Это время уже заняли'), 'dan'); rr(); return; }
  const d = new Date(s.date); d.setHours(Math.floor(s.min / 60), s.min % 60, 0, 0);
  const sh = sheet({ title: t('Подтверждение'), body: loadingBlock(t('Бронируем время…')) });
  if (!isServer()) await wait(1100);
  // карточку в этом салоне заводим ровно здесь — в момент первой записи
  const rec = ensureMyClient();
  const a = createAppointment({ clientId: rec.id, employeeId: empId, serviceIds: [sv.id], start: d, source: 'client' });
  // Экран «Готово» показываем после ответа сервера: время могли занять
  // с другого устройства, и сервер откажет — тогда запись откатится, а
  // человек вернётся к выбору времени, а не увидит ложное подтверждение.
  if (isServer()) {
    const rej = await pushNow();
    const bad = rej.find(x => x.col === 'appointments' && x.id === a.id);
    if (bad) {
      sh.close();
      toast(bad.reason || t('Это время уже заняли'), 'dan');
      book.st.min = null; rr();
      return;
    }
  }
  sh.close();
  book.st.created = a.id;
  haptic('success');
  go('cl.success', { id: a.id });
});

/* =========================================================
   Успех
   ========================================================= */
route('cl.success', {
  noTab: true,
  render(p) {
    const a = appt(p.id);
    if (!a) return emptyState({ ic: 'checkCircle', title: 'Готово!' });
    const e = emp(a.employeeId), c = co();
    const d = new Date(a.start);
    return `
    <div class="succ" style="padding-top:56px">
      <div class="check">${icon('check', 46, 3)}</div>
      <div class="t">${t('Готово!')}</div>
      <div class="s">${t('Вы записаны')}</div>
    </div>
    <div class="wrap">
      <div class="card pad">
        <div class="row between" style="padding:2px 0"><span class="sm muted">${t('Услуга')}</span><b>${esc(apptTitle(a))}</b></div>
        <div class="hr"></div>
        <div class="row between" style="padding:2px 0"><span class="sm muted">${t('Мастер')}</span><b>${esc(e ? e.name : '')}</b></div>
        <div class="hr"></div>
        <div class="row between" style="padding:2px 0"><span class="sm muted">${t('Когда')}</span><b>${dateLabel(d, now())}, ${hhmm(d)}</b></div>
        <div class="hr"></div>
        <div class="row between" style="padding:2px 0"><span class="sm muted">${t('Стоимость')}</span><b style="font-size:17px">${money(a.price)}</b></div>
      </div>
    </div>
    <div class="wrap sec">
      <div class="card pad row" style="gap:10px;background:var(--p-soft);border-color:transparent">
        <span style="color:var(--p)">${icon('bell', 19)}</span>
        <div class="sm" style="color:var(--tx-2)">${t('Напомним за 24 часа и за 2 часа до визита')}</div>
      </div>
    </div>
    <div class="wrap sec">
      <div class="card pad row" style="gap:12px">
        <div class="tint" style="background:var(--sf-3)">${icon('pin', 18)}</div>
        <div class="grow"><div class="b sm">${esc(c.name)}</div><div class="tiny muted">${esc(c.addr)}</div></div>
      </div>
    </div>
    <div class="wrap sec"><div class="btns">
      <button class="btn gh" data-a="cl.done">${t('Закрыть')}</button>
      <button class="btn p" data-a="cl.goMy">${t('Мои записи')}</button>
    </div></div>`;
  },
});
on('cl.goMy', () => resetStack('cl.my'));
on('cl.done', () => {
  // «Закрыть» возвращает туда, откуда человек пришёл в приложение, —
  // на страницу своего салона: другого у него нет.
  viewCompany(homeId());
  resetStack('cl.company');
});

/* =========================================================
   Мои записи
   ========================================================= */
/* Один журнал без вкладок и фильтров. Раньше экран делился на
   «Предстоящие» и «Историю», а история — ещё на «Все / Выполненные /
   Отменённые». Человек с двумя записями листал три уровня группировки,
   чтобы увидеть две строки. Теперь это одна лента: ближайший визит
   наверху, дальше вниз по времени. Разница между будущим и прошлым
   видна по самой карточке, и называть её отдельно не нужно. */
const myf = { limit: 12 };
const STEP = 12;

route('cl.my', {
  tab: 'cl.my',
  render() {
    const all = myAppts();
    const isUp = a => a.status === 'planned' && new Date(a.start) > now();
    // ближайшая запись первой, за ней остальные будущие, следом прошлое
    // от свежего к старому — так лента читается сверху вниз одним куском
    const journal = [
      ...all.filter(isUp).sort((a, b) => new Date(a.start) - new Date(b.start)),
      ...all.filter(a => !isUp(a)),
    ];
    const shown = journal.slice(0, myf.limit);
    const nextId = (journal.find(isUp) || {}).id;
    const sub = (homeCo() || co() || {}).name || '';

    if (!journal.length) {
      return `
      <div class="top"><div class="grow"><div class="top-t">${t('Мои записи')}</div><div class="top-sub">${esc(sub)}</div></div>
        <button class="ico-btn p" data-a="cl.start">${icon('plus', 19)}</button></div>
      <div class="wrap">${emptyState({
        ic: 'calendar', title: t('Пока нет записей'),
        text: t('Выберите услугу и удобное время — это займёт полминуты.'),
        action: t('Записаться'), act: 'cl.start',
      })}</div>`;
    }

    return `
    <div class="top"><div class="grow"><div class="top-t">${t('Мои записи')}</div><div class="top-sub">${esc(sub)}</div></div>
      <button class="ico-btn p" data-a="cl.start">${icon('plus', 19)}</button></div>

    <div class="wrap stack" style="margin-top:6px">
      ${shown.map(a => (isUp(a) ? upcomingCard(a, a.id === nextId) : historyCard(a))).join('')}
    </div>
    ${journal.length > shown.length ? `<div class="wrap" style="margin-top:12px">
      <button class="btn gh sm" data-a="my.more">${t('Показать ещё {n}', { n: Math.min(STEP, journal.length - shown.length) })}</button></div>` : ''}`;
  },
});
on('my.more', () => { myf.limit += STEP; rr(); });

/** Сколько осталось до визита — человеческим языком. */
function timeLeft(d) {
  const n = now();
  const days = Math.round((startOfDay(d) - startOfDay(n)) / 86400000);
  if (days > 1) return t('через {n} {u}', { n: days, u: plural(days, ['день', 'дня', 'дней']) });
  if (days === 1) return t('завтра');
  const min = Math.round((d - n) / 60000);
  if (min > 90) {
    const h = Math.round(min / 60);
    return t('через {n} {u}', { n: h, u: plural(h, ['час', 'часа', 'часов']) });
  }
  if (min > 0) return t('через {n} мин', { n: min });
  return t('скоро');
}

/* Салон записи. У своего салона подписи нет — это и так его приложение.
   Строка осталась ради старых баз: у тестировщика, ходившего по каталогу,
   в «Моих записях» могут лежать визиты в другие салоны, и без подписи
   такой журнал не прочитать. Новых записей не в своём салоне не бывает. */
function salonLine(a) {
  if (a.companyId === homeId()) return '';
  const c = co(a.companyId);
  if (!c) return '';
  return `<div class="tiny nowrap" style="color:var(--tx-3);margin-top:2px">${icon('building', 12, 2.4)} ${esc(c.name)}</div>`;
}

/* Ближайшая запись — главное на экране, поэтому у неё цветная шапка
   с датой и обратным отсчётом. Остальные предстоящие тише. */
function upcomingCard(a, first) {
  const e = emp(a.employeeId), d = new Date(a.start), end = apptEnd(a);
  return `<div class="card upc ${first ? 'upc-first' : ''}">
    <div class="upc-head">
      <span>${dateLabel(d, now())}, ${hhmm(d)} — ${hhmm(end)}</span>
      <span class="upc-left">${timeLeft(d)}</span>
    </div>
    <button class="press upc-body" data-a="cl.appt" data-id="${a.id}">
      <div class="row" style="gap:12px">
        ${avatar(e, 'm')}
        <div class="grow">
          <div class="upc-t nowrap">${esc(apptTitle(a))}</div>
          <div class="tiny muted nowrap">${esc(e ? e.name : '')} · ${nMin(a.duration)}</div>
          ${salonLine(a)}
        </div>
        <div class="b">${money(a.price)}</div>
      </div>
    </button>
    <div class="upc-acts">
      <button class="press" data-a="cl.move" data-id="${a.id}">${icon('history', 16)}${t('Перенести')}</button>
      <button class="press dan" data-a="cl.cancel" data-id="${a.id}">${icon('xCircle', 16)}${t('Отменить')}</button>
    </div>
  </div>`;
}

/* История: одна строка на визит. Бейдж «выполнена» убран — он был
   у каждой второй карточки и не нёс информации; отличается только отмена. */
function historyCard(a) {
  const e = emp(a.employeeId), d = new Date(a.start);
  const cancelled = a.status === 'cancelled';
  const rv = a.status === 'done' ? reviewFor(a.id) : null;
  return `<div class="card hist ${cancelled ? 'hist-off' : ''}">
    <button class="press hist-main" data-a="cl.appt" data-id="${a.id}">
      <div class="hist-d">
        <div class="n">${d.getDate()}</div>
        <div class="tiny dim">${MONTHS[d.getMonth()].slice(0, 3)}</div>
      </div>
      <div class="hist-sep"></div>
      <div class="grow">
        <div class="b sm nowrap">${esc(apptTitle(a))}</div>
        <div class="tiny muted nowrap">${hhmm(d)} · ${esc(e ? e.name : '')}</div>
        ${salonLine(a)}
        ${cancelled ? `<span class="bdg dan" style="margin-top:5px">${t('отменена')}</span>` : ''}
      </div>
      <div class="b sm">${moneyShort(a.price)} ₸</div>
    </button>
    <div class="hist-acts">
      ${cancelled ? '' : rv
      ? `<div class="rated">${[1, 2, 3, 4, 5].map(n => `<span style="opacity:${n <= rv.rating ? 1 : .25}">${icon('star', 13, 2.4)}</span>`).join('')}</div>`
      : `<button class="press star-btn" data-a="rv.open" data-id="${a.id}">${icon('star', 16)}${t('Оценить')}</button>`}
      <button class="press" data-a="cl.again" data-id="${a.id}">${icon('refresh', 16)}${t('Ещё раз')}</button>
    </div>
  </div>`;
}


export function openMyAppt(id) {
  const a = appt(id); if (!a) return;
  // салон берём из самой записи: список записей теперь сквозной по салонам
  const e = emp(a.employeeId), c = co(a.companyId) || co(), d = new Date(a.start);
  const can = a.status === 'planned' && new Date(a.start) > now();
  const s = sheet({
    title: t('Ваша запись'),
    body: `
      <div class="card flat" style="padding:14px;margin-bottom:12px">
        <div class="row between"><span class="sm muted">${t('Услуга')}</span><b>${esc(apptTitle(a))}</b></div>
        <div class="hr"></div>
        <div class="row between"><span class="sm muted">${t('Мастер')}</span><b>${esc(e ? e.name : '')}</b></div>
        <div class="hr"></div>
        <div class="row between"><span class="sm muted">${t('Когда')}</span><b>${dateLabel(d, now())}, ${hhmm(d)}</b></div>
        <div class="hr"></div>
        <div class="row between"><span class="sm muted">${t('Стоимость')}</span><b>${money(a.price)}</b></div>
      </div>
      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
        <div class="ic">${icon('pin', 18)}</div>
        <div class="grow"><div class="tl">${esc(c.name)}</div><div class="st">${esc(c.addr)}</div></div>
      </div>`,
    footer: can ? `<div class="btns">
        <button class="btn dan" data-a="cl.cancel" data-id="${a.id}">${t('Отменить')}</button>
        <button class="btn p" data-a="cl.move" data-id="${a.id}">${t('Перенести')}</button>
      </div>`
      : a.status === 'done' && !reviewFor(a.id) ? `<div class="btns">
        <button class="btn gh" data-a="cl.rate" data-id="${a.id}">${icon('star', 17)}${t('Оценить')}</button>
        <button class="btn p" data-a="cl.again" data-id="${a.id}">${t('Записаться снова')}</button>
      </div>`
        : `<button class="btn p" data-a="cl.again" data-id="${a.id}">${t('Записаться снова')}</button>`,
  });
  window.__ma = s;
}
on('cl.rate', ds => {
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  setTimeout(() => reviewSheet(ds.id, { after: rr }), 280);
});
on('cl.cancel', async ds => {
  const a = appt(ds.id);
  if (!a || a.status !== 'planned') { toast(t('Эту запись уже нельзя отменить'), 'dan'); return; }
  const e = emp(a.employeeId), d = new Date(a.start);
  const ok = await confirmSheet({
    title: t('Отменить запись?'),
    text: `${apptTitle(a)}
${e ? e.name : ''}
${dateLabel(d, now())}, ${hhmm(d)}

${t('Время снова станет свободным.')}`,
    ok: t('Отменить запись'), cancel: t('Не отменять'), danger: true,
  });
  if (!ok) return;
  if (!cancelAppointment(ds.id, 'client')) { toast(t('Эту запись уже нельзя отменить'), 'dan'); return; }
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  toast(t('Запись отменена'), 'dan');
  if (isServer()) pushNow().catch(() => { });
});
on('cl.again', ds => {
  const a = appt(ds.id); if (!a) return;
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  // запись могла быть в другом салоне — записываемся в него же, иначе
  // услуга и мастер окажутся из чужой компании
  viewCompany(a.companyId);
  book.reset(); book.st.svcId = a.serviceIds[0]; book.st.empId = a.employeeId; book.st.step = 3;
  setTimeout(() => go('cl.book'), 260);
});
/* Перенос — это та же запись, только у неё уже есть место в расписании.
   Раньше здесь была лента из 14 дней: ни месяца, ни понимания, где есть
   окна, и дальше двух недель перенести было нельзя, хотя записаться —
   можно на четыре месяца. Теперь общий выбор «дата → время». */
on('cl.move', ds => {
  const a = appt(ds.id); if (!a) return;
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  const e = emp(a.employeeId), cur = new Date(a.start);
  // Своё же время не считаем занятым: иначе человек, передумав, не смог бы
  // вернуться на него, а день выглядел бы плотнее, чем он есть.
  const opts = { ignoreId: a.id, companyId: a.companyId };
  const head = `<div class="card flat" style="padding:12px 14px;margin-bottom:12px;display:flex;gap:12px;align-items:center">
      ${avatar(e, 'm')}
      <div class="grow" style="min-width:0"><div class="b sm nowrap">${esc(apptTitle(a))}</div>
        <div class="tiny muted nowrap">${esc(e ? e.name : '')} · ${nMin(a.duration)}</div></div>
    </div>`;
  pickSlot({
    title: 'Перенести запись', head, date: cur, from: cur,
    slotsOn: d => slotsFor([a.employeeId], d, a.duration, opts),
    okLabel: min => t('Перенести на {t}', { t: toHM(min) }),
    confirm: { title: 'Перенести запись?', ok: 'Перенести', note: 'Старое время снова станет свободным.' },
    done: { text: 'Запись перенесена', note: 'Новое время уже в «Моих записях».' },
    onPick: ({ date }) => {
      moveAppointment(a.id, date, null);
      if (isServer()) pushNow().catch(() => { });
    },
  });
});

/* =========================================================
   Профиль клиента
   ========================================================= */
route('cl.profile', {
  tab: 'cl.profile',
  render() {
    // личность общая для всех салонов, статистика — по всем визитам сразу
    const me = person() || my() || { name: t('Гость'), initials: 'Г' };
    const st = myStats();
    return `
    <div class="top"><div class="grow"><div class="top-t">${t('Профиль')}</div></div></div>
    <div class="center wrap">
      ${avatar(me, 'xl')}
      <div style="font-size:21px;font-weight:780;letter-spacing:-.03em;margin-top:12px">${esc(me.name)}</div>
      <div class="sm muted">${esc(me.phone ? prettyPhone(me.phone) : t('телефон не указан'))}</div>
      ${me.tg ? `<div class="tiny dim" style="margin-top:2px">@${esc(String(me.tg).replace(/^@/, ''))}</div>` : ''}
    </div>
    ${/* Три числа без подписей читались как ребус: «3», «сегодня», «1».
         Теперь у каждого есть и название сверху, и пояснение снизу. */''}
    <div class="wrap sec">${statBar([
      [t('Визиты'), st.visits, t('всего')],
      [t('Последний'), st.last ? relShort(new Date(st.last.start), now()) : '—', st.last ? dateFull(new Date(st.last.start)) : t('визитов не было')],
      [t('Впереди'), st.next ? 1 : 0, st.next ? dateLabel(new Date(st.next.start), now()).toLowerCase() : t('записей нет')],
    ])}</div>
    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.editMe">
        <div class="ic">${icon('user', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Мои данные')}</div>
          <div class="st"${me.phone ? '' : ' style="color:var(--warn)"'}>${me.phone ? t('Имя и телефон') : t('Добавьте телефон')}</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="tab" data-r="cl.my">
        <div class="ic">${icon('history', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('История визитов')}</div><div class="st">${st.visits} ${plural(st.visits, ['запись', 'записи', 'записей'])}</div></div>${icon('fwd', 17)}</button>
      ${myTicketsRow()}
    </div></div>

    <div class="wrap sec"><div class="stack s">
      <div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
        <div class="ic">${icon('msg', 18)}</div>
        <div class="grow"><div class="tl">${t('Язык')}</div>
          <div class="st">${esc((LANGS.find(l => l.id === lang()) || LANGS[0]).t)}</div></div>
        <div class="seg" style="width:150px">
          ${LANGS.map(l => `<button class="${lang() === l.id ? 'on' : ''}" data-a="cl.lang" data-v="${l.id}">${esc(l.short)}</button>`).join('')}
        </div>
      </div>
    </div></div>

    ${quietSection()}`;
  },
});

/* Тихий раздел внизу профиля: три вещи, которые нужны редко и которым
   не место ни на странице салона, ни выше по профилю. Поддержка первой —
   в девяти случаях из десяти человеку нужна она, а не жалоба. Строки
   без цветных иконок: это не действия, а запасной выход. */
function quietSection() {
  const cab = isServer() ? myCabinet() : null;
  return `<div class="wrap sec">
    <div class="sec-t" style="margin-bottom:8px;color:var(--tx-3)">${t('Ещё')}</div>
    <div class="stack s">
      ${cab ? `<button class="lrow press quiet-row" data-a="cl.toCabinet">
        <div class="ic">${icon('briefcase', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Вернуться в кабинет')}</div>
          <div class="st">${esc((session() || {}).memberships.find(m => m.companyId === cab.companyId).companyName || '')}</div></div>${icon('fwd', 17)}</button>` : ''}
      <button class="lrow press quiet-row" data-a="cl.support">
        <div class="ic">${icon('msg', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Написать в поддержку')}</div>
          <div class="st">${t('Вопрос по приложению или записи')}</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press quiet-row" data-a="cl.complain">
        <div class="ic">${icon('shield', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Пожаловаться на салон')}</div>
          <div class="st">${t('Разберётся поддержка платформы')}</div></div>${icon('fwd', 17)}</button>
      ${cab ? '' : `<button class="lrow press quiet-row" data-a="cl.toBiz">
        <div class="ic">${icon('briefcase', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Создать свой бизнес')}</div>
          <div class="st">${t('Своя страница записи за пару минут')}</div></div>${icon('fwd', 17)}</button>`}
    </div>
  </div>`;
}
on('cl.toBiz', () => go('biz.start'));
on('cl.toCabinet', () => {
  const cab = myCabinet(); if (!cab) return;
  const r = enterCompany(cab.companyId);
  if (r) { emit(); resetStack(r.r); }
});

/* Вопрос в поддержку платформы — не про салон, а про само приложение.
   Отдельно от жалобы намеренно: человек, у которого не приходят
   напоминания, не должен выбирать между «грубое обращение» и «другое». */
on('cl.support', () => supportSheet({
  note: 'Отвечает поддержка платформы, а не салон. Ответ придёт сюда, в «Мои обращения».',
  onSend: ({ topic, subject, text }) => { addClientTicket({ topic, subject, text }); rr(); },
}));

on('cl.editMe', () => {
  const me = person() || my() || {};
  myDataSheet({
    name: me.name || '', phone: me.phone || '', tg: me.tg || '',
    note: 'Телефон видит только салон, в который вы записались — по нему с вами свяжутся, если время сдвинется.',
    // меняем во всех салонах сразу: это один человек, а не однофамильцы
    onSave: v => updatePerson(v),
  });
});
