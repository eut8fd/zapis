import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor, apptEnd,
  now, today, slotsFor, nextFreeFor, createAppointment, cancelAppointment, clientStats, clientAppts,
  reviews, toHM, moveAppointment, updateClient, emit, reviewFor,
  homeId, homeCo, isBound, person, myClient, ensureMyClient, updatePerson, myAppts, myStats,
  myCompanies, catalogVisible, catalogCats, catalogCities, catalogSearch, minPrice,
  nextFreeInCompany, viewCompany, askGeo, geo, distanceTo, forgetGeo,
} from '../store.js';
import {
  esc, money, moneyShort, hhmm, dateLabel, dateFull, relPast, avatar, emptyState, sheet, toast,
  confirmSheet, promptSheet, nMin, plural, dayKey, startOfDay, addDays, WD, WD_FULL, MONTHS, wait, loadingBlock,
  monthGrid, MONTH_NAMES, MON_SHORT, brandGradient, t,
} from '../ui.js';
import { icon, catIcon } from '../icons.js';
import { route, go, render, resetStack } from '../router.js';
import { on } from '../bus.js';
import { haptic, openLink, tgClose, copy } from '../tg.js';
import { BOT_USERNAME } from '../config.js';
import { LANGS, lang } from '../i18n.js';
import { setLang } from '../store.js';
import { dateStrip, reviewSheet, tipOnce } from '../flows.js';

