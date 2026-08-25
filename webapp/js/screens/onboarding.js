import { S, emit, now, today, createService, createEmployee, setHome, ADDR_TODO, PHONE_TODO } from '../store.js';
import { esc, money, sheet, toast, wait, nMin, WD_FULL, loadingBlock, plural, t } from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render, resetStack } from '../router.js';
import { on } from '../bus.js';
import { haptic } from '../tg.js';
import { BOT_USERNAME } from '../config.js';

// Перед любой перерисовкой снимаем значения полей в состояние.
// Иначе введённое имя пропадает при нажатии на категорию, длительность и т.п.
function capture() {
  const v = id => { const e = document.querySelector(id); return e ? e.value : null; };
  const n = v('#_n'); if (n !== null) ob.name = n;
  const sn = v('#_sn'); if (sn !== null) ob.svc.name = sn;
  const sp = v('#_sp'); if (sp !== null) ob.svc.price = sp;
  const en = v('#_en'); if (en !== null) ob.emp = en;
}
// и возвращаем курсор в то же поле, где он был
function rr() {
  capture();
  const a = document.activeElement;
  const id = a && a.id ? '#' + a.id : null;
  const pos = a && a.selectionStart != null ? a.selectionStart : null;
  render(false);
  if (id) {
    const e = document.querySelector(id);
    if (e) { e.focus(); if (pos != null && e.setSelectionRange) { try { e.setSelectionRange(pos, pos); } catch (x) { } } }
  }
}
const CATS = [
  ['Салон красоты', 'nails', '#4C6FFF'], ['Барбершоп', 'bar', '#0EA5E9'], ['Спа и массаж', 'spa', '#12B76A'],
  ['Ногтевая студия', 'nails', '#EC4899'], ['Парикмахерская', 'hair', '#F79009'], ['Другое', 'nails', '#8B5CF6'],
];

const ob = {
  step: 0, name: '', cat: 0, plan: 'PRO',
  days: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 0: false },
  from: '09:00', to: '20:00',
  svc: { name: '', price: '', dur: 60 },
  emp: '', companyId: null,
};

