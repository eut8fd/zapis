/* =========================================================
   Витрина для бизнеса
   ---------------------------------------------------------
   Экран для человека, который ещё не завёл компанию. До него у такого
   человека было два пути: стена текста в боте или сразу форма онбординга —
   ни одного экрана, который объясняет, что он получит.

   Здесь всё наоборот: сначала показываем, потом просим завести. Каждая
   возможность открывается разбором с картинкой и — главное — кнопкой
   «Посмотреть в демо»: живой кабинет с данными убедительнее скриншота,
   а он у нас уже есть.

   Картинки рисуем сами: внешних изображений в проекте нет и не будет —
   они бы уехали в localStorage вместе с данными.
   ========================================================= */
import { plans, PERIODS, allCompanies } from '../store.js';
import { esc, money, toast, t } from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { switchRole } from '../dev.js';
import { startOnboarding } from './onboarding.js';

const rr = () => render(false);

/* ---------------------------------------------------------
   Содержание
   --------------------------------------------------------- */

const STEPS = [
  {
    t: 'Собираете страницу',
    s: 'Услуги, мастера, часы работы. Минут десять, без программиста и без сайта.',
  },
  {
    t: 'Клиент записывается сам',
    s: 'Он видит только свободное время. Ни звонков, ни переписки «а когда можно?».',
  },
  {
    t: 'Вы видите день целиком',
    s: 'Кто, когда и на сколько. Напоминания клиентам уходят сами — за сутки и за два часа.',
  },
];

const FEATS = [
  {
    k: 'cal', t: 'Календарь', ic: 'calendar', color: '#4C6FFF',
    s: 'День, неделя и месяц',
    lead: 'Весь салон на одном экране: у каждого мастера своя колонка, свободные окна видно сразу.',
    how: [
      'День, неделя и месяц переключаются одной кнопкой, месяц показывает загрузку тепловой картой.',
      'Тап по свободному слоту — запись, блокировка, перерыв или отсутствие.',
      'Цвет мастера один и тот же в записях, в неделе и в фильтрах, поэтому день читается взглядом.',
      'Показатели периода рядом: записей, загрузка, свободные окна и ожидаемая выручка.',
    ],
    go: 'o.cal',
  },
  {
    k: 'clients', t: 'Клиенты', ic: 'users', color: '#12B76A',
    s: 'История, средний чек, заметки',
    lead: 'База, которая копится сама: каждый визит ложится в карточку клиента.',
    how: [
      'История визитов, сколько потратил, как часто приходит и к какому мастеру.',
      'Заметки о клиенте — вручную или голосом, AI разложит их по полочкам.',
      'Видно тех, кто давно не приходил: им можно написать, пока не ушли к соседям.',
      'Поиск по имени и телефону, фильтры по частоте и последнему визиту.',
    ],
    go: 'o.clients',
  },
  {
    k: 'team', t: 'Команда', ic: 'userPlus', color: '#8B5CF6',
    s: 'График, услуги и права',
    lead: 'У каждого мастера свой график и свой набор услуг — расписание считается само.',
    how: [
      'Часы мастера обрезаются часами салона: клиент не запишется на время, когда закрыто.',
      'Перерывы, отпуска, больничные и выходные — на любой диапазон дат.',
      'Три уровня доступа: мастер видит свой день, администратор — весь салон, владелец — ещё и деньги.',
      'Конфликты в графике подсвечиваются с кнопкой «Подогнать».',
    ],
    go: 'o.team',
  },
  {
    k: 'money', t: 'Деньги', ic: 'wallet', color: '#F79009',
    s: 'Доходы, расходы, прибыль',
    lead: 'Выручка считается из записей, расходы заводятся руками — прибыль видно за любой период.',
    how: [
      'Фактическая и ожидаемая выручка раздельно: видно, что уже в кассе, а что только записано.',
      'Свои категории доходов и расходов — под то, как устроен именно ваш салон.',
      'Регулярные платежи вроде аренды и зарплаты заводятся один раз и повторяются сами.',
      'Любой период: от недели до года или произвольный отрезок дат.',
    ],
    go: 'o.finance',
  },
  {
    k: 'ai', t: 'AI-помощник', ic: 'sparkles', color: '#8B5CF6',
    s: 'Итоги, идеи, шпаргалки',
    lead: 'Считает по вашим же данным и говорит человеческим языком, а не графиками.',
    how: [
      'Итоги недели: что выросло, что просело и на что стоит посмотреть.',
      'Идеи, чем заполнить пустые окна на ближайшие дни.',
      'Шпаргалка перед визитом: что клиент делал в прошлый раз и о чём он просил.',
      'Тексты для рассылок и сторис — черновиком, который остаётся поправить.',
    ],
    go: 'ai.home',
  },
  {
    k: 'bell', t: 'Напоминания', ic: 'bell', color: '#06AED4',
    s: 'За сутки и за два часа',
    lead: 'Клиент получает сообщение в тот же чат, где записывался. Ничего устанавливать не нужно.',
    how: [
      'Первое напоминание за 24 часа — чтобы успел перенести, если планы поменялись.',
      'Второе за 2 часа — чтобы просто не забыл.',
      'Перенести или отменить можно прямо из напоминания, слот сразу освободится.',
      'Вы видите очередь напоминаний и можете отправить тестовое себе.',
    ],
    go: null,
  },
];