const rr = () => render(false);
// Карточка человека в открытом сейчас салоне. null — он тут ещё не
// записывался: заводить карточку от одного просмотра салон не должен.
const my = () => myClient();

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
  // Свой салон светит вкладку «Салон». Чужой, открытый из каталога, светит
  // «Поиск» — а у привязанного клиента не светит ничего: он ушёл в сторону
  // от своего салона, и делать вид, что чужой салон и есть его, нельзя.
  tab: () => (cid() === homeId() ? 'cl.company' : isBound() ? 'none' : 'cl.find'),
  mount() {
    if (cid() !== homeId()) return;
    tipOnce('cl.book', {
      title: 'Записаться — одна кнопка',
      text: 'Услуга, мастер, дата и время. Занятые дни в календаре зачёркнуты, а перенести или отменить запись можно прямо в «Моих записях».',
      ic: 'calendarPlus',
    });
  },
  render() {
    const c = co();
    const me = my();
    const mine = c.id === homeId();
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

    return `
    <div class="pub-hero ${c.cover ? 'has-cover' : ''}" style="${heroBg}">
      <div class="row between">
        ${c.logo ? `<div class="av l av-sq av-photo pub-logo" style="background-image:url('${c.logo}')"></div>`
        : `<div class="av l av-sq pub-logo" style="background:rgba(255,255,255,.2)">${esc(c.initials)}</div>`}
        <button class="ico-btn pub-share" data-a="cl.share">${icon('share', 19)}</button>
      </div>
      <div class="nm">${esc(c.name)}</div>
      <div class="pub-meta">
        ${mine ? `<span class="pill">${icon('checkCircle', 13, 2.4)}${t('Ваш салон')}</span>` : ''}
        <span class="pill">${icon('pin', 13, 2.4)}${esc(c.city)}</span>
        <span class="pill">${icon('clock', 13, 2.4)}${hoursToday.on ? hoursToday.from + ' — ' + hoursToday.to : t('сегодня выходной')}</span>
      </div>
      <div class="pub-addr">${esc(c.addr)}</div>
    </div>

    <div class="wrap pub-cta">
      <button class="btn hero-cta" style="color:${col}" data-a="cl.start">
        ${icon('calendarPlus', 20)}${t('Записаться')}
      </button>
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
  if (!empId) { toast(t('Это время уже заняли'), 'dan'); rr(); return; }
  const d = new Date(s.date); d.setHours(Math.floor(s.min / 60), s.min % 60, 0, 0);
  const sh = sheet({ title: t('Подтверждение'), body: loadingBlock(t('Бронируем время…')) });
  await wait(1100);
  // карточку в этом салоне заводим ровно здесь — в момент первой записи
  const a = createAppointment({ clientId: ensureMyClient().id, employeeId: empId, serviceIds: [sv.id], start: d, source: 'client' });
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
  // «Закрыть» возвращает туда, откуда человек пришёл в приложение:
  // привязанного — в свой салон, свободного — в поиск
  if (isBound()) { viewCompany(homeId()); resetStack('cl.company'); }
  else resetStack('cl.find');
});

/* =========================================================
   Каталог — «Куда записаться»
   ---------------------------------------------------------
   Экран открывается направлениями, а не списком салонов, и это главное
   его свойство. Клиент, пришедший из приложения своего салона, не видит
   здесь ни одного чужого названия, пока сам не выберет, что ему нужно:
   имена появляются как ответ на его действие, а не как предложение
   сменить салон. Свой салон в выдаче всегда первый и помечен —
   позицию из-за каталога он не теряет (см. catalogSearch в store).
   ========================================================= */
const find = { q: '', cat: '', city: '', near: false, who: null };

/* Фильтр живёт в модуле и переживает смену человека — а чужой поиск
   новому человеку доставаться не должен. Сверяем, кто смотрит. */
function resetFindFor(who) {
  if (find.who === who) return;
  find.q = ''; find.cat = ''; find.city = ''; find.near = false; find.who = who;
}

/** Когда в салоне ближайшее свободное окно — человеческим языком. */
function freeLabel(c) {
  const nf = nextFreeInCompany(c.id);
  if (!nf) return '';
  const k = dayKey(nf.date);
  const pre = k === dayKey(now()) ? t('сегодня') + ' '
    : k === dayKey(addDays(today(), 1)) ? t('завтра') + ' '
      : nf.date.getDate() + ' ' + MON_SHORT[nf.date.getMonth()] + ' ';
  return pre + nf.slot.t;
}

/** «800 м» ближе читается, чем «0,8 км». */
function distLabel(c) {
  const d = distanceTo(c);
  if (d == null) return '';
  return d < 1 ? t('{n} м', { n: Math.round(d * 1000 / 50) * 50 })
    : t('{n} км', { n: d < 10 ? d.toFixed(1) : Math.round(d) });
}

function catalogCard(c) {
  const from = minPrice(c.id);
  const when = freeLabel(c);
  const dist = distLabel(c);
  return `<button class="card press co-row" data-a="cl.open" data-id="${c.id}">
    ${avatar({ initials: c.initials, color: c.color, photo: c.logo || c.cover }, 'm', 'av-sq')}
    <div class="grow" style="min-width:0">
      <div class="row" style="gap:6px;align-items:center">
        <div class="b nowrap">${esc(c.name)}</div>
        ${c.id === homeId() ? `<span class="own-tag">${t('Ваш салон')}</span>` : ''}
      </div>
      <div class="tiny muted nowrap">${esc(c.cat)} · ${esc(c.city)}${dist ? ' · ' + esc(dist) : ''}</div>
      <div class="tiny nowrap" style="margin-top:3px;color:var(--tx-3)">
        <span style="color:#F79009">${icon('star', 12, 2.6)}</span>${c.rating}${from ? ' · ' + t('от {n}', { n: money(from) }) : ''}
        ${when ? ` · <b style="color:var(--ok)">${esc(when)}</b>` : ' · ' + t('нет мест')}
      </div>
    </div>
    ${icon('fwd', 17)}
  </button>`;
}

route('cl.find', {
  tab: 'cl.find',
  render() {
    resetFindFor((homeId() || '-') + '|' + ((person() || {}).name || ''));
    const cats = catalogCats();
    const cities = catalogCities();
    // пока клиент ничего не искал и не выбрал направление, названий салонов
    // на экране нет вообще — только его собственные и разделы
    const digging = !!(find.q.trim() || find.cat || find.near);
    const list = digging ? catalogSearch(find) : [];
    const near = find.near && !!geo();
    const visited = myCompanies();

    return `
    <div class="top"><div class="grow"><div class="top-t">${t('Куда записаться')}</div>
      <div class="top-sub">${cats.length} ${plural(cats.length, ['направление', 'направления', 'направлений'])} · ${cities.length} ${plural(cities.length, ['город', 'города', 'городов'])}</div></div></div>

    <div class="wrap"><div class="search">${icon('search', 18)}
      <input id="_fq" placeholder="${t('Услуга, салон или город')}" value="${esc(find.q)}"></div></div>

    ${!digging && visited.length ? `<div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Вы записывались')}</div></div>
      <div class="wrap stack s">${visited.map(catalogCard).join('')}</div>
    </div>` : ''}

    ${!digging ? `<div class="sec">
      <div class="wrap" style="margin-bottom:16px">
        <button class="btn gh" data-a="cl.near">${icon('pin', 17)}${t('Показать, что рядом')}</button>
      </div>
      <div class="sec-h"><div class="sec-t">${t('Направления')}</div></div>
      <div class="wrap"><div class="grid2">
        ${cats.map(x => `<button class="cat-tile press" data-a="cl.findCat" data-v="${esc(x.cat)}">
          <div class="tint" style="background:${x.color}1f;color:${x.color}">${catIcon(x.cat, 19)}</div>
          <div class="b sm nowrap">${esc(x.t)}</div>
          <div class="tiny muted">${x.n} ${plural(x.n, ['салон', 'салона', 'салонов'])}</div>
        </button>`).join('')}
      </div></div>
    </div>` : `<div class="sec">
      <div class="chips">
        <button class="chip ${find.cat ? '' : 'on'}" data-a="cl.findCat" data-v="">${t('Все направления')}</button>
        ${cats.map(x => `<button class="chip ${find.cat === x.cat ? 'on' : ''}" data-a="cl.findCat" data-v="${esc(x.cat)}">${esc(x.t)}</button>`).join('')}
      </div>
      <div class="chips" style="margin-top:8px;margin-bottom:12px">
        <button class="chip ${near ? 'on' : ''}" data-a="cl.near">${icon('pin', 13, 2.4)}${t('Рядом')}</button>
        <button class="chip ${find.city || near ? '' : 'on'}" data-a="cl.findCity" data-v="">${t('Все города')}</button>
        ${cities.map(c => `<button class="chip ${find.city === c ? 'on' : ''}" data-a="cl.findCity" data-v="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      ${list.length
        ? `<div class="wrap stack s">${list.map(catalogCard).join('')}</div>`
        : `<div class="wrap">${emptyState({ ic: 'search', title: t('Ничего не нашли'), text: t('Попробуйте другое слово или снимите фильтр по городу.') })}</div>`}
    </div>`}

    ${bizLink()}`;
  },
  mount(p, root) {
    // выбранное направление может оказаться за правым краем ленты, и тогда
    // непонятно, по какому фильтру показан список
    root.querySelectorAll('.chips').forEach(row => {
      const on = row.querySelector('.chip.on');
      if (on && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, on.offsetLeft - 16);
    });
    // перерисовка на каждой букве теряет фокус и каретку — возвращаем их
    const i = root.querySelector('#_fq');
    if (!i) return;
    i.oninput = e => {
      find.q = e.target.value;
      const pos = e.target.selectionStart;
      rr();
      const n = document.querySelector('#_fq');
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    };
  },
});
/* Человек, открывший бота сам, ещё не сказал, кто он. Каталог — ответ для
   клиента, но сюда же попадает тот, кто пришёл заводить своё дело. Строку
   для него держим тихой и только здесь: привязанному клиенту она не нужна,
   а салону на его странице — тем более. */
