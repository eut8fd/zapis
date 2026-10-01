import { S, emit, now, today, createService, setHome, ADDR_TODO, PHONE_TODO, catalogMissing, co } from '../store.js';
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
/* Направлений шесть штук было мало: запись нужна не только салонам —
   автосервису, репетитору, ветклинике, фотостудии. Список открывается
   отдельной шторкой и сгруппирован, иначе тридцать чипсов превращаются
   в стену. Второе поле — категория услуг: от неё зависит только иконка
   и цвет, поэтому всё, что не про красоту, честно идёт в «другое». */
const DIRS = [
  ['Красота и уход', [
    ['Салон красоты', 'nails', '#4C6FFF'], ['Парикмахерская', 'hair', '#F79009'],
    ['Барбершоп', 'bar', '#0EA5E9'], ['Ногтевая студия', 'nails', '#EC4899'],
    ['Брови и ресницы', 'brow', '#8B5CF6'], ['Визаж и макияж', 'brow', '#F04462'],
    ['Эпиляция', 'spa', '#06AED4'], ['Косметология', 'spa', '#12B76A'],
    ['Тату и пирсинг', 'other', '#7C3AED'],
  ]],
  ['Здоровье и тело', [
    ['Массаж', 'spa', '#12B76A'], ['Спа-салон', 'spa', '#06AED4'],
    ['Фитнес и тренировки', 'other', '#F5A524'], ['Йога и растяжка', 'other', '#8B5CF6'],
    ['Стоматология', 'other', '#0EA5E9'], ['Медицинский центр', 'other', '#4C6FFF'],
    ['Психолог', 'other', '#EC4899'], ['Диетолог', 'other', '#10B981'],
  ]],
  ['Услуги', [
    ['Автосервис', 'other', '#7C8AA5'], ['Автомойка', 'other', '#0EA5E9'],
    ['Ремонт техники', 'other', '#F79009'], ['Клининг', 'other', '#12B76A'],
    ['Ателье и пошив', 'other', '#EC4899'], ['Фотостудия', 'other', '#8B5CF6'],
    ['Груминг', 'other', '#F5A524'], ['Ветклиника', 'other', '#06AED4'],
  ]],
  ['Обучение', [
    ['Репетитор', 'other', '#4C6FFF'], ['Языковая школа', 'other', '#0EA5E9'],
    ['Музыкальная школа', 'other', '#8B5CF6'], ['Автошкола', 'other', '#F79009'],
    ['Детский центр', 'other', '#EC4899'],
  ]],
  ['Другое', [
    ['Другое', 'other', '#7C8AA5'],
  ]],
];
const DIR_POPULAR = ['Салон красоты', 'Барбершоп', 'Массаж', 'Автосервис', 'Репетитор'];
const dirByName = n => DIRS.reduce((a, g) => a.concat(g[1]), []).find(d => d[0] === n) || null;

const HOURS0 = () => {
  const h = {};
  [0, 1, 2, 3, 4, 5, 6].forEach(d => { h[d] = { on: d !== 0, from: '09:00', to: '20:00' }; });
  return h;
};

const ob = {
  step: 0, name: '', dir: null, plan: 'PRO',
  hours: HOURS0(),
  svc: { name: '', price: '', dur: 60 },
  companyId: null,
};