const FACTS = [
  ['30 секунд', 'столько занимает запись у клиента'],
  ['14 дней', 'бесплатно, карту вводить не нужно'],
  ['0 установок', 'всё живёт внутри Telegram'],
];

const FAQ = [
  ['Клиенту нужно что-то устанавливать?',
    'Нет. Он открывает вашу ссылку в Telegram, который у него уже стоит. Никаких приложений, паролей и регистраций.'],
  ['А если клиент звонит, а не пишет?',
    'Запись можно завести самому — тапом по свободному слоту в календаре. Она встанет рядом с онлайн-записями и так же займёт время у мастера.'],
  ['Я работаю один, без команды. Подойдёт?',
    'Да. Тариф START рассчитан ровно на это: один мастер, страница записи, база клиентов и напоминания.'],
  ['Что будет с данными, если перестану платить?',
    'Страница записи перестанет принимать новых клиентов, но данные остаются. Возобновите подписку — всё на месте.'],
  ['Можно перенести клиентов из тетради или Excel?',
    'Да, клиентов можно завести списком. Историю визитов переносить не обязательно — она начнёт копиться с первой записи.'],
];

/* ---------------------------------------------------------
   Картинки
   --------------------------------------------------------- */

/** Главная: клиент нажал на время слева — у вас справа появился день. */
function artHero() {
  return `<svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <circle cx="86" cy="94" r="72" fill="var(--p)" opacity=".07"/>
    <circle cx="236" cy="88" r="64" fill="var(--ok)" opacity=".07"/>
    <rect x="34" y="22" width="96" height="138" rx="19" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    <rect x="48" y="38" width="42" height="7" rx="3.5" fill="var(--tx-3)" opacity=".45"/>
    <rect x="48" y="56" width="68" height="21" rx="7" fill="var(--sf-3)"/>
    <rect x="56" y="63" width="30" height="7" rx="3.5" fill="var(--tx-3)" opacity=".55"/>
    <rect x="48" y="83" width="68" height="21" rx="7" fill="var(--p)" opacity=".18"/>
    <rect x="56" y="90" width="26" height="7" rx="3.5" fill="var(--p)"/>
    <rect x="48" y="110" width="68" height="21" rx="7" fill="var(--sf-3)"/>
    <rect x="56" y="117" width="34" height="7" rx="3.5" fill="var(--tx-3)" opacity=".55"/>
    <circle cx="116" cy="93" r="14" fill="var(--p)" opacity=".2"/>
    <circle cx="116" cy="93" r="6.5" fill="var(--p)"/>
    <path d="M144 92h26" stroke="var(--tx-3)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1.5 7"/>
    <path d="m166 86 7 6-7 6" stroke="var(--tx-3)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="188" y="32" width="104" height="120" rx="17" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    <rect x="200" y="46" width="36" height="6" rx="3" fill="var(--tx-3)" opacity=".45"/>
    <rect x="200" y="62" width="80" height="19" rx="6" fill="var(--p)" opacity=".2"/>
    <rect x="206" y="69" width="28" height="5" rx="2.5" fill="var(--p)"/>
    <rect x="200" y="87" width="80" height="19" rx="6" fill="var(--ok)" opacity=".22"/>
    <rect x="206" y="94" width="36" height="5" rx="2.5" fill="var(--ok)"/>
    <rect x="200" y="112" width="80" height="19" rx="6" fill="var(--warn)" opacity=".22"/>
    <rect x="206" y="119" width="22" height="5" rx="2.5" fill="var(--warn)"/>
    <circle cx="288" cy="44" r="18" fill="var(--ok)"/>
    <path d="M280 44.5l5.5 5.5L297 38" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Три шага: собрали страницу — клиент выбрал время — вы видите день. */
const STEP_ART = [
  () => `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="14" y="10" width="92" height="64" rx="13" fill="var(--sf)" stroke="var(--bd)" stroke-width="1.8"/>
    <rect x="24" y="22" width="34" height="6" rx="3" fill="var(--tx-3)" opacity=".45"/>
    <rect x="24" y="36" width="60" height="12" rx="5" fill="var(--p)" opacity=".16"/>
    <rect x="30" y="40" width="22" height="4" rx="2" fill="var(--p)"/>
    <rect x="24" y="54" width="60" height="12" rx="5" fill="var(--sf-3)"/>
    <rect x="30" y="58" width="30" height="4" rx="2" fill="var(--tx-3)" opacity=".5"/>
    <circle cx="94" cy="60" r="13" fill="var(--p)"/>
    <path d="M88.5 60h11M94 54.5v11" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`,
  () => `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="26" y="6" width="68" height="72" rx="13" fill="var(--sf)" stroke="var(--bd)" stroke-width="1.8"/>
    <rect x="36" y="18" width="30" height="5" rx="2.5" fill="var(--tx-3)" opacity=".45"/>
    ${[0, 1, 2, 3, 4, 5].map(i => {
    const x = 36 + (i % 3) * 17, y = 32 + Math.floor(i / 3) * 17;
    const on = i === 4;
    return `<rect x="${x}" y="${y}" width="13" height="12" rx="4" fill="${on ? 'var(--p)' : 'var(--sf-3)'}"/>`;
  }).join('')}
    <circle cx="70" cy="55" r="13" fill="var(--p)" opacity=".2"/>
    <circle cx="70" cy="55" r="6" fill="var(--p)"/>
  </svg>`,
  () => `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="12" y="10" width="96" height="64" rx="13" fill="var(--sf)" stroke="var(--bd)" stroke-width="1.8"/>
    <path d="M32 20v46" stroke="var(--bd-2)" stroke-width="1.4" stroke-dasharray="2 4"/>
    <rect x="20" y="24" width="8" height="4" rx="2" fill="var(--tx-3)" opacity=".45"/>
    <rect x="20" y="42" width="8" height="4" rx="2" fill="var(--tx-3)" opacity=".45"/>
    <rect x="20" y="60" width="8" height="4" rx="2" fill="var(--tx-3)" opacity=".45"/>
    <rect x="38" y="20" width="58" height="14" rx="5" fill="var(--p)" opacity=".22"/>
    <rect x="38" y="38" width="44" height="14" rx="5" fill="var(--ok)" opacity=".24"/>
    <rect x="38" y="56" width="52" height="14" rx="5" fill="var(--warn)" opacity=".24"/>
  </svg>`,
];

/** Разбор возможности — своя картинка у каждой. */
const FEAT_ART = {
  cal: () => `<svg viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="16" y="12" width="208" height="106" rx="16" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    <rect x="32" y="26" width="48" height="7" rx="3.5" fill="var(--tx-3)" opacity=".45"/>
    ${[0, 1, 2, 3, 4].map(i => `<rect x="${32 + i * 36}" y="44" width="28" height="6" rx="3" fill="var(--tx-3)" opacity=".3"/>`).join('')}
    <rect x="32" y="58" width="28" height="20" rx="6" fill="var(--p)" opacity=".24"/>
    <rect x="68" y="58" width="28" height="34" rx="6" fill="var(--ok)" opacity=".26"/>
    <rect x="104" y="58" width="28" height="14" rx="6" fill="var(--warn)" opacity=".26"/>
    <rect x="140" y="58" width="28" height="28" rx="6" fill="var(--p)" opacity=".24"/>
    <rect x="176" y="58" width="28" height="18" rx="6" fill="var(--ai)" opacity=".24"/>
    <rect x="32" y="98" width="60" height="6" rx="3" fill="var(--tx-3)" opacity=".25"/>
  </svg>`,
  clients: () => `<svg viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="16" y="12" width="208" height="106" rx="16" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    ${[0, 1, 2].map(i => {
    const y = 28 + i * 30;
    const col = ['var(--p)', 'var(--ok)', 'var(--ai)'][i];
    return `<circle cx="44" cy="${y + 10}" r="13" fill="${col}" opacity=".9"/>
      <rect x="66" y="${y + 3}" width="${88 - i * 14}" height="6" rx="3" fill="var(--tx-3)" opacity=".5"/>
      <rect x="66" y="${y + 15}" width="${56 - i * 8}" height="5" rx="2.5" fill="var(--tx-3)" opacity=".25"/>
      <rect x="180" y="${y + 6}" width="24" height="9" rx="4.5" fill="${col}" opacity=".18"/>`;
  }).join('')}
  </svg>`,
  team: () => `<svg viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="16" y="12" width="208" height="106" rx="16" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    ${[0, 1, 2].map(i => {
    const y = 30 + i * 28;
    const col = ['var(--p)', 'var(--ok)', 'var(--warn)'][i];
    const w = [130, 96, 112][i];
    return `<circle cx="42" cy="${y + 8}" r="11" fill="${col}" opacity=".9"/>
      <rect x="62" y="${y + 4}" width="${w}" height="9" rx="4.5" fill="${col}" opacity=".22"/>`;
  }).join('')}
    <path d="M62 22v90" stroke="var(--bd-2)" stroke-width="1.4" stroke-dasharray="2 4"/>
    <path d="M158 22v90" stroke="var(--bd-2)" stroke-width="1.4" stroke-dasharray="2 4"/>
  </svg>`,
  money: () => `<svg viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="16" y="12" width="208" height="106" rx="16" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    ${[36, 58, 44, 72, 52, 88].map((h, i) => `<rect x="${34 + i * 30}" y="${100 - h}" width="18" height="${h}" rx="6" fill="var(--ok)" opacity="${0.22 + i * 0.11}"/>`).join('')}
    <path d="M34 34h60" stroke="var(--tx-3)" stroke-width="1.4" stroke-dasharray="2 4" opacity=".5"/>
    <rect x="34" y="24" width="42" height="6" rx="3" fill="var(--tx-3)" opacity=".4"/>
  </svg>`,
  ai: () => `<svg viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="16" y="12" width="208" height="106" rx="16" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    <rect x="34" y="30" width="120" height="34" rx="12" fill="var(--ai)" opacity=".14"/>
    <rect x="46" y="40" width="76" height="6" rx="3" fill="var(--ai)" opacity=".7"/>
    <rect x="46" y="52" width="52" height="5" rx="2.5" fill="var(--ai)" opacity=".4"/>
    <rect x="86" y="74" width="120" height="30" rx="12" fill="var(--sf-3)"/>
    <rect x="98" y="83" width="84" height="6" rx="3" fill="var(--tx-3)" opacity=".45"/>
    <rect x="98" y="94" width="48" height="4" rx="2" fill="var(--tx-3)" opacity=".25"/>
    <path d="M186 26l3.6 7.4 7.4 3.6-7.4 3.6-3.6 7.4-3.6-7.4-7.4-3.6 7.4-3.6L186 26Z" fill="var(--ai)"/>
  </svg>`,
  bell: () => `<svg viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="16" y="12" width="208" height="106" rx="16" fill="var(--sf)" stroke="var(--bd)" stroke-width="2"/>
    <circle cx="72" cy="65" r="30" fill="var(--p)" opacity=".1"/>
    <path d="M72 44a13 13 0 0 1 13 13v10l4 6H55l4-6V57a13 13 0 0 1 13-13Z" fill="var(--p)" opacity=".85"/>
    <path d="M67 77a5 5 0 0 0 10 0" stroke="var(--p)" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="124" y="44" width="82" height="24" rx="10" fill="var(--sf-3)"/>
    <rect x="136" y="53" width="46" height="6" rx="3" fill="var(--tx-3)" opacity=".45"/>
    <rect x="124" y="76" width="82" height="24" rx="10" fill="var(--ok)" opacity=".18"/>
    <rect x="136" y="85" width="34" height="6" rx="3" fill="var(--ok)"/>
  </svg>`,
};

/* ---------------------------------------------------------
   Витрина
   --------------------------------------------------------- */

const faqOpen = new Set();

route('biz.start', {
  noTab: true,
  render() {
    const list = plans().filter(p => p.active !== false);
    // средний по цене тариф — его и выделяем: на него смотрят чаще всего
    const best = list.length > 2 ? list.slice().sort((a, b) => a.price - b.price)[1] : list[list.length - 1];
    const salons = allCompanies().filter(c => c.status !== 'blocked').length;

    return `
    <div class="biz-hero">
      <div class="biz-art">${artHero()}</div>
      <h1 class="biz-h1">${t('Запись, которая живёт там, где ваши клиенты')}</h1>
      <p class="biz-lead">${t('Страница записи, календарь, клиенты и деньги — внутри Telegram. Настроить можно за вечер, дальше работает само.')}</p>
      <div class="biz-facts">
        ${FACTS.map(f => `<div class="biz-fact"><b>${esc(t(f[0]))}</b><i>${esc(t(f[1]))}</i></div>`).join('')}
      </div>
    </div>

    <div class="wrap biz-cta">
      <button class="btn p" style="height:54px;font-size:16px" data-a="biz.create">
        ${icon('sparkles', 19)}${t('Создать свой бизнес')}</button>
      <button class="btn gh" style="margin-top:9px" data-a="biz.demo" data-r="">
        ${icon('play', 18)}${t('Сначала посмотреть кабинет')}</button>
      <div class="tiny dim center" style="margin-top:10px">${t('14 дней бесплатно · карта не нужна')}</div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Как это работает')}</div></div>
      <div class="wrap stack">
        ${STEPS.map((s, i) => `<div class="card biz-step">
          <div class="biz-step-art">${STEP_ART[i]()}</div>
          <div class="grow">
            <div class="biz-step-n">${t('Шаг {n}', { n: i + 1 })}</div>
            <div class="b" style="font-size:15.5px">${esc(t(s.t))}</div>
            <div class="sm" style="color:var(--tx-2);line-height:1.45;margin-top:3px">${esc(t(s.s))}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Что внутри')}</div>
        <span class="tiny dim">${t('нажмите, чтобы посмотреть')}</span></div>
      <div class="wrap"><div class="grid2">
        ${FEATS.map(f => `<button class="cat-tile press" data-a="biz.feat" data-k="${f.k}">
          <div class="tint" style="background:${f.color}1f;color:${f.color}">${icon(f.ic, 19)}</div>
          <div class="b sm nowrap">${esc(t(f.t))}</div>
          <div class="tiny muted">${esc(t(f.s))}</div>
        </button>`).join('')}
      </div></div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Тарифы')}</div>
        <span class="tiny dim">${t('первые 14 дней бесплатно')}</span></div>
      <div class="wrap stack">
        ${list.map(p => {
      const top = best && p.id === best.id;
      return `<div class="card pad biz-plan ${top ? 'on' : ''}">
          ${top ? `<span class="biz-plan-tag">${t('чаще всего берут')}</span>` : ''}
          <div class="row between" style="margin-bottom:10px">
            <div><div class="b" style="font-size:18px">${esc(p.name)}</div>
              <div class="tiny muted">${money(p.price)} / ${(PERIODS[p.period] || PERIODS.month).t}</div></div>
            <button class="btn xs ${top ? 'p' : 'gh'}" style="width:auto;padding:0 16px" data-a="biz.create" data-p="${esc(p.id)}">${t('Попробовать')}</button>
          </div>
          <div class="stack" style="gap:6px">
            ${(p.feats || []).map(f => `<div class="row sm" style="gap:8px;color:var(--tx-2)">
              <span style="color:var(--ok);flex:none">${icon('check', 14, 2.6)}</span>${esc(f)}</div>`).join('')}
          </div>
        </div>`;
    }).join('')}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Частые вопросы')}</div></div>
      <div class="wrap stack s">
        ${FAQ.map((q, i) => `<div class="card biz-q ${faqOpen.has(i) ? 'on' : ''}">
          <button class="press biz-q-h" data-a="biz.faq" data-i="${i}">
            <div class="grow b sm">${esc(t(q[0]))}</div>
            <span class="biz-q-x">${icon('down', 17)}</span>
          </button>
          ${faqOpen.has(i) ? `<div class="biz-q-b">${esc(t(q[1]))}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>

    <div class="wrap sec">
      <div class="card pad center biz-end">
        <div class="b" style="font-size:17px">${t('Попробуйте на своих услугах')}</div>
        <div class="sm" style="color:var(--tx-2);margin-top:5px;line-height:1.45">
          ${t('Заведите компанию за пару минут — её всегда можно перенастроить или удалить.')}</div>
        <button class="btn p" style="margin-top:14px" data-a="biz.create">${t('Создать свой бизнес')}</button>
      </div>
      <div class="tiny dim center" style="margin-top:14px">
        Уже ${salons} ${salons % 10 === 1 && salons % 100 !== 11 ? 'компания' : 'компаний'} в демо-базе платформы</div>
    </div>`;
  },
});

on('biz.faq', ds => {
  const i = +ds.i;
  if (faqOpen.has(i)) faqOpen.delete(i); else faqOpen.add(i);
  rr();
});
// тариф, на который нажали, доезжает до создания компании — иначе три
// кнопки «Попробовать» вели в одно и то же и выдавали всем PRO
on('biz.create', ds => startOnboarding(ds && ds.p));
on('biz.feat', ds => go('biz.feat', { k: ds.k }));

/* Живой кабинет вместо скриншота: данные в демо уже есть, показывать
   картинку там, где можно показать сам продукт, — слабее. */
on('biz.demo', ds => {
  switchRole('owner');
  if (ds.r) setTimeout(() => go(ds.r), 240);
  toast(t('Это демо-кабинет с готовыми данными'));
});

/* ---------------------------------------------------------
   Разбор одной возможности
   --------------------------------------------------------- */
route('biz.feat', {
  noTab: true,
  render(p) {
    const f = FEATS.find(x => x.k === p.k) || FEATS[0];
    const art = FEAT_ART[f.k];
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">${esc(t(f.t))}</div><div class="top-sub">${esc(t(f.s))}</div></div></div>

    <div class="wrap">
      <div class="biz-feat-art">${art ? art() : ''}</div>
      <p class="sm" style="color:var(--tx-2);line-height:1.5;margin:16px 2px 0">${esc(t(f.lead))}</p>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">${t('Как это работает')}</div></div>
      <div class="wrap stack s">
        ${f.how.map((line, i) => `<div class="row biz-how">
          <div class="biz-how-n" style="background:${f.color}1f;color:${f.color}">${i + 1}</div>
          <div class="sm" style="line-height:1.5;color:var(--tx-2)">${esc(t(line))}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="wrap sec">
      <button class="btn p" data-a="biz.create">${t('Создать свой бизнес')}</button>
      ${f.go ? `<button class="btn gh" style="margin-top:9px" data-a="biz.demo" data-r="${f.go}">${icon('play', 17)}${t('Посмотреть в демо')}</button>` : ''}
    </div>`;
  },
});