function bizLink() {
  if (isBound()) return '';
  return `<div class="wrap sec">
    <button class="find-link press" data-a="cl.toBiz">${icon('briefcase', 15)}${t('У меня свой бизнес')}</button>
  </div>`;
}
on('cl.toBiz', () => go('biz.start'));
/* Геопозицию спрашиваем только по нажатию: непрошеный запрос доступа
   при открытии каталога — верный способ получить отказ навсегда. */
on('cl.near', async () => {
  if (find.near && geo()) { find.near = false; forgetGeo(); rr(); return; }
  if (geo()) { find.near = true; find.city = ''; rr(); return; }
  const sh = sheet({ title: t('Рядом'), body: loadingBlock(t('Определяем, где вы…')) });
  const g = await askGeo();
  sh.close();
  if (!g) { toast(t('Не получилось определить местоположение'), 'dan'); return; }
  find.near = true; find.city = '';
  rr();
});
on('cl.findCat', ds => { find.cat = ds.v || ''; rr(); });
on('cl.findCity', ds => { find.city = ds.v || ''; find.near = false; rr(); });
on('cl.open', ds => { viewCompany(ds.id); go('cl.company'); });
on('cl.toFind', () => { find.q = ''; find.cat = ''; find.city = ''; find.near = false; go('cl.find'); });

/* =========================================================
   Мои записи
   ========================================================= */
/* Фильтр истории: на десятке визитов список превращается в стену
   одинаковых карточек, и найти нужный визит глазами тяжело. */
const myf = { f: 'all', limit: 8 };
const HIST_FILTERS = [
  ['all', 'Все'],
  ['done', 'Выполненные'],
  ['cancelled', 'Отменённые'],
];