route('onb', {
  noTab: true,
  render() {
    return `<div class="ob ${ob.step === 0 ? 'ob-hello' : ''}">
      ${ob.step >= 1 && ob.step <= 4 ? `<div class="ob-dots">${[1, 2, 3, 4].map(i => `<i class="${i <= ob.step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      ${[s0, s1, s2, s3, s4, s5][ob.step]()}
    </div>`;
  },
  mount() {
    // фокус ставим только при первом входе на шаг: иначе он будет
    // перебивать курсор при каждой перерисовке формы
    if (ob._focused === ob.step) return;
    ob._focused = ob.step;
    const i = document.querySelector('.ob input');
    if (i && ob.step >= 1 && ob.step <= 4) setTimeout(() => i.focus(), 300);
  },
});

/* §19, §20 — приветствие: картинка, крупный заголовок, одна кнопка.
   Раньше человек попадал сразу в форму, и текст терялся на фоне. */
function s0() {
  return `
  <div class="ob-art">${welcomeArt()}</div>
  <h1 class="ob-big">Онлайн-запись,<br>которая живёт в Telegram</h1>
  <p class="sub ob-lead">Клиенты записываются сами — за полминуты и без звонков.
  Вы видите день целиком: кто, когда и на сколько.</p>
  <div class="grow"></div>
  <button class="btn p" data-a="ob.begin" style="height:56px;font-size:16px">Создать свой бизнес</button>
  <button class="btn" style="background:transparent;margin-top:8px;color:var(--tx-2)" data-a="ob.skip">Сначала посмотреть демо</button>`;
}

/** Иллюстрация приветствия. Рисуем сами: внешних картинок в проекте нет. */
function welcomeArt() {
  return `<svg viewBox="0 0 260 190" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <circle cx="130" cy="92" r="86" fill="var(--p)" opacity=".08"/>
    <circle cx="130" cy="92" r="60" fill="var(--p)" opacity=".07"/>
    <rect x="66" y="26" width="128" height="138" rx="20" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    <rect x="82" y="44" width="52" height="8" rx="4" fill="var(--tx-3)" opacity=".55"/>
    <rect x="82" y="62" width="96" height="26" rx="9" fill="var(--p)" opacity=".14"/>
    <rect x="90" y="71" width="34" height="8" rx="4" fill="var(--p)"/>
    <rect x="134" y="71" width="20" height="8" rx="4" fill="var(--p)" opacity=".5"/>
    <rect x="82" y="96" width="96" height="26" rx="9" fill="var(--ok)" opacity=".14"/>
    <rect x="90" y="105" width="42" height="8" rx="4" fill="var(--ok)"/>
    <rect x="82" y="130" width="96" height="26" rx="9" fill="var(--sf-3)"/>
    <rect x="90" y="139" width="28" height="8" rx="4" fill="var(--tx-3)" opacity=".7"/>
    <g>
      <circle cx="196" cy="52" r="26" fill="var(--p)"/>
      <path d="M185 52.5l7.5 7.5L208 45" stroke="#fff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <circle cx="58" cy="122" r="15" fill="var(--ai)" opacity=".9"/>
    <path d="M52.5 122h11M58 116.5v11" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

/* Короткое «зачем это» на каждом шаге. Форма без объяснений заставляет
   гадать, на что влияет поле, — а половина полей здесь влияет на то,
   что потом увидит клиент. */
function hint(text) {
  return `<div class="card pad row" style="gap:11px;background:var(--p-soft);border-color:transparent;margin-top:2px">
    <span style="color:var(--p);flex:none">${icon('info', 18)}</span>
    <div class="sm" style="color:var(--tx-2);line-height:1.45">${text}</div>
  </div>`;
}

function s1() {
  return `
  <h1>${t('Создадим ваш бизнес')}</h1>
  <p class="sub">${t('Пара шагов — и страница записи готова')}</p>
  <div class="field"><label>${t('Название')}</label><input class="inp" id="_n" value="${esc(ob.name)}" placeholder="Например, Beauty Studio"></div>
  <div class="field"><label>${t('Чем занимаетесь?')}</label>
    <div class="pick">${CATS.map((c, i) => `<button class="o ${ob.cat === i ? 'on' : ''}" data-a="ob.cat" data-i="${i}">${c[0]}</button>`).join('')}</div>
  </div>
  ${hint('Название и направление клиент увидит первым делом на странице записи. Поменять их можно в любой момент в настройках.')}
  <div class="grow"></div>
  <button class="btn p" data-a="ob.s2" style="margin-top:20px">${t('Продолжить')}</button>
  <button class="btn" style="background:transparent;margin-top:6px" data-a="ob.back">${t('Назад')}</button>`;
}

function s2() {
  return `
  <h1>${t('Когда вы работаете?')}</h1>
  <p class="sub">${t('Клиенты увидят только свободное время')}</p>
  <div class="stack s">
    ${[1, 2, 3, 4, 5, 6, 0].map(d => `<div class="lrow" style="border-radius:14px;border:1px solid var(--bd)">
      <div class="grow"><div class="tl" style="text-transform:capitalize">${WD_FULL[d]}</div>
        <div class="st">${ob.days[d] ? ob.from + ' — ' + ob.to : 'Выходной'}</div></div>
      <button class="sw ${ob.days[d] ? 'on' : ''}" data-a="ob.day" data-d="${d}"></button></div>`).join('')}
  </div>
  <div class="row" style="gap:10px;margin-top:14px">
    <button class="btn sm gh" style="flex:1" data-a="ob.time" data-k="from">${icon('clock', 15)}с ${ob.from}</button>
    <button class="btn sm gh" style="flex:1" data-a="ob.time" data-k="to">до ${ob.to}</button>
  </div>
  ${hint('Это часы салона. У каждого мастера будет свой график внутри них — на время, когда салон закрыт, клиент записаться не сможет.')}
  <div class="grow"></div>
  <button class="btn p" data-a="ob.s3" style="margin-top:20px">${t('Продолжить')}</button>
  <button class="btn" style="background:transparent;margin-top:4px" data-a="ob.back">${t('Назад')}</button>`;
}

function s3() {
  return `
  <h1>${t('Добавьте первую услугу')}</h1>
  <p class="sub">${t('Позже добавите остальные — это займёт минуту')}</p>
  <div class="field"><label>${t('Название')}</label><input class="inp" id="_sn" value="${esc(ob.svc.name)}" placeholder="Например, Маникюр"></div>
  <div class="inp-row">
    <div class="field"><label>${t('Цена, ₸')}</label><input class="inp" id="_sp" inputmode="numeric" value="${esc(ob.svc.price)}" placeholder="8000"></div>
    <div class="field"><label>${t('Время')}</label>
      <div class="pick" style="margin-top:2px">${[30, 60, 90, 120].map(m => `<button class="o ${ob.svc.dur === m ? 'on' : ''}" data-a="ob.dur" data-m="${m}">${m}м</button>`).join('')}</div>
    </div>
  </div>
  ${hint('Время услуги — это то, на сколько занят мастер. Из него считается, какие слоты клиент увидит свободными.')}
  <div class="grow"></div>
  <button class="btn p" data-a="ob.s4" style="margin-top:20px">${t('Продолжить')}</button>
  <button class="btn" style="background:transparent;margin-top:4px" data-a="ob.back">${t('Назад')}</button>`;
}

function s4() {
  return `
  <h1>${t('Добавьте сотрудника')}</h1>
  <p class="sub">${t('Если работаете один — этот шаг можно пропустить')}</p>
  <div class="field"><label>${t('Имя сотрудника')}</label><input class="inp" id="_en" value="${esc(ob.emp)}" placeholder="Например, Айгерим"></div>
  <div class="card pad row" style="gap:12px;background:var(--p-soft);border-color:transparent">
    <span style="color:var(--p)">${icon('info', 19)}</span>
    <div class="sm" style="color:var(--tx-2)">Каждый сотрудник получит свой график и свою страницу записи.</div>
  </div>
  <div class="grow"></div>
  <button class="btn p" data-a="ob.finish" style="margin-top:20px">${t('Добавить и завершить')}</button>
  <button class="btn gh" style="margin-top:8px" data-a="ob.finishLater">${t('Позже')}</button>`;
}

function s5() {
  const c = S.data.companies.find(x => x.id === ob.companyId) || {};
  return `
  <div class="succ" style="padding-top:70px">
    <div class="check">${icon('check', 46, 3)}</div>
    <div class="t">${t('Всё готово')}</div>
    <div class="s">${t('Ваша страница записи создана')}</div>
  </div>
  <div class="card pad center" style="margin-top:10px">
    <div class="b" style="font-size:16px">${esc(c.name || ob.name)}</div>
    <div class="sm muted" style="margin-top:2px">t.me/${esc(BOT_USERNAME)}?start=${esc(ob.companyId || '')}</div>
    <div class="hr"></div>
    <div class="sm" style="color:var(--tx-2)">${t('Тариф {p} · бесплатно 14 дней', { p: esc(c.plan || ob.plan) })}</div>
  </div>
  <div class="grow"></div>
  <button class="btn p" data-a="ob.openPage" style="margin-top:22px">${t('Открыть страницу записи')}</button>
  <button class="btn gh" style="margin-top:8px" data-a="ob.openAdmin">${t('Перейти в управление')}</button>`;
}

/* ---------- действия ---------- */
on('ob.cat', ds => { ob.cat = +ds.i; rr(); });
on('ob.day', ds => { ob.days[ds.d] = !ob.days[ds.d]; haptic('select'); rr(); });
on('ob.time', async ds => {
  const { timePick } = await import('./more.js');
  timePick(ob[ds.k], v => { ob[ds.k] = v; rr(); });
});
on('ob.dur', ds => { ob.svc.dur = +ds.m; rr(); });
on('ob.begin', () => { ob.step = 1; rr(); });

/** Старт с витрины: тариф уже выбран, приветствие человек только что видел. */
export function startOnboarding(plan) {
  ob.plan = plan || 'PRO';
  ob.step = 1;
  go('onb');
}
on('ob.back', () => { ob.step--; rr(); });
on('ob.skip', () => { S.onboarded = true; emit(); resetStack('o.home'); });

on('ob.s2', () => {
  capture();
  ob.name = (ob.name || '').trim();
  if (!ob.name) { toast(t('Введите название'), 'dan'); return; }
  ob.step = 2; rr();
});
on('ob.s3', () => { ob.step = 3; rr(); });
on('ob.s4', () => {
  capture();
  ob.svc.name = (ob.svc.name || '').trim();
  if (!ob.svc.name) { toast(t('Введите название услуги'), 'dan'); return; }
  ob.step = 4; rr();
});
on('ob.finish', () => { capture(); ob.emp = (ob.emp || '').trim(); build(); });
on('ob.finishLater', () => { ob.emp = ''; build(); });

async function build() {
  const s = sheet({ title: t('Создаём'), body: loadingBlock(t('Настраиваем ваш бизнес…')) });
  await wait(1400);

  const cat = CATS[ob.cat];
  const id = 'co_' + Date.now().toString(36);
  const hours = {};
  [0, 1, 2, 3, 4, 5, 6].forEach(d => { hours[d] = { on: !!ob.days[d], from: ob.from, to: ob.to, breaks: [] }; });
  const initials = ob.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  S.data.companies.push({
    id, name: ob.name, short: ob.name.split(' ')[0], cat: cat[0], color: cat[2], city: 'Алматы',
    addr: ADDR_TODO, phone: PHONE_TODO, rating: 5.0, reviewsCount: 0,
    about: '', plan: ob.plan || 'PRO', planUntil: new Date(now().getTime() + 14 * 86400000).toISOString(),
    slug: id, tgLink: BOT_USERNAME, initials, createdAt: now().toISOString(), hours, currency: '₸',
    logo: null, cover: null, finCats: { income: {}, expense: {} }, setup: { hours: true },
  });
  const ownerId = id + '_owner';
  S.data.employees.push({
    id: ownerId, companyId: id, name: 'Вы', role: 'Владелец', isOwner: true, active: true,
    initials: 'В', color: '#4C6FFF', phone: '', schedule: JSON.parse(JSON.stringify(hours)),
    serviceIds: [], takesAppointments: true, access: 'owner', rating: '5.0',
    photo: null, since: null, showExp: true,
  });
  // сессию дополняем, а не подменяем: homeId, person и clientIds принадлежат
  // человеку, а не роли, и от заведения бизнеса пропадать не должны
  Object.assign(S.session, { role: 'owner', companyId: id, employeeId: ownerId, clientId: null });
  ob.companyId = id;

  createService({ name: ob.svc.name, price: +ob.svc.price || 0, duration: ob.svc.dur, employeeIds: [ownerId], companyId: id, cat: cat[1] });
  if (ob.emp) createEmployee({ name: ob.emp, role: 'Мастер', companyId: id });

  S.onboarded = true;
  emit();
  s.close();
  haptic('success');
  ob.step = 5; rr();
}

on('ob.openPage', () => {
  S.session.role = 'client';
  const c = S.data.clients.find(x => x.companyId === ob.companyId);
  if (!c) {
    S.data.clients.push({
      id: 'cl_' + Date.now().toString(36), companyId: ob.companyId, name: 'Вы (клиент)', phone: '',
      tg: '', initials: 'ВК', color: '#EC4899', createdAt: now().toISOString(), note: '', ai: null, tags: [],
    });
  }
  // владелец смотрит свою страницу глазами клиента, пришедшего по его ссылке:
  // привязка нужна, иначе первой вкладкой откроется каталог чужих салонов
  setHome(ob.companyId);
  emit(); resetStack('cl.company');
});
on('ob.openAdmin', () => { emit(); resetStack('o.home'); });
on('ob.restart', () => { ob.step = 1; ob.name = ''; ob.svc = { name: '', price: '', dur: 60 }; ob.emp = ''; resetStack('onb'); });