route('onb', {
  noTab: true,
  render() {
    return `<div class="ob ${ob.step === 0 ? 'ob-hello' : ''}">
      ${ob.step >= 1 && ob.step <= 3 ? `<div class="ob-dots">${[1, 2, 3].map(i => `<i class="${i <= ob.step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      ${[s0, s1, s2, s3, s5][ob.step]()}
    </div>`;
  },
  mount() {
    // фокус ставим только при первом входе на шаг: иначе он будет
    // перебивать курсор при каждой перерисовке формы
    if (ob._focused === ob.step) return;
    ob._focused = ob.step;
    const i = document.querySelector('.ob input');
    if (i && ob.step >= 1 && ob.step <= 3) setTimeout(() => i.focus(), 300);
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
  const d = ob.dir;
  return `
  <h1>${t('Создадим ваш бизнес')}</h1>
  <p class="sub">${t('Три шага — и страница записи готова')}</p>
  <div class="field"><label>${t('Название')}</label><input class="inp" id="_n" value="${esc(ob.name)}" placeholder="Например, Beauty Studio"></div>
  <div class="field"><label>${t('Чем занимаетесь?')}</label>
    <button class="ob-pickrow press" data-a="ob.dirs">
      <span class="dot" style="background:${d ? d[2] : 'var(--bd-2)'}"></span>
      <span class="grow">${d ? esc(d[0]) : t('Выберите направление')}</span>
      ${icon('down', 17)}
    </button>
    <div class="pick" style="margin-top:8px">
      ${DIR_POPULAR.map(nm => `<button class="o ${d && d[0] === nm ? 'on' : ''}" data-a="ob.dir" data-v="${esc(nm)}">${nm}</button>`).join('')}
    </div>
  </div>
  ${hint('Название и направление клиент увидит первым делом на странице записи. Поменять их можно в любой момент в настройках.')}
  <div class="grow"></div>
  <button class="btn p" data-a="ob.s2" style="margin-top:20px">${t('Продолжить')}</button>
  <button class="btn" style="background:transparent;margin-top:6px" data-a="ob.back">${t('Назад')}</button>`;
}

/* У каждого дня своё время: во вторник можно открыться в 13:00,
   и это нормальный график, а не исключение. Раньше одно время
   растягивалось на всю неделю, и поправить его можно было только
   потом, в настройках. */
function s2() {
  return `
  <h1>${t('Когда вы работаете?')}</h1>
  <p class="sub">${t('Клиенты увидят только свободное время')}</p>
  <div class="stack s">
    ${[1, 2, 3, 4, 5, 6, 0].map(d => {
      const w = ob.hours[d];
      return `<div class="ob-day ${w.on ? '' : 'off'}">
        <div class="row between">
          <div class="nm">${WD_FULL[d]}</div>
          <button class="sw ${w.on ? 'on' : ''}" data-a="ob.day" data-d="${d}"></button>
        </div>
        ${w.on ? `<div class="row" style="gap:8px;margin-top:8px">
          <button class="ob-t press" data-a="ob.dayTime" data-d="${d}" data-k="from">${w.from}</button>
          <span class="dim">—</span>
          <button class="ob-t press" data-a="ob.dayTime" data-d="${d}" data-k="to">${w.to}</button>
        </div>` : `<div class="tiny dim" style="margin-top:6px">Выходной</div>`}
      </div>`;
    }).join('')}
  </div>
  <button class="btn gh sm" style="margin-top:12px" data-a="ob.sameAll">${icon('copy', 15)}${t('Как в понедельник — во все дни')}</button>
  ${hint('Это часы салона. У каждого мастера будет свой график внутри них — когда салон закрыт, записаться нельзя.')}
  <div class="grow"></div>
  <button class="btn p" data-a="ob.s3" style="margin-top:20px">${t('Продолжить')}</button>
  <button class="btn" style="background:transparent;margin-top:4px" data-a="ob.back">${t('Назад')}</button>`;
}

function s3() {
  return `
  <h1>${t('Добавьте первую услугу')}</h1>
  <p class="sub">${t('Позже добавите остальные — это займёт минуту')}</p>
  <div class="field"><label>${t('Название')}</label><input class="inp" id="_sn" value="${esc(ob.svc.name)}" placeholder="Например, Маникюр"></div>
  <div class="field"><label>${t('Цена, ₸')}</label><input class="inp" id="_sp" inputmode="numeric" value="${esc(ob.svc.price)}" placeholder="8000"></div>
  ${/* Длительность одна и в одном месте. Раньше рядом жили поле ввода
       и кнопки: вписал 73 минуты — а подсвечено 45, и какое значение
       в силе, понять было нельзя. */''}
  <div class="field"><label>${t('Сколько занимает')}</label>
    <button class="ob-pickrow press" data-a="ob.durPick">
      <span style="color:var(--p);flex:none">${icon('clock', 17)}</span>
      <span class="grow">${nMin(ob.svc.dur)}</span>
      ${icon('down', 17)}
    </button>
    <div class="pick" style="margin-top:8px">
      ${[30, 45, 60, 90, 120].map(m => `<button class="o ${ob.svc.dur === m ? 'on' : ''}" data-a="ob.dur" data-m="${m}">${nMin(m)}</button>`).join('')}
    </div>
  </div>
  ${hint('Из длительности считается, какие окна клиент увидит свободными.')}
  <div class="grow"></div>
  <button class="btn p" data-a="ob.finish" style="margin-top:20px">${t('Создать бизнес')}</button>
  <button class="btn gh" style="margin-top:8px" data-a="ob.skipSvc">${t('Добавлю услуги позже')}</button>
  <button class="btn" style="background:transparent;margin-top:4px" data-a="ob.back">${t('Назад')}</button>`;
}

/* Что мешает компании принимать записи. Пропущенные шаги — не ошибка,
   но человек должен уходить с этого экрана, зная, что осталось сделать
   и что до этого клиент его не найдёт. */
const TODO_STEPS = {
  'услуги': ['Добавить услугу', 'Без услуг записываться не на что', 'o.services'],
  'мастера': ['Добавить мастера', 'Кто-то должен принимать клиентов', 'o.team'],
  'адрес': ['Указать адрес', 'Клиент увидит его на странице записи', 'o.settings'],
  'телефон': ['Указать телефон', 'По нему с вами свяжутся', 'o.settings'],
};

function s5() {
  const c = co(ob.companyId) || S.data.companies.find(x => x.id === ob.companyId) || {};
  const missing = catalogMissing(c);
  const ready = !missing.length;

  return `
  <div class="succ" style="padding-top:56px">
    <div class="check">${icon('check', 46, 3)}</div>
    <div class="t">${t('Бизнес создан')}</div>
    <div class="s">${ready
      ? t('Страница записи готова — можно давать ссылку клиентам')
      : t('Осталось несколько шагов, прежде чем клиент сможет записаться')}</div>
  </div>

  <div class="card pad" style="margin-top:10px">
    <div class="b" style="font-size:16px">${esc(c.name || ob.name)}</div>
    <div class="sm muted" style="margin-top:2px">t.me/${esc(BOT_USERNAME)}?start=${esc(ob.companyId || '')}</div>
    <div class="hr"></div>
    <div class="sm" style="color:var(--tx-2)">${t('Тариф {p} · бесплатно 14 дней', { p: esc(c.plan || ob.plan) })}</div>
  </div>

  ${ready ? `<div class="card pad row" style="gap:11px;margin-top:10px;background:var(--ok-soft);border-color:transparent">
    <span style="color:var(--ok);flex:none">${icon('checkCircle', 19)}</span>
    <div class="sm" style="color:var(--tx-2)">Компания видна в каталоге, клиенты могут записываться.</div>
  </div>` : `
  <div class="sec" style="margin-top:14px">
    <div class="sec-h"><div class="sec-t">${t('Что осталось')}</div>
      <span class="tiny dim">${missing.length}</span></div>
    <div class="stack s">
      ${missing.map(key => {
        const step = TODO_STEPS[key] || [key, '', 'o.more'];
        return `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="ob.todo" data-r="${step[2]}">
          <div class="ic" style="background:var(--warn-soft);color:var(--warn)">${icon('info', 18)}</div>
          <div class="grow" style="text-align:left">
            <div class="tl">${esc(step[0])}</div>
            <div class="st">${esc(step[1])}</div>
          </div>
          <span class="chev">${icon('fwd', 18, 2)}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="tiny dim" style="margin-top:10px;padding:0 4px">
      Пока этого нет, компания не появится в каталоге и по ссылке клиент
      увидит незаполненную страницу. Всё это делается в управлении за пару минут.
    </div>
  </div>`}

  <div class="wrap-none card pad row" style="gap:11px;margin-top:10px">
    <span style="color:var(--p);flex:none">${icon('userPlus', 19)}</span>
    <div class="sm" style="color:var(--tx-2)">Сотрудников добавляют ссылкой-приглашением: раздел «Команда» → «Пригласить по ссылке». Человек откроет её, заполнит имя и телефон сам и сразу получит свой кабинет.</div>
  </div>

  <div class="grow"></div>
  <button class="btn p" data-a="ob.openAdmin" style="margin-top:18px">${
    ready ? t('Перейти в управление') : t('Доделать сейчас')}</button>
  <button class="btn gh" style="margin-top:8px" data-a="ob.openPage">${t('Посмотреть глазами клиента')}</button>`;
}

/* ---------- действия ---------- */
/* Полный список направлений. Открываем шторкой: тридцать вариантов
   чипсами превращаются в стену, а группы читаются за секунду. */
on('ob.dirs', () => {
  capture();
  const s2 = sheet({
    title: t('Чем занимаетесь?'),
    body: DIRS.map(([group, items]) => `
      <div class="tiny muted b" style="margin:14px 2px 7px;text-transform:uppercase;letter-spacing:.05em">${esc(group)}</div>
      <div class="stack s">
        ${items.map(d => `<button class="lrow press" style="border-radius:14px;border:1.5px solid ${ob.dir && ob.dir[0] === d[0] ? 'var(--p)' : 'var(--bd)'};width:100%;${ob.dir && ob.dir[0] === d[0] ? 'background:var(--p-soft)' : ''}" data-a="ob.dirPick" data-v="${esc(d[0])}">
          <span class="ob-dot" style="background:${d[2]}"></span>
          <div class="grow" style="text-align:left"><div class="tl">${esc(d[0])}</div></div>
          ${ob.dir && ob.dir[0] === d[0] ? `<span style="color:var(--p)">${icon('checkCircle', 19)}</span>` : ''}
        </button>`).join('')}
      </div>`).join(''),
  });
  window.__obd = s2;
});
on('ob.dirPick', ds => {
  ob.dir = dirByName(ds.v);
  if (window.__obd) { window.__obd.close(); window.__obd = null; }
  rr();
});
on('ob.dir', ds => { capture(); ob.dir = dirByName(ds.v); rr(); });

on('ob.day', ds => { ob.hours[ds.d].on = !ob.hours[ds.d].on; haptic('select'); rr(); });
on('ob.dayTime', async ds => {
  const { timeSheet } = await import('../flows.js');
  const { toMin, toHM } = await import('../store.js');
  const w = ob.hours[ds.d];
  timeSheet({
    title: ds.k === 'from' ? 'Открытие · ' + WD_FULL[ds.d] : 'Закрытие · ' + WD_FULL[ds.d],
    value: toMin(w[ds.k]),
    onOk: v => {
      w[ds.k] = toHM(v);
      // конец не может быть раньше начала — иначе день «закрыт до открытия»
      if (toMin(w.to) <= toMin(w.from)) w.to = toHM(Math.min(23 * 60 + 30, toMin(w.from) + 60));
      rr();
    },
  });
});
on('ob.sameAll', () => {
  const src = ob.hours[1];
  [2, 3, 4, 5, 6, 0].forEach(d => { ob.hours[d] = { ...src }; });
  rr();
  toast(t('Время понедельника применено ко всем дням'));
});
on('ob.dur', ds => { capture(); ob.svc.dur = +ds.m; rr(); });
on('ob.durPick', async () => {
  capture();
  const { timeSheet } = await import('../flows.js');
  // Барабан вместо поля: минуты крутятся, и «73 минуты» набираются
  // так же легко, как круглый час.
  timeSheet({
    title: 'Сколько занимает',
    value: ob.svc.dur,
    hours: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    onOk: v => { ob.svc.dur = Math.max(5, v); rr(); },
  });
});
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
  if (!ob.dir) { toast(t('Выберите направление'), 'dan'); return; }
  ob.step = 2; rr();
});
on('ob.s3', () => {
  if (!ob.hours[1].on && !ob.hours[2].on && !ob.hours[3].on && !ob.hours[4].on
    && !ob.hours[5].on && !ob.hours[6].on && !ob.hours[0].on) {
    toast(t('Оставьте хотя бы один рабочий день'), 'dan'); return;
  }
  ob.step = 3; rr();
});
on('ob.finish', () => {
  capture();
  ob.svc.name = (ob.svc.name || '').trim();
  if (!ob.svc.name) { toast(t('Введите название услуги'), 'dan'); return; }
  build();
});
// Услугу можно завести и потом. Без неё компания просто не появится
// в каталоге — об этом честно написано на последнем шаге.
on('ob.skipSvc', () => { capture(); ob.svc.name = ''; build(); });

async function build() {
  const s = sheet({ title: t('Создаём'), body: loadingBlock(t('Настраиваем ваш бизнес…')) });
  await wait(1400);

  const cat = ob.dir || ['Другое', 'other', '#7C8AA5'];
  const id = 'co_' + Date.now().toString(36);
  const hours = {};
  [0, 1, 2, 3, 4, 5, 6].forEach(d => {
    const w = ob.hours[d];
    hours[d] = { on: !!w.on, from: w.from, to: w.to, breaks: [] };
  });
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

  if (ob.svc.name) {
    createService({
      name: ob.svc.name, price: +ob.svc.price || 0, duration: ob.svc.dur || 60,
      employeeIds: [ownerId], companyId: id, cat: cat[1],
    });
  }
  S.onboarded = true;
  emit();
  s.close();
  haptic('success');
  ob.step = 4; rr();
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
// Из списка «что осталось» ведём сразу в нужный раздел, а не на главную:
// иначе человек снова ищет, где это заполняется.
on('ob.todo', ds => { emit(); resetStack('o.home'); setTimeout(() => go(ds.r), 60); });
on('ob.restart', () => { ob.step = 1; ob.name = ''; ob.dir = null; ob.hours = HOURS0(); ob.svc = { name: '', price: '', dur: 60 }; resetStack('onb'); });
