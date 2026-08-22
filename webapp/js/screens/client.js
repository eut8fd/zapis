import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor, apptEnd,
  now, today, slotsFor, nextFreeFor, createAppointment, cancelAppointment, clientStats, clientAppts,
  reviews, toHM, moveAppointment, updateClient, emit, reviewFor, pendingReviews,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, dateFull, relPast, avatar, emptyState, sheet, toast,
  confirmSheet, demoNote, promptSheet, nMin, plural, dayKey, startOfDay, addDays, WD, WD_FULL, MONTHS, wait, loadingBlock,
  monthGrid, MONTH_NAMES,
} from '../ui.js';
import { icon, catIcon } from '../icons.js';
import { route, go, render, resetStack } from '../router.js';
import { on } from '../bus.js';
import { haptic, openLink, tgClose, copy } from '../tg.js';
import { BOT_USERNAME } from '../config.js';
import { dateStrip, reviewSheet, tipOnce } from '../flows.js';

const rr = () => render(false);
const my = () => client(S.session.clientId) || clients()[0];

/** Стаж мастера для клиента — только если владелец разрешил показ (§68). */
function expLine(e) {
  if (!e || !e.since || e.showExp === false) return '';
  const y = Math.max(0, now().getFullYear() - e.since);
  if (!y) return '';
  return `<div class="tiny dim nowrap">опыт ${y} ${plural(y, ['год', 'года', 'лет'])}</div>`;
}

/* =========================================================
   Страница компании (клиент)
   ========================================================= */