route('cl.my', {
  tab: 'cl.my',
  render() {
    // список сквозной по салонам: один человек может ходить и в свой салон,
    // и туда, что нашёл в каталоге, — разделять это ему незачем
    const all = myAppts();
    const up = all.filter(a => a.status === 'planned' && new Date(a.start) > now())
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    const past = all.filter(a => !(a.status === 'planned' && new Date(a.start) > now()));

    const count = {
      all: past.length,
      done: past.filter(a => a.status === 'done').length,
      cancelled: past.filter(a => a.status === 'cancelled').length,
    };
    const list = myf.f === 'all' ? past : past.filter(a => a.status === myf.f);
    const shown = list.slice(0, myf.limit);

    const salons = [...new Set(all.map(a => a.companyId))];
    const sub = salons.length > 1
      ? salons.length + ' ' + plural(salons.length, ['салон', 'салона', 'салонов'])
      : (co(salons[0]) || homeCo() || {}).name || '';
    // «плюс» ведёт туда, где человек вообще может записаться: у привязанного
    // это его салон, у пришедшего из каталога — сам каталог
    const addAct = isBound() ? 'cl.start' : 'cl.toFind';

    return `
    <div class="top"><div class="grow"><div class="top-t">${t('Мои записи')}</div><div class="top-sub">${esc(sub)}</div></div>
      <button class="ico-btn p" data-a="${addAct}">${icon('plus', 19)}</button></div>

    ${up.length ? `<div class="sec" style="margin-top:6px">
      <div class="sec-h"><div class="sec-t">${t('Предстоящие')}</div>
        ${up.length > 1 ? `<span class="tiny dim">${up.length}</span>` : ''}</div>
      <div class="wrap stack">${up.map((a, i) => upcomingCard(a, i === 0)).join('')}</div>
    </div>` : `<div class="wrap">${emptyState({ ic: 'calendar', title: t('Пока нет записей'), text: t('Выберите услугу и удобное время — это займёт полминуты.'), action: t('Записаться'), act: addAct })}</div>`}

    ${past.length ? `<div class="sec">
      <div class="sec-h"><div class="sec-t">${t('История')}</div><span class="tiny dim">${count.all}</span></div>
      ${count.done && count.cancelled ? `<div class="chips" style="margin-bottom:12px">
        ${HIST_FILTERS.filter(f => count[f[0]]).map(f => `<button class="chip ${myf.f === f[0] ? 'on' : ''}" data-a="my.f" data-v="${f[0]}">${t(f[1])} · ${count[f[0]]}</button>`).join('')}
      </div>` : ''}
      <div class="wrap stack s">${shown.map(a => historyCard(a)).join('')}</div>
      ${list.length > shown.length ? `<div class="wrap" style="margin-top:10px">
        <button class="btn gh sm" data-a="my.more">${t('Показать ещё {n}', { n: Math.min(8, list.length - shown.length) })}</button></div>` : ''}
    </div>` : ''}

    ${findLink()}`;
  },
});

/* Тихий вход в каталог. Показываем его только привязанному клиенту:
   у свободного каталог и так первая вкладка. Это текстовая строка в самом
   низу экрана, без карточки и без чужих названий — салон, приведший
   клиента, не должен встречать рядом со своими записями витрину соседей.
   Салон на PRO может убрать её совсем (catalogVisible). */
function findLink() {
  if (!isBound() || !catalogVisible()) return '';
  return `<div class="wrap sec">
    <button class="find-link press" data-a="cl.toFind">${icon('search', 15)}${t('Записаться в другом месте')}</button>
  </div>`;
}
on('my.f', ds => { myf.f = ds.v; myf.limit = 8; rr(); });
on('my.more', () => { myf.limit += 8; rr(); });

/** Сколько осталось до визита — человеческим языком. */
function timeLeft(d) {
  const n = now();
  const days = Math.round((startOfDay(d) - startOfDay(n)) / 86400000);
  if (days > 1) return 'через ' + days + ' ' + plural(days, ['день', 'дня', 'дней']);
  if (days === 1) return 'завтра';
  const min = Math.round((d - n) / 60000);
  if (min > 90) return 'через ' + Math.round(min / 60) + ' ' + plural(Math.round(min / 60), ['час', 'часа', 'часов']);
  if (min > 0) return 'через ' + min + ' мин';
  return 'скоро';
}