route('cl.company', {
  tab: 'cl.company',
  mount() {
    tipOnce('cl.book', {
      title: 'Записаться — одна кнопка',
      text: 'Услуга, мастер, дата и время. Занятые дни в календаре зачёркнуты, а перенести или отменить запись можно прямо в «Моих записях».',
      ic: 'calendarPlus',
    });
  },
  render() {
    const c = co();
    const me = my();
    const list = svcs().slice(0, 5);
    const team = staff();
    const st = me ? clientStats(me.id) : { next: null, visits: 0 };

    const col = c.color === '#0D1220' ? '#2B3340' : c.color;
    const today = c.hours[now().getDay()] || {};
    // Фото салона — фон самой шапки, а не отдельная полоса сверху:
    // два разных блока подряд читались как склейка. Градиент поверх фото
    // нужен, чтобы белый текст оставался читаемым на любом снимке.
    const heroBg = c.cover
      ? `background-image:linear-gradient(170deg,rgba(12,16,32,.30) 0%,rgba(12,16,32,.78) 100%),url('${c.cover}')`
      : `background-image:linear-gradient(160deg,${col} 0%,#6D5BF6 100%)`;

    return `
    <div class="pub-hero ${c.cover ? 'has-cover' : ''}" style="${heroBg}">
      <div class="row between">
        ${c.logo ? `<div class="av l av-sq av-photo pub-logo" style="background-image:url('${c.logo}')"></div>`
        : `<div class="av l av-sq pub-logo" style="background:rgba(255,255,255,.2)">${esc(c.initials)}</div>`}
        <button class="ico-btn pub-share" data-a="cl.share">${icon('share', 19)}</button>
      </div>
      <div class="nm">${esc(c.name)}</div>
      <div class="pub-meta">
        <span class="pill">${icon('pin', 13, 2.4)}${esc(c.city)}</span>
        <span class="pill">${icon('clock', 13, 2.4)}${today.on ? today.from + ' — ' + today.to : 'сегодня выходной'}</span>
      </div>
      <div class="pub-addr">${esc(c.addr)}</div>
    </div>

    <div class="wrap pub-cta">
      <button class="btn hero-cta" style="color:${col}" data-a="cl.start">
        ${icon('calendarPlus', 20)}Записаться
      </button>
    </div>

    ${st.next ? `<div class="wrap sec">
      <div class="sec-t" style="margin-bottom:8px">Ваша запись</div>
      <button class="card press" style="width:100%;padding:14px;text-align:left;display:flex;gap:12px;align-items:center;border-color:var(--p)" data-a="cl.appt" data-id="${st.next.id}">
        <div class="tint" style="background:var(--p-soft);color:var(--p);width:44px;height:44px">${icon('calendar', 21)}</div>
        <div class="grow">
          <div class="b">${dateLabel(new Date(st.next.start), now())}, ${hhmm(new Date(st.next.start))}</div>
          <div class="sm muted nowrap">${esc(apptTitle(st.next))} · ${esc((emp(st.next.employeeId) || {}).name.split(' ')[0] || '')}</div>
        </div>${icon('fwd', 18)}
      </button>
    </div>` : ''}

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Услуги</div>
        <button class="sec-a" data-a="cl.start">Все ${svcs().length} ${icon('fwd', 14, 2.4)}</button></div>
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
      <div class="sec-h"><div class="sec-t">Специалисты</div></div>
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
            <div class="tiny" style="color:var(--ok);font-weight:650;margin-top:4px">${nf ? (dayKey(nf.date) === dayKey(now()) ? 'сегодня ' : dayKey(nf.date) === dayKey(addDays(today(), 1)) ? 'завтра ' : nf.date.getDate() + ' ' + MONTHS[nf.date.getMonth()].slice(0, 3) + ' ') + nf.slot.t : 'нет мест'}</div>
          </button>`;
    }).join('')}
      </div>
    </div>


    <div class="sec">
      <div class="sec-h"><div class="sec-t">Контакты</div></div>
      <div class="wrap stack s">
        <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.call">
          <div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon('phone', 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl">${esc(c.phone)}</div><div class="st">Позвонить</div></div></button>
        <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.map">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('pin', 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl">${esc(c.addr)}</div><div class="st">${esc(c.city)}</div></div></button>
        <div class="lrow" style="border-radius:16px;border:1px solid var(--bd)">
          <div class="ic">${icon('clock', 18)}</div>
          <div class="grow"><div class="tl">Сегодня ${(c.hours[now().getDay()] || {}).on ? c.hours[now().getDay()].from + ' — ' + c.hours[now().getDay()].to : 'выходной'}</div>
            <div class="st">${esc(c.about || '')}</div></div></div>
      </div>
    </div>`;
  },
});
on('cl.share', async () => {
  const c = co();
  const link = 'https://t.me/' + BOT_USERNAME + '?start=' + c.id;
  await copy(link);
  sheet({
    title: 'Поделиться салоном',
    body: `<div class="center" style="padding:4px 0 12px">
        ${avatar({ initials: c.initials, color: c.color === '#0D1220' ? '#2B3340' : c.color }, 'xl', 'av-sq')}
        <div class="b" style="font-size:17px;margin-top:12px">${esc(c.name)}</div>
        <div class="sm muted">${esc(c.cat)} · ${esc(c.city)}</div>
      </div>
      <div class="card flat" style="padding:13px;text-align:center">
        <div class="tiny muted">Ссылка скопирована</div>
        <div class="b sm" style="margin-top:4px;word-break:break-all">${esc(link)}</div>
      </div>`,
    footer: `<button class="btn p" data-a="cl.shareTg" data-link="${esc(link)}">${icon('send', 18)}Отправить в Telegram</button>`,
  });
});
on('cl.shareTg', ds => {
  openLink('https://t.me/share/url?url=' + encodeURIComponent(ds.link) +
    '&text=' + encodeURIComponent('Записывайтесь онлайн — свободное время видно сразу'));
});
on('cl.call', () => {
  const p = co().phone;
  if (!p) { toast('Номер не указан', 'dan'); return; }
  openLink('tel:' + p.replace(/[^\d+]/g, ''));
});
on('cl.map', () => {
  const c = co();
  const q = encodeURIComponent(c.city + ', ' + c.addr);
  sheet({
    title: 'Как добраться',
    body: `<div class="card flat" style="padding:14px;margin-bottom:12px">
        <div class="row" style="gap:10px"><span style="color:var(--p)">${icon('pin', 19)}</span>
          <div class="grow"><div class="b sm">${esc(c.addr)}</div><div class="tiny muted">${esc(c.city)}</div></div></div>
        <div class="hr"></div>
        <div class="row" style="gap:10px"><span style="color:var(--tx-3)">${icon('clock', 19)}</span>
          <div class="sm">${(c.hours[now().getDay()] || {}).on ? 'Сегодня ' + c.hours[now().getDay()].from + ' — ' + c.hours[now().getDay()].to : 'Сегодня выходной'}</div></div>
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
      ? 'Услуги мастера'
      : ['', 'Выберите услугу', 'Выберите мастера', 'Выберите дату', 'Выберите время'][s.step];
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
          <div class="tiny muted">${esc(e.role)}${e.since && e.showExp !== false ? ' · опыт ' + Math.max(0, now().getFullYear() - e.since) + ' ' + plural(Math.max(0, now().getFullYear() - e.since), ['год', 'года', 'лет']) : ''}</div>
        </div>
        <button class="btn xs gh" style="width:auto" data-a="bk.anyEmp">Другой мастер</button>
      </div>
    </div>` : '';

  if (!list.length) {
    return head + `<div class="wrap sec">${emptyState({
      ic: 'briefcase', title: 'У мастера пока нет услуг',
      text: 'Выберите другого специалиста — покажем всё, что он делает.',
      action: 'Все мастера', act: 'bk.anyEmp',
    })}</div>`;
  }

  return head + Object.keys(byCat).map(cat => `
    <div class="sec" style="margin-top:6px">
      <div class="sec-h"><div class="sec-t" style="font-size:13px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em">${CATN[cat] || 'Услуги'}</div></div>
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
        <div class="grow" style="text-align:left"><div class="tl">Любой специалист</div><div class="st">Покажем самое раннее время</div></div>
        <span class="chev">${icon('fwd', 17, 2)}</span></button>
      ${list.map(e => {
    const nf = nextFreeFor(e.id, s ? s.duration : 60);
    return `<button class="lrow press" style="border-radius:18px;border:1px solid var(--bd);width:100%;padding:13px 14px" data-a="bk.emp" data-id="${e.id}">
          ${avatar(e, 'm')}
          <div class="grow" style="text-align:left">
            <div class="tl">${esc(e.name)}</div><div class="st">${esc(e.role)}${e.since && e.showExp !== false ? ' · опыт ' + Math.max(0, now().getFullYear() - e.since) + ' ' + plural(Math.max(0, now().getFullYear() - e.since), ['год', 'года', 'лет']) : ''}</div>
            ${nf ? `<div class="tiny" style="color:var(--ok);font-weight:650;margin-top:3px">${icon('clock', 11, 2.4)} ближайшее — ${dateLabel(nf.date, now()).toLowerCase()}, ${nf.slot.t}</div>` : '<div class="tiny dim" style="margin-top:3px">нет свободного времени</div>'}
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
        <span><i></i>есть свободное время</span>
        <span style="opacity:.6">зачёркнуто — мест нет</span>
      </div>
    </div>

    <div class="wrap sec">
      <div class="tiny dim center">Листайте месяцы стрелками — записаться можно на 4 месяца вперёд</div>
    </div>`;
}

function step4() {
  const s = book.st;
  const sv = svc(s.svcId);
  const empIds = s.empId ? [s.empId] : staff().filter(e => !sv || sv.employeeIds.includes(e.id)).map(e => e.id);
  const slots = slotsFor(empIds, s.date, sv ? sv.duration : 60);
  const free = slots.filter(x => x.free);
  const morning = free.filter(x => x.min < 12 * 60), day = free.filter(x => x.min >= 12 * 60 && x.min < 17 * 60), eve = free.filter(x => x.min >= 17 * 60);
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
    ${free.length ? grp('Утро', morning) + grp('День', day) + grp('Вечер', eve)
      : `<div class="wrap">${emptyState({ ic: 'clock', title: 'На этот день мест нет', text: 'Выберите другую дату — свободное время найдётся.' })}</div>`}
    ${s.min != null ? `<div class="fixbar" style="padding:12px 16px calc(12px + var(--safe-b));background:var(--sf);border-top:1px solid var(--bd)">
      <button class="btn p" style="height:54px" data-a="bk.confirm">Подтвердить · ${money(sv.price)}</button>
    </div>` : ''}`;
}

function summaryRow() {
  const s = book.st, sv = svc(s.svcId), e = s.empId ? emp(s.empId) : null;
  return `<div class="card flat" style="padding:12px 14px;display:flex;gap:12px;align-items:center">
    <div class="tint" style="background:${sv ? sv.color + '1f' : 'var(--p-soft)'};color:${sv ? sv.color : 'var(--p)'}">${sv ? catIcon(sv.cat, 18) : icon('briefcase', 18)}</div>
    <div class="grow"><div class="b sm nowrap">${esc(sv ? sv.name : '')}</div>
      <div class="tiny muted">${sv ? nMin(sv.duration) : ''}${e ? ' · ' + esc(e.name.split(' ')[0]) : ' · любой мастер'}</div></div>
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
/* «Другой мастер» на списке услуг: снимаем привязку и показываем всё */
on('bk.anyEmp', () => { book.st.empId = null; book.st.fixedEmp = false; book.st.step = 1; rr(); });
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
  if (!empId) { toast('Это время уже заняли', 'dan'); rr(); return; }
  const d = new Date(s.date); d.setHours(Math.floor(s.min / 60), s.min % 60, 0, 0);
  const sh = sheet({ title: 'Подтверждение', body: loadingBlock('Бронируем время…') });
  await wait(1100);
  const a = createAppointment({ clientId: my().id, employeeId: empId, serviceIds: [sv.id], start: d, source: 'client' });
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
      <div class="t">Готово!</div>
      <div class="s">Вы записаны</div>
    </div>
    <div class="wrap">
      <div class="card pad">
        <div class="row between" style="padding:2px 0"><span class="sm muted">Услуга</span><b>${esc(apptTitle(a))}</b></div>
        <div class="hr"></div>
        <div class="row between" style="padding:2px 0"><span class="sm muted">Мастер</span><b>${esc(e ? e.name : '')}</b></div>
        <div class="hr"></div>
        <div class="row between" style="padding:2px 0"><span class="sm muted">Когда</span><b>${dateLabel(d, now())}, ${hhmm(d)}</b></div>
        <div class="hr"></div>
        <div class="row between" style="padding:2px 0"><span class="sm muted">Стоимость</span><b style="font-size:17px">${money(a.price)}</b></div>
      </div>
    </div>
    <div class="wrap sec">
      <div class="card pad row" style="gap:10px;background:var(--p-soft);border-color:transparent">
        <span style="color:var(--p)">${icon('bell', 19)}</span>
        <div class="sm" style="color:var(--tx-2)">Напомним за 24 часа и за 2 часа до визита</div>
      </div>
    </div>
    <div class="wrap sec">
      <div class="card pad row" style="gap:12px">
        <div class="tint" style="background:var(--sf-3)">${icon('pin', 18)}</div>
        <div class="grow"><div class="b sm">${esc(c.name)}</div><div class="tiny muted">${esc(c.addr)}</div></div>
      </div>
    </div>
    <div class="wrap sec"><div class="btns">
      <button class="btn gh" data-a="cl.done">Закрыть</button>
      <button class="btn p" data-a="cl.goMy">Мои записи</button>
    </div></div>`;
  },
});
on('cl.goMy', () => resetStack('cl.my'));
on('cl.done', () => resetStack('cl.company'));

/* =========================================================
   Мои записи
   ========================================================= */
route('cl.my', {
  tab: 'cl.my',
  render() {
    const me = my();
    const all = clientAppts(me.id);
    const up = all.filter(a => a.status === 'planned' && new Date(a.start) > now()).sort((a, b) => new Date(a.start) - new Date(b.start));
    const past = all.filter(a => !(a.status === 'planned' && new Date(a.start) > now()));
    const wait2 = pendingReviews(me.id)[0];
    return `
    <div class="top"><div class="grow"><div class="top-t">Мои записи</div><div class="top-sub">${esc(co().name)}</div></div>
      <button class="ico-btn p" data-a="cl.start">${icon('plus', 19)}</button></div>

    ${wait2 ? `<div class="wrap" style="margin-top:6px">
      <button class="card press" style="width:100%;padding:14px;display:flex;gap:12px;align-items:center;text-align:left;border-color:#F5A524"
        data-a="rv.open" data-id="${wait2.id}">
        <div class="tint" style="background:rgba(245,165,36,.14);color:#F5A524;width:44px;height:44px">${icon('star', 21)}</div>
        <div class="grow"><div class="b">Как прошёл визит?</div>
          <div class="sm muted nowrap">${esc(apptTitle(wait2))} · ${relPast(new Date(wait2.start), now())}</div></div>
        ${icon('fwd', 18)}
      </button>
    </div>` : ''}

    ${up.length ? `<div class="sec" style="margin-top:6px">
      <div class="sec-h"><div class="sec-t">Предстоящие</div></div>
      <div class="wrap stack s">${up.map(a => card(a, true)).join('')}</div>
    </div>` : `<div class="wrap">${emptyState({ ic: 'calendar', title: 'Пока нет записей', text: 'Выберите услугу и удобное время — это займёт полминуты.', action: 'Записаться', act: 'cl.start' })}</div>`}

    ${past.length ? `<div class="sec">
      <div class="sec-h"><div class="sec-t">История</div></div>
      <div class="wrap stack s">${past.slice(0, 12).map(a => card(a, false)).join('')}</div>
    </div>` : ''}`;
  },
});
function card(a, active) {
  const e = emp(a.employeeId), d = new Date(a.start);
  const st = a.status;
  const rv = st === 'done' ? reviewFor(a.id) : null;
  return `<div class="card" style="padding:0;${active ? 'border-color:var(--p)' : 'opacity:.9'}">
    <button class="press" style="width:100%;padding:14px;display:flex;gap:12px;align-items:center" data-a="cl.appt" data-id="${a.id}">
      <div class="col center" style="width:46px;flex:none">
        <div style="font-size:19px;font-weight:750;letter-spacing:-.03em">${d.getDate()}</div>
        <div class="tiny dim">${MONTHS[d.getMonth()].slice(0, 3)}</div>
      </div>
      <div style="width:1px;align-self:stretch;background:var(--bd)"></div>
      <div class="grow">
        <div class="b sm">${hhmm(d)} · ${esc(apptTitle(a))}</div>
        <div class="tiny muted">${esc(e ? e.name : '')}</div>
        ${st === 'cancelled' ? '<span class="bdg dan" style="margin-top:4px">отменена</span>'
      : st === 'done' ? '<span class="bdg ok" style="margin-top:4px">выполнена</span>' : ''}
      </div>
      <div class="b sm">${moneyShort(a.price)} ₸</div>
    </button>
    ${active ? `<div class="row" style="gap:0;border-top:1px solid var(--bd)">
      <button class="press" style="flex:1;padding:12px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:13.5px;font-weight:650;color:var(--p)"
        data-a="cl.move" data-id="${a.id}">${icon('history', 16)}Перенести</button>
      <div style="width:1px;align-self:stretch;background:var(--bd)"></div>
      <button class="press" style="flex:1;padding:12px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:13.5px;font-weight:650;color:var(--dan)"
        data-a="cl.cancel" data-id="${a.id}">${icon('xCircle', 16)}Отменить</button>
    </div>` : st === 'done' ? `<div class="row" style="gap:0;border-top:1px solid var(--bd)">
      ${rv ? `<div class="row" style="flex:1;padding:12px;justify-content:center;gap:5px;color:#F5A524;font-size:13px;font-weight:650">
          ${icon('star', 15, 2.4)}${rv.rating}.0 — спасибо за отзыв</div>`
      : `<button class="press" style="flex:1;padding:12px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:13.5px;font-weight:650;color:#F5A524"
          data-a="rv.open" data-id="${a.id}">${icon('star', 16)}Оценить</button>`}
      <div style="width:1px;align-self:stretch;background:var(--bd)"></div>
      <button class="press" style="flex:1;padding:12px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:13.5px;font-weight:650;color:var(--p)"
        data-a="cl.again" data-id="${a.id}">${icon('refresh', 16)}Ещё раз</button>
    </div>` : ''}
  </div>`;
}


export function openMyAppt(id) {
  const a = appt(id); if (!a) return;
  const e = emp(a.employeeId), c = co(), d = new Date(a.start);
  const can = a.status === 'planned' && new Date(a.start) > now();
  const s = sheet({
    title: 'Ваша запись',
    body: `
      <div class="card flat" style="padding:14px;margin-bottom:12px">
        <div class="row between"><span class="sm muted">Услуга</span><b>${esc(apptTitle(a))}</b></div>
        <div class="hr"></div>
        <div class="row between"><span class="sm muted">Мастер</span><b>${esc(e ? e.name : '')}</b></div>
        <div class="hr"></div>
        <div class="row between"><span class="sm muted">Когда</span><b>${dateLabel(d, now())}, ${hhmm(d)}</b></div>
        <div class="hr"></div>
        <div class="row between"><span class="sm muted">Стоимость</span><b>${money(a.price)}</b></div>
      </div>
      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
        <div class="ic">${icon('pin', 18)}</div>
        <div class="grow"><div class="tl">${esc(c.name)}</div><div class="st">${esc(c.addr)}</div></div>
      </div>`,
    footer: can ? `<div class="btns">
        <button class="btn dan" data-a="cl.cancel" data-id="${a.id}">Отменить</button>
        <button class="btn p" data-a="cl.move" data-id="${a.id}">Перенести</button>
      </div>`
      : a.status === 'done' && !reviewFor(a.id) ? `<div class="btns">
        <button class="btn gh" data-a="cl.rate" data-id="${a.id}">${icon('star', 17)}Оценить</button>
        <button class="btn p" data-a="cl.again" data-id="${a.id}">Записаться снова</button>
      </div>`
        : `<button class="btn p" data-a="cl.again" data-id="${a.id}">Записаться снова</button>`,
  });
  window.__ma = s;
}
on('cl.rate', ds => {
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  setTimeout(() => reviewSheet(ds.id, { after: rr }), 280);
});
on('cl.cancel', async ds => {
  const a = appt(ds.id); if (!a) return;
  const e = emp(a.employeeId), d = new Date(a.start);
  const ok = await confirmSheet({
    title: 'Отменить запись?',
    text: `${apptTitle(a)}
${e ? e.name : ''}
${dateLabel(d, now())}, ${hhmm(d)}

Время снова станет свободным.`,
    ok: 'Отменить запись', cancel: 'Не отменять', danger: true,
  });
  if (!ok) return;
  cancelAppointment(ds.id, 'client');
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  toast('Запись отменена', 'dan');
});
on('cl.again', ds => {
  const a = appt(ds.id); if (!a) return;
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  book.reset(); book.st.svcId = a.serviceIds[0]; book.st.empId = a.employeeId; book.st.step = 3;
  setTimeout(() => go('cl.book'), 260);
});
on('cl.move', ds => {
  const a = appt(ds.id); if (!a) return;
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  let date = startOfDay(new Date(a.start)); if (date < today()) date = today();
  let pick = null;
  const s = sheet({ title: 'Перенести', body: '' });
  const draw = () => {
    const slots = slotsFor([a.employeeId], date, a.duration, { ignoreId: a.id });
    s.set({
      title: 'Выберите новое время',
      body: `<div style="margin:0 -18px 14px">${dateStrip(date, 'cm.date', 14)}</div>
        ${slots.filter(x => x.free).length ? `<div class="slots">${slots.filter(x => x.free).map(x => `<button class="slot ${pick === x.min ? 'on' : ''}" data-a="cm.slot" data-m="${x.min}">${x.t}</button>`).join('')}</div>`
        : `<div class="empty" style="padding:20px"><div class="t" style="font-size:15px">Мест нет</div><div class="s">Выберите другой день</div></div>`}`,
      footer: `<button class="btn p" data-a="cm.ok" data-id="${a.id}" ${pick == null ? 'disabled' : ''}>Перенести${pick != null ? ' на ' + toHM(pick) : ''}</button>`,
    });
  };
  on('cm.date', d2 => { date = new Date(+d2.d); pick = null; draw(); });
  on('cm.slot', d2 => { pick = +d2.m; haptic('select'); draw(); });
  on('cm.ok', d2 => {
    const dt = new Date(date); dt.setHours(Math.floor(pick / 60), pick % 60, 0, 0);
    moveAppointment(d2.id, dt, null);
    s.close(); toast('Запись перенесена');
  });
  draw();
});

/* =========================================================
   Профиль клиента
   ========================================================= */
route('cl.profile', {
  tab: 'cl.profile',
  render() {
    const me = my();
    const st = clientStats(me.id);
    return `
    <div class="top"><div class="grow"><div class="top-t">Профиль</div></div></div>
    <div class="center wrap">
      ${avatar(me, 'xl')}
      <div style="font-size:21px;font-weight:780;letter-spacing:-.03em;margin-top:12px">${esc(me.name)}</div>
      <div class="sm muted">${esc(me.phone || '')}</div>
    </div>
    <div class="wrap sec"><div class="grid3">
      <div class="st-card center"><div class="v">${st.visits}</div><div class="l">визитов</div></div>
      <div class="st-card center"><div class="v">${st.last ? relPast(new Date(st.last.start), now()).replace(' назад', '') : '—'}</div><div class="l">последний визит</div></div>
      <div class="st-card center"><div class="v">${st.next ? 1 : 0}</div><div class="l">впереди</div></div>
    </div></div>
    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.editMe">
        <div class="ic">${icon('user', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Мои данные</div><div class="st">Имя и телефон</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="tab" data-r="cl.my">
        <div class="ic">${icon('history', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">История визитов</div><div class="st">${st.visits} записей</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.notif">
        <div class="ic">${icon('bell', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">Напоминания</div><div class="st">Включены</div></div>${icon('fwd', 17)}</button>

    </div></div>`;
  },
});
on('cl.editMe', async () => {
  const me = my();
  const v = await promptSheet({ title: 'Моё имя', label: 'Как к вам обращаться?', value: me.name });
  if (v) { updateClient(me.id, { name: v, initials: v.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() }); toast('Сохранено'); }
});
on('cl.notif', () => demoNote('Напоминания',
  'Бот напомнит о визите за 24 часа и за 2 часа — сообщением в этот чат. Отключить можно в любой момент.',
  'В демо это работает для записей, сделанных прямо в чате бота: записи из приложения хранятся только в этом браузере.'));