/* Салон записи. Для своего салона не пишем ничего — это и так его
   приложение; подпись появляется только у записей, сделанных в другом
   месте, иначе список из двух салонов не прочитать. */
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
    title: 'Ваша запись',
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
  const a = appt(ds.id);
  if (!a || a.status !== 'planned') { toast('Эту запись уже нельзя отменить', 'dan'); return; }
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
  if (!cancelAppointment(ds.id, 'client')) { toast('Эту запись уже нельзя отменить', 'dan'); return; }
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  toast(t('Запись отменена'), 'dan');
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
on('cl.move', ds => {
  const a = appt(ds.id); if (!a) return;
  if (window.__ma) { window.__ma.close(); window.__ma = null; }
  let date = startOfDay(new Date(a.start)); if (date < today()) date = today();
  let pick = null;
  const s = sheet({ title: 'Перенести', body: '' });
  const draw = () => {
    const slots = slotsFor([a.employeeId], date, a.duration, { ignoreId: a.id, companyId: a.companyId });
    s.set({
      title: t('Выберите новое время'),
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
    s.close(); toast(t('Запись перенесена'));
  });
  draw();
});

/* =========================================================
   Профиль клиента
   ========================================================= */
route('cl.profile', {
  tab: 'cl.profile',
  render() {
    // личность общая для всех салонов, статистика — по всем визитам сразу
    const me = person() || my() || { name: 'Гость', initials: 'Г' };
    const st = myStats();
    return `
    <div class="top"><div class="grow"><div class="top-t">${t('Профиль')}</div></div></div>
    <div class="center wrap">
      ${avatar(me, 'xl')}
      <div style="font-size:21px;font-weight:780;letter-spacing:-.03em;margin-top:12px">${esc(me.name)}</div>
      <div class="sm muted">${esc(me.phone || '')}</div>
    </div>
    <div class="wrap sec"><div class="grid3">
      <div class="st-card center"><div class="v">${st.visits}</div><div class="l">${t('визитов')}</div></div>
      <div class="st-card center"><div class="v">${st.last ? relPast(new Date(st.last.start), now()).replace(' назад', '') : '—'}</div><div class="l">${t('последний визит')}</div></div>
      <div class="st-card center"><div class="v">${st.next ? 1 : 0}</div><div class="l">${t('впереди')}</div></div>
    </div></div>
    <div class="wrap sec"><div class="stack s">
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.editMe">
        <div class="ic">${icon('user', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Мои данные')}</div><div class="st">${t('Имя и телефон')}</div></div>${icon('fwd', 17)}</button>
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="tab" data-r="cl.my">
        <div class="ic">${icon('history', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('История визитов')}</div><div class="st">${st.visits} ${plural(st.visits, ['запись', 'записи', 'записей'])}</div></div>${icon('fwd', 17)}</button>
      ${isBound() && catalogVisible() ? `
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="cl.toFind">
        <div class="ic">${icon('search', 18)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${t('Куда записаться')}</div><div class="st">${t('Другие услуги и города')}</div></div>${icon('fwd', 17)}</button>` : ''}
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

    <div class="wrap sec">
      <div class="card pad row" style="gap:10px;background:var(--p-soft);border-color:transparent">
        <span style="color:var(--p)">${icon('bell', 19)}</span>
        <div class="sm" style="color:var(--tx-2)">${t('Напомним о визите за 24 часа и за 2 часа — сообщением в этот чат')}</div>
      </div>
    </div>`;
  },
});
/* Строка называется «Имя и телефон», значит меняться должно и то и другое.
   Телефон здесь не украшение: по нему салон звонит, если что-то сдвинулось. */
on('cl.lang', ds => { setLang(ds.v); });
on('cl.editMe', () => {
  const me = person() || my() || {};
  const s = sheet({
    title: t('Мои данные'),
    body: `<div class="field"><label>${t('Как к вам обращаться?')}</label>
        <input class="inp" id="_mn" value="${esc(me.name || '')}" placeholder="${t('Имя')}"></div>
      <div class="field"><label>${t('Телефон')}</label>
        <input class="inp" id="_mp" type="tel" inputmode="tel" value="${esc(me.phone || '')}" placeholder="+7 700 000 00 00"></div>
      <div class="tiny dim">${t('Телефон видит только салон, в который вы записались — по нему с вами свяжутся, если время сдвинется.')}</div>`,
    footer: `<button class="btn p" data-a="cl.saveMe">${t('Сохранить')}</button>`,
    onClose: () => { window.__me = null; },
  });
  window.__me = s;
  setTimeout(() => { const i = s.el.querySelector('#_mn'); if (i) i.focus(); }, 240);
});
on('cl.saveMe', () => {
  const s = window.__me; if (!s) return;
  const name = (s.el.querySelector('#_mn').value || '').trim();
  const phone = (s.el.querySelector('#_mp').value || '').trim();
  if (!name) { toast(t('Введите имя'), 'dan'); return; }
  // меняем во всех салонах сразу: это один человек, а не однофамильцы
  updatePerson({ name, phone });
  window.__me = null; s.close();
  toast(t('Сохранено'));
});
